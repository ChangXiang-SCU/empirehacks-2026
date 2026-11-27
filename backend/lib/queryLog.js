// Append-only usage log of memory lookups: what was asked, which entries came back, which were then opened.
// One JSON object per line in a file next to the database, so writing it never touches the in-memory sql.js
// database or invalidates the search index. Useful for seeing how the memory is actually used and where search
// comes back empty. It holds the user's own queries: protect it like the database, never commit it.
//   MNEMO_QUERY_LOG=off         disable
//   MNEMO_QUERY_LOG=/some/path  write elsewhere (default: <directory of MNEMO_DB>/query-log.jsonl)
import fs from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
let warned = false

export function queryLogPath(env = process.env) {
  const v = (env.MNEMO_QUERY_LOG || '').trim()
  if (/^(off|0|false|no)$/i.test(v)) return null
  return v || join(dirname(env.MNEMO_DB || join(HERE, '..', 'db', 'mnemosyne.db')), 'query-log.jsonl')
}

/** Record one lookup. Never throws: logging must not break a tool call. */
export function logQuery(entry, env = process.env) {
  try {
    const p = queryLogPath(env)
    if (!p) return false
    fs.appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 })
    return true
  } catch (e) {
    if (!warned) { warned = true; console.error('query log off:', e.message) }
    return false
  }
}

/** Parsed log entries, oldest first; unreadable lines are skipped. */
export function readQueryLog(path) {
  const out = []
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch {}
  }
  return out
}
