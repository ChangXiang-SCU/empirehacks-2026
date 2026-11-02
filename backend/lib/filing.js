// Keeping Mnemosyne's Project grouping in step with the Claude app.
//
// 1. Session metadata from Claude desktop (<org>/local_<id>.json for Cowork, claude-code-sessions/<acct>/<org>/local_<id>.json
//    for Claude Code): the app's own title for each session and, for Cowork, the Project (spaceId) the session belongs to.
//    When the app records a Project, that wins over the folder heuristics; the app's title replaces the first-message title.
// 2. Notes saved with record_learning under a Project name Mnemosyne did not know yet ("manual_<name>") are filed once a
//    Project with that name (or claude.ai Project alias) appears.

export function ensureFilingTables(store) {
  store.dbRun(`CREATE TABLE IF NOT EXISTS session_meta (sid TEXT PRIMARY KEY, space_id TEXT, app_space INTEGER, title TEXT, archived INTEGER, updated_at TEXT)`)
}

const projectIdFor = (sid) => 'project_' + String(sid).replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 50)
const usableTitle = (t) => t && !/^new session$/i.test(t.trim())

/** The app's view of one session, or null. */
export function sessionMeta(store, sid) {
  return store.dbGet('SELECT * FROM session_meta WHERE sid = ?', [sid])
}

/** Apply app metadata to an incoming session: returns { spaceId, title } to store. */
export function applyMetaToIngest(store, sid, spaceId, title) {
  const m = sessionMeta(store, sid)
  if (!m) return { spaceId, title }
  return {
    spaceId: m.app_space && m.space_id ? m.space_id : spaceId,
    title: usableTitle(m.title) && !String(title || '').startsWith('定时任务') ? m.title : title
  }
}

/** list: [{ sid, spaceId?, appSpace: bool, title?, archived? }] */
export function upsertSessionMeta(store, list) {
  const now = new Date().toISOString()
  let filed = 0, renamed = 0
  for (const s of list) {
    if (!s?.sid) continue
    store.dbRun(`INSERT INTO session_meta (sid, space_id, app_space, title, archived, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET space_id = excluded.space_id, app_space = excluded.app_space, title = excluded.title, archived = excluded.archived, updated_at = excluded.updated_at`,
      [s.sid, s.spaceId || null, s.appSpace ? 1 : 0, s.title || null, s.archived ? 1 : 0, now])
    const p = store.dbGet('SELECT id, name, space_id FROM projects WHERE id = ?', [projectIdFor(s.sid)])
    if (!p) continue
    if (s.appSpace && s.spaceId && p.space_id !== s.spaceId) { store.dbRun('UPDATE projects SET space_id = ? WHERE id = ?', [s.spaceId, p.id]); filed++ }
    if (usableTitle(s.title) && s.title !== p.name && !String(p.name || '').startsWith('定时任务')) { store.dbRun('UPDATE projects SET name = ? WHERE id = ?', [s.title, p.id]); renamed++ }
  }
  return { filed, renamed }
}

const norm = (s) => String(s || '').toLowerCase().replace(/[\s_\-·:：]+/g, '')

/** File "manual_<name>" notes under the Project whose name or claude.ai alias equals <name>. */
export function refileNotes(store) {
  const names = new Map()
  for (const sp of store.dbAll('SELECT id, name FROM spaces')) names.set(norm(sp.name), sp.id)
  for (const kb of store.dbAll(`SELECT name, space_id FROM projects WHERE id LIKE 'kb\\_%' ESCAPE '\\' AND space_id IS NOT NULL`)) {
    const alias = norm(String(kb.name).replace(/^Project knowledge · /, ''))
    if (alias && !names.has(alias)) names.set(alias, kb.space_id)
  }
  let filed = 0
  for (const p of store.dbAll(`SELECT id, name, workspace FROM projects WHERE id LIKE 'manual\\_%' ESCAPE '\\' AND space_id IS NULL`)) {
    const key = norm(p.workspace || String(p.name).replace(/^Notes · /, ''))
    const sid = key && names.get(key)
    if (sid) { store.dbRun('UPDATE projects SET space_id = ? WHERE id = ?', [sid, p.id]); filed++ }
  }
  return filed
}
