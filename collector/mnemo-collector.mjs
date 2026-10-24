#!/usr/bin/env node
// Mnemosyne collector: uploads finished AI session transcripts from this machine
// to the Mnemosyne server. Zero dependencies (Node 20+).
//
//   node mnemo-collector.mjs            run forever (scan every minute)
//   node mnemo-collector.mjs --once     one pass, then exit
//   node mnemo-collector.mjs --status   show what has been uploaded
//
// Config: ~/.mnemosyne/collector.json  { "endpoint": "https://host/<secret>" }
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import zlib from 'node:zlib'

const HOME = os.homedir()
const DIR = process.env.MNEMO_COLLECTOR_DIR || path.join(HOME, '.mnemosyne')
const CFG_PATH = path.join(DIR, 'collector.json')
const STATE_PATH = path.join(DIR, 'collector-state.json')
const LOG_PATH = path.join(DIR, 'collector.log')
const args = new Set(process.argv.slice(2))

fs.mkdirSync(DIR, { recursive: true })
const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf-8'))
const ENDPOINT = cfg.endpoint.replace(/\/+$/, '')
const IDLE_MS = (cfg.idleMinutes ?? 10) * 60000          // a transcript must be quiet this long
const RECENT_MS = (cfg.dikwDays ?? 14) * 86400000         // only recent sessions get LLM distillation
const SCAN_MS = (cfg.scanSeconds ?? 60) * 1000
const MAX_BYTES = (cfg.maxMB ?? 150) * 1048576

const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming')
const KINDS = {
  jsonl: f => f.endsWith('.jsonl') && !/[\\/]subagents[\\/]/.test(f),
  audit: f => path.basename(f) === 'audit.jsonl'
}
const DEFAULT_SOURCES = [
  { platform: 'claude-code', root: path.join(HOME, '.claude', 'projects'), match: KINDS.jsonl },
  { platform: 'codex', root: path.join(HOME, '.codex', 'sessions'), match: KINDS.jsonl },
  { platform: 'codex', root: path.join(HOME, '.codex', 'archived_sessions'), match: KINDS.jsonl },
  { platform: 'cowork', root: path.join(APPDATA, 'Claude', 'local-agent-mode-sessions'), match: KINDS.audit },
  { platform: 'cowork', root: path.join(HOME, '.config', 'Claude', 'local-agent-mode-sessions'), match: KINDS.audit }
]
// collector.json can add sources and set "defaultSources": false (e.g. on a server):
//   roots:        [{ platform, root, kind: 'jsonl'|'audit', dikw: false }]   other users' Claude Code / Cowork folders
//   extraSources: [{ platform, root, transform: 'wxbot', label, cwd }]       transcripts that need rewriting first
const SOURCES = [
  ...(cfg.defaultSources === false ? [] : DEFAULT_SOURCES),
  ...(cfg.roots || []).map(r => ({ platform: r.platform, root: r.root, match: KINDS[r.kind || 'jsonl'], dikw: r.dikw })),
  ...(cfg.extraSources || []).map(x => ({ match: KINDS.jsonl, ...x }))
]

