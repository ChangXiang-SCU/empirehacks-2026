import chokidar from 'chokidar'
import path from 'path'
import os from 'os'

export function startFileWatcher(onSessionDetected) {
  const homeDir = os.homedir()
  const claudePath = path.join(homeDir, '.claude')
  const openclawPath = path.join(homeDir, '.openclaw')

  const watcher = chokidar.watch([claudePath, openclawPath], {
    ignored: /(^|[\/\\])\./, 
    persistent: true,
    usePolling: false
  })

  watcher
    .on('add', (filePath) => {
      if (filePath.endsWith('.jsonl') || filePath.endsWith('.json')) {
        onSessionDetected({
          path: filePath,
          type: filePath.includes('.claude') ? 'claude-code' : 'openclaw',
          timestamp: new Date().toISOString()
        })
      }
    })
    .on('error', (error) => {
      console.error('File watcher error:', error)
    })

  console.log('✓ File watcher started for .claude and .openclaw')

  return watcher
}

export function stopFileWatcher(watcher) {
  if (watcher) {
    watcher.close()
    console.log('✓ File watcher stopped')
  }
}
