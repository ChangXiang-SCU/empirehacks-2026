// Exact records and expiry, carried in an entry's tags so no tool definition has to change.
//   kind      "todo" | "decision" | "fact"            (also 待办 / 决定 / 事实)
//   validity  "expires:YYYY-MM-DD"                      stops counting as current after that day
//   closing   "done:<id>"  "supersedes:<id>"            given on a NEW entry; the old entry is marked, never deleted
// An old entry then carries "status:done" or "superseded-by:<new id>". Search shows such entries marked and ranks them
// lower; get_project_context lists only the ones still in force.
const KIND = { 'todo': 'todo', 'to-do': 'todo', '待办': 'todo', 'decision': 'decision', '决定': 'decision', '决策': 'decision', 'fact': 'fact', '事实': 'fact' }
const HINT = /todo|to-do|待办|decision|决定|决策|fact|事实|supersed|expires|valid-until|status:/i

export function parseTags(tagsJson) {
  try { const t = JSON.parse(tagsJson || '[]'); return Array.isArray(t) ? t.map(String) : [] } catch { return [] }
}

/** null for ordinary entries; otherwise { kind, status: 'active'|'done'|'superseded'|'expired', expires, by } */
export function factInfo(tagsJson, now = Date.now()) {
  if (!tagsJson || !HINT.test(tagsJson)) return null
  let kind = null, status = 'active', expires = null, by = null
  for (const t of parseTags(tagsJson)) {
    const l = t.toLowerCase().trim()
    if (KIND[l]) kind = kind || KIND[l]
    else if (l.startsWith('expires:') || l.startsWith('valid-until:')) expires = t.slice(t.indexOf(':') + 1).trim()
    else if (l.startsWith('superseded-by:')) { status = 'superseded'; by = t.slice(t.indexOf(':') + 1).trim() }
    else if (l === 'status:done') status = 'done'
    else if (l === 'status:obsolete') status = 'superseded'
  }
  if (status === 'active' && expires) {
    const end = Date.parse(expires.length <= 10 ? expires + 'T23:59:59Z' : expires)
    if (!isNaN(end) && end < now) status = 'expired'
  }
  if (!kind && status === 'active' && !expires) return null
  return { kind, status, expires, by }
}

/** Apply "done:<id>" / "supersedes:<id>" tags of a new entry to the entries they name. Returns notes for the reply. */
export function applyDirectives(store, newId, tags) {
  const notes = []
  for (const t of tags) {
    const m = /^(supersedes|replaces|obsolete|done|closes)\s*:\s*(\S+)$/i.exec(String(t).trim())
    if (!m) continue
    const target = store.dbGet('SELECT id, tags FROM nodes WHERE id = ?', [m[2]])
    if (!target) { notes.push(`${m[2]} not found, nothing marked`); continue }
    const closing = /^(done|closes)$/i.test(m[1])
    const add = closing ? ['status:done', `closed-by:${newId}`] : [`superseded-by:${newId}`]
    store.dbRun('UPDATE nodes SET tags = ? WHERE id = ?', [JSON.stringify([...new Set([...parseTags(target.tags), ...add])]), target.id])
    notes.push(`${target.id} marked ${closing ? 'done' : 'superseded'}`)
  }
  return notes
}

const TODO_H = /待办|未拍板|todo|to-do|open items|action items/i
const DECISION_H = /已定案|已拍板|决定|决策|decisions?\b/i

/** To-dos and decisions written as top-level bullets under a "TODO"/"待办" or "Decisions"/"已定案" heading of a notes file. */
export function extractRecords(text) {
  const out = []
  let kind = null
  for (const line of String(text || '').split('\n')) {
    const h = /^#{1,4}\s+(.*)$/.exec(line)
    if (h) { kind = TODO_H.test(h[1]) ? 'todo' : DECISION_H.test(h[1]) ? 'decision' : null; continue }
    if (!kind) continue
    const b = /^[-*]\s+(?:\[( |x|X)\]\s+)?(.+)$/.exec(line)
    if (!b || (b[1] && b[1] !== ' ')) continue          // a ticked checkbox is finished
    out.push({ kind, text: b[2].trim() })
  }
  return out
}