// ── WeChat bot transcripts ──
// The bots are Claude Code sessions fed by a channel server: incoming WeChat messages are isMeta
// <channel ...> user events (or queued_command attachments when the bot was busy), and replies are
// hub_reply tool calls. Turn that into a plain user/assistant transcript the server's importer reads.
const CHANNEL_RE = /<channel\s+([^>]*)>([\s\S]*?)<\/channel>/g
const attr = (s, k) => (s.match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1] || ''
function wxbotTransform(text, src) {
  const out = []
  const seen = new Set()
  let sessionId = null, first = null
  const cwd = src.cwd || '/srv/wxbot/微信bot'
  const pushUser = (raw, ts, sid) => {
    for (const [, attrs, body] of String(raw).matchAll(CHANNEL_RE)) {
      const ch = attr(attrs, 'hub_channel') || attr(attrs, 'source')
      if (!ch || ch === 'system' || attr(attrs, 'sender') === 'system') continue
      const t = body.trim()
      if (!t) continue
      const key = ts + '|' + t.slice(0, 200)
      if (seen.has(key)) continue
      seen.add(key)
      if (!first) first = t
      out.push({ type: 'user', sessionId: sid, timestamp: ts, cwd, message: { role: 'user', content: ch === 'wechat' ? t : `[${ch}] ${t}` } })
    }
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (!sessionId && e.sessionId) sessionId = e.sessionId
    const sid = e.sessionId || sessionId
    const m = e.message
    if (e.type === 'user' && m && !e.isReplay) {
      let c = m.content
      if (Array.isArray(c)) c = c.filter(b => b && b.type === 'text').map(b => b.text).join('\n')
      if (typeof c === 'string' && c.includes('<channel')) pushUser(c, e.timestamp, sid)
    } else if (e.type === 'attachment' && e.attachment?.type === 'queued_command' && typeof e.attachment.prompt === 'string') {
      pushUser(e.attachment.prompt, e.attachment.timestamp || e.timestamp, sid)
    } else if (e.type === 'assistant' && Array.isArray(m?.content)) {
      for (const b of m.content) {
        if (!b || b.type !== 'tool_use' || !b.input) continue
        const name = String(b.name || '')
        let say = null
        if (/(^|_)reply$/.test(name) && b.input.text) say = String(b.input.text)
        else if (/send_file$/.test(name) && b.input.path) say = `[发送文件] ${path.posix.basename(String(b.input.path))}`
        if (say) out.push({ type: 'assistant', sessionId: sid, timestamp: e.timestamp, cwd, message: { role: 'assistant', content: say } })
      }
    }
  }
  if (!out.length) return ''
  const label = src.label || '微信'
  const title = `${label} · ${(first || '对话').replace(/\s+/g, ' ').slice(0, 50)}`
  return [{ type: 'custom-title', customTitle: title, sessionId }, ...out].map(o => JSON.stringify(o)).join('\n') + '\n'
}
const TRANSFORMS = { wxbot: wxbotTransform }

function log(...a) {
  const line = `${new Date().toISOString()} ${a.join(' ')}\n`
  if (!args.has('--quiet')) process.stdout.write(line)
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 2 * 1048576) fs.renameSync(LOG_PATH, LOG_PATH + '.1')
    fs.appendFileSync(LOG_PATH, line)
  } catch {}
}

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) } catch { return { files: {} } } }
function saveState(s) { const t = STATE_PATH + '.tmp'; fs.writeFileSync(t, JSON.stringify(s)); fs.renameSync(t, STATE_PATH) }

function* walk(root, match) {
  let entries
  try { entries = fs.readdirSync(root, { withFileTypes: true, recursive: true }) } catch { return }
  for (const e of entries) {
    if (!e.isFile()) continue
    const full = path.join(e.parentPath || e.path || root, e.name)
    if (match(full)) yield full
  }
}

