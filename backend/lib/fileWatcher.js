import chokidar from 'chokidar'
import path from 'path'
import os from 'os'
import fs from 'fs'

export function startFileWatcher(onSessionDetected) {
  const homeDir = os.homedir()

  const watchPaths = [
    path.join(homeDir, '.claude', 'projects'),
    path.join(homeDir, '.openclaw'),
    path.join(homeDir, '.codex', 'sessions')
  ]

  // Track files being written: filePath -> { timer, lastSize, checks }
  const pending = new Map()
  // Track already-processed files to avoid re-triggering
  const processed = new Map() // filePath -> lastProcessedSize

  const MAX_EMPTY_CHECKS = 20 // Give up after ~60s of empty file

  const watcher = chokidar.watch(watchPaths, {
    ignored: /node_modules/,
    persistent: true,
    usePolling: true,       // More reliable on Windows
    interval: 2000,         // Poll every 2s
    ignoreInitial: true,
    depth: 10
  })

  function checkStable(filePath) {
    try {
      const size = fs.statSync(filePath).size
      const prev = pending.get(filePath)
      if (!prev) return
      const checks = (prev.checks || 0) + 1

      if (prev.lastSize === size) {
        // Size unchanged since last check
        if (size < 100) {
          // File still too small — keep waiting unless we've waited too long
          if (checks >= MAX_EMPTY_CHECKS) {
            console.log(`  Giving up on empty file: ${path.basename(filePath)}`)
            pending.delete(filePath)
            return
          }
          // Keep checking — file may still be written to
          const timer = setTimeout(() => checkStable(filePath), 3000)
          pending.set(filePath, { lastSize: size, timer, checks })
          return
        }

        // File is stable and has content — process it
        pending.delete(filePath)

        // Skip if already processed at this size
        const lastProcessed = processed.get(filePath)
        if (lastProcessed === size) return

        processed.set(filePath, size)
        console.log(`  File stable at ${(size/1024).toFixed(1)}KB: ${path.basename(filePath)}`)
        onSessionDetected({
          path: filePath,
          type: filePath.includes('.codex') ? 'codex'
              : filePath.includes('.claude') ? 'claude-code'
              : 'openclaw',
          timestamp: new Date().toISOString()
        })
      } else {
        // Size changed — still writing, check again in 3s
        if (prev.timer) clearTimeout(prev.timer)
        const timer = setTimeout(() => checkStable(filePath), 3000)
        pending.set(filePath, { lastSize: size, timer, checks })
      }
    } catch {
      pending.delete(filePath)
    }
  }

  function onFileEvent(filePath) {
    if (!filePath.endsWith('.jsonl')) return

    const basename = path.basename(filePath).toLowerCase()
    const skipFiles = ['credentials', 'settings', 'auth', 'cache', 'history', 'blocklist']
    if (skipFiles.some(s => basename.includes(s))) return

    // Start/restart stability check
    const prev = pending.get(filePath)
    if (prev?.timer) clearTimeout(prev.timer)
    const timer = setTimeout(() => checkStable(filePath), 3000)
    try {
      const size = fs.statSync(filePath).size
      pending.set(filePath, { lastSize: size, timer, checks: 0 })
    } catch {}
  }

  watcher
    .on('add', onFileEvent)
    .on('change', onFileEvent)
    .on('error', (error) => console.error('File watcher error:', error))

  console.log('\u2713 File watcher active (.claude/projects, .openclaw, .codex/sessions)')
  return watcher
}

export function stopFileWatcher(watcher) {
  if (watcher) watcher.close()
}