async function uploadBody(platform, key, buf, size, mtimeMs, allowDikw = true) {
  const q = new URLSearchParams({
    platform, path: key, size: String(size), mtime: String(Math.round(mtimeMs)),
    dikw: allowDikw && Date.now() - mtimeMs < RECENT_MS ? '1' : '0'
  })
  const res = await fetch(`${ENDPOINT}/api/ingest?${q}`, {
    method: 'POST', body: zlib.gzipSync(buf), headers: { 'content-type': 'application/gzip' }, signal: AbortSignal.timeout(600000)
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`)
  return JSON.parse(text)
}
// Transcripts are mostly tool output; the server only needs conversation turns, tool calls (paths, for Project
// filing), titles and session metadata. Dropping tool results and status noise shrinks big sessions ~10x.
function slimTranscript(buf) {
  const keep = []
  for (const line of buf.toString('utf-8').split('\n')) {
    if (!line) continue
    if (line.includes('"tool_result"') || /"type":"(system|rate_limit_event|command_lifecycle|progress|queue-operation)"/.test(line)) {
      let e; try { e = JSON.parse(line) } catch { keep.push(line); continue }
      if (e.type === 'system' && e.subtype === 'init') { keep.push(line); continue }
      if (['system', 'rate_limit_event', 'command_lifecycle', 'progress', 'queue-operation'].includes(e.type)) continue
      const c = e.message?.content
      if (e.type === 'user' && Array.isArray(c) && c.length && c.every(b => b?.type === 'tool_result')) continue
    }
    keep.push(line)
  }
  return Buffer.from(keep.join('\n'), 'utf-8')
}
async function upload(src, file, st) {
  const raw = fs.readFileSync(file)
  let body
  if (src.transform) {
    const t = TRANSFORMS[src.transform](raw.toString('utf-8'), src)
    if (!t) return { skipped: 'no messages' }
    if (args.has('--dry')) {
      const ls = t.trim().split('\n').map(l => JSON.parse(l))
      return { skipped: 'dry', title: ls[0].customTitle, nodes: ls.length - 1, users: ls.filter(l => l.type === 'user').length }
    }
    body = Buffer.from(t, 'utf-8')
  } else if (args.has('--dry')) return { skipped: 'dry', nodes: '?' }
  else body = src.platform === 'codex' ? raw : slimTranscript(raw)
  return uploadBody(src.platform, file, body, st.size, st.mtimeMs, src.dikw !== false)
}

// Codex desktop (since 2026-09) keeps threads in SQLite (state_N.sqlite + thread_history_N.sqlite)
// instead of rollout files. Rebuild each thread as a rollout-format JSONL so the server's Codex importer reads it.
let sqlite = null
function newestDb(dir, prefix) {
  try {
    return fs.readdirSync(dir).filter(f => new RegExp(`^${prefix}_\\d+\\.sqlite$`).test(f))
      .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0])).map(f => path.join(dir, f))[0]
  } catch { return null }
}
async function codexThreads() {
  const dir = path.join(HOME, '.codex')
  const stateDb = newestDb(dir, 'state'), histDb = newestDb(dir, 'thread_history')
  if (!stateDb || !histDb) return []
  if (!sqlite) { try { sqlite = await import('node:sqlite') } catch { return [] } }
  let st, hist
  try {
    st = new sqlite.DatabaseSync(stateDb, { readOnly: true })
    hist = new sqlite.DatabaseSync(histDb, { readOnly: true })
    const ms = v => (v < 1e12 ? v * 1000 : v)
    const items = hist.prepare('SELECT item_type, created_at_ms, item_json FROM thread_items WHERE thread_id = ? AND item_type IN (\'userMessage\', \'agentMessage\') ORDER BY rollout_ordinal')
    return st.prepare('SELECT id, cwd, model_provider, title, created_at, updated_at FROM threads').all().map(t => ({
      key: `codex-sqlite:${t.id}`, updatedMs: ms(t.updated_at),
      build() {
        const iso = v => new Date(v).toISOString()
        const lines = [JSON.stringify({ type: 'session_meta', timestamp: iso(ms(t.created_at)), payload: { id: t.id, cwd: t.cwd, model_provider: t.model_provider, title: t.title } })]
        for (const it of items.all(t.id)) {
          let j; try { j = JSON.parse(it.item_json) } catch { continue }
          const role = j.type === 'userMessage' ? 'user' : 'assistant'
          const text = role === 'user' ? (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n') : (j.text || '')
          if (!text.trim()) continue
          lines.push(JSON.stringify({ type: 'response_item', timestamp: iso(it.created_at_ms), payload: { role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } }))
        }
        return lines.length > 2 ? lines.join('\n') : null
      }
    }))
  } catch (e) { log(`codex sqlite: ${e.message}`); return [] }
}

// Claude desktop Projects live in <cowork root>/<account>/<org>/spaces.json; send them so the server can file sessions
async function syncSpaces(state) {
  const all = new Map()
  for (const src of SOURCES) {
    if (src.match !== KINDS.audit) continue
    let accts = []; try { accts = fs.readdirSync(src.root) } catch { continue }
    for (const a of accts) {
      let orgs = []; try { orgs = fs.readdirSync(path.join(src.root, a)) } catch { continue }
      for (const o of orgs) {
        try { for (const sp of JSON.parse(fs.readFileSync(path.join(src.root, a, o, 'spaces.json'), 'utf-8')).spaces || []) all.set(sp.id, { id: sp.id, name: sp.name, projects: sp.projects, folders: sp.folders }) } catch {}
      }
    }
  }
  if (!all.size) return
  const body = JSON.stringify({ spaces: [...all.values()] })
  const hash = (await import('node:crypto')).createHash('sha1').update(body).digest('hex')
  if (state.spacesHash === hash) return
  const res = await fetch(`${ENDPOINT}/api/spaces`, { method: 'POST', body, headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`spaces HTTP ${res.status}`)
  const r = await res.json()
  state.spacesHash = hash
  log(`projects synced: ${r.spaces} Claude Projects${r.filed ? `, ${r.filed} sessions filed` : ''}`)
}

let busy = false
async function scan() {
  if (busy) return
  busy = true
  const state = loadState()
  let uploaded = 0, failed = 0
  try {
    try { await syncSpaces(state) } catch (e) { log(`✗ projects sync: ${e.message}`) }
    for (const src of SOURCES) {
      for (const file of walk(src.root, src.match)) {
        let st
        try { st = fs.statSync(file) } catch { continue }
        const prev = state.files[file]
        if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) continue
        if (Date.now() - st.mtimeMs < IDLE_MS) continue
        if (st.size < 200 || st.size > MAX_BYTES) { state.files[file] = { size: st.size, mtimeMs: st.mtimeMs, skipped: 'size' }; continue }
        try {
          const r = await upload(src, file, st)
          if (r.skipped === 'dry') { log(`dry ${src.platform} ${path.basename(file)} → ${r.title || ''} (${r.nodes} msgs, ${r.users ?? '?'} from user)`); continue }
          state.files[file] = { size: st.size, mtimeMs: st.mtimeMs, at: new Date().toISOString(), projectId: r.projectId, result: r.skipped || `${r.nodes} nodes` }
          saveState(state)
          uploaded++
          if (!r.skipped) log(`↑ ${src.platform} ${path.basename(path.dirname(file))}/${path.basename(file)} → ${r.space ? `[${r.space}] ` : ''}${r.title || r.projectId} (${r.nodes} nodes${r.dikw ? ', distilling' : ''})`)
        } catch (e) {
          failed++
          log(`✗ ${file}: ${e.message}`)
          if (failed >= 3) { log('server unreachable, retry next scan'); return }
        }
      }
    }
    for (const t of cfg.defaultSources === false ? [] : await codexThreads()) {
      const prev = state.files[t.key]
      if (prev && prev.mtimeMs === t.updatedMs) continue
      if (Date.now() - t.updatedMs < IDLE_MS) continue
      const content = t.build()
      if (!content) { state.files[t.key] = { mtimeMs: t.updatedMs, skipped: 'empty' }; continue }
      const buf = Buffer.from(content, 'utf-8')
      try {
        const r = await uploadBody('codex', t.key, buf, buf.length, t.updatedMs)
        state.files[t.key] = { size: buf.length, mtimeMs: t.updatedMs, at: new Date().toISOString(), projectId: r.projectId, result: r.skipped || `${r.nodes} nodes` }
        saveState(state)
        uploaded++
        if (!r.skipped) log(`↑ codex ${t.key} → ${r.title || r.projectId} (${r.nodes} nodes${r.dikw ? ', distilling' : ''})`)
      } catch (e) {
        failed++
        log(`✗ ${t.key}: ${e.message}`)
        if (failed >= 3) { log('server unreachable, retry next scan'); return }
      }
    }
  } finally {
    saveState(state)
    busy = false
    if (uploaded || failed) log(`scan done: ${uploaded} uploaded, ${failed} failed`)
  }
}

if (args.has('--status')) {
  const s = loadState()
  const files = Object.entries(s.files)
  console.log(`${files.length} files tracked; endpoint ${ENDPOINT.replace(/\/[^/]{16,}$/, '/<secret>')}`)
  for (const [f, v] of files.sort((a, b) => (b[1].at || '').localeCompare(a[1].at || '')).slice(0, 15)) console.log(`${v.at || '-'}  ${v.result || v.skipped || ''}  ${f}`)
  process.exit(0)
}

if (args.has('--once')) {
  await scan()
  process.exit(0)
}

// Single instance: hold a loopback port as a mutex
const lock = net.createServer().on('error', () => { console.error('collector already running'); process.exit(0) })
lock.listen(cfg.lockPort ?? 37791, '127.0.0.1', () => {
  log(`collector started; endpoint ${ENDPOINT.replace(/\/[^/]{16,}$/, '/<secret>')}`)
  scan()
  setInterval(scan, SCAN_MS)
})
