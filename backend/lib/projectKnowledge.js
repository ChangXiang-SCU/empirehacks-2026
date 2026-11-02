// Claude Project material: each claude.ai Project's description, custom instructions and knowledge files
// (cached by Claude desktop in <org>/.project-cache/<uuid>/), plus Cowork's per-Project memory notes
// (<org>/spaces/<id>/memory/*.md). The collector sends them to POST /<secret>/api/knowledge.
//
// Stored as one pseudo-session per Project ("kb_<uuid>" / "kbmem_<spaceId>", platform "claude-project"),
// filed under the Project's space, so search_memory finds the content and get_project_context shows it first.
import crypto from 'crypto'

export const KB_PLATFORM = 'claude-project'
const CHUNK = 3500
const MAX_TEXT = 150000            // per file
const PDF_TIMEOUT_MS = 60000

/** Mask numbers that look like ID, bank or card numbers before anything is stored. */
export function redactIds(s) {
  return String(s || '')
    .replace(/(?<!\w)(?<!\d\.)\d{17}[\dXx](?!\w)(?!\.\d)/g, '[ID number removed]')
    .replace(/(?<!\w)(?<!\d\.)(?:\d[ -]?){15,19}\d(?!\w)(?!\.\d)/g, m => (m.replace(/\D/g, '').length >= 16 ? '[account number removed]' : m))
}

/** Split long text at headings / blank lines into chunks of about CHUNK chars. */
export function chunkText(text, max = CHUNK) {
  const t = String(text || '').replace(/\r\n/g, '\n').trim()
  if (t.length <= max) return t ? [t] : []
  const out = []
  let cur = ''
  for (const block of t.split(/\n(?=#{1,4} )|\n{2,}/)) {
    if (cur && cur.length + block.length + 2 > max) { out.push(cur.trim()); cur = '' }
    if (block.length > max) {
      for (let i = 0; i < block.length; i += max) out.push(block.slice(i, i + max).trim())
    } else cur += (cur ? '\n\n' : '') + block
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter(Boolean)
}

let unpdf = null
async function pdfText(buf) {
  if (unpdf === null) { try { unpdf = await import('unpdf') } catch { unpdf = false } }
  if (!unpdf) return null
  const work = (async () => {
    const pdf = await unpdf.getDocumentProxy(new Uint8Array(buf))
    const { text, totalPages } = await unpdf.extractText(pdf, { mergePages: true })
    return { text: String(text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), pages: totalPages }
  })()
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('pdf timeout')), PDF_TIMEOUT_MS))
  return Promise.race([work, timeout])
}

const iso = (v, fallback) => {
  const d = v ? new Date(v) : null
  return d && !isNaN(d) ? d.toISOString() : fallback
}

/**
 * store: { dbAll, dbGet, dbRun, save }
 * item:  { kind: 'project', uuid, name, description, instructions, syncedAt, docs: [{name, text, mtime}], files: [{name, size, mtime, b64?}] }
 *    or  { kind: 'memory', spaceId, files: [{name, text, mtime}] }
 * A project item with stub: true (just uuid and name, e.g. from the claude.ai Projects page) only registers the Project;
 * it is ignored when the Project's material is already stored.
 */
export async function ingestKnowledge(store, item) {
  const hash = crypto.createHash('sha1').update(JSON.stringify(item)).digest('hex')
  const now = new Date().toISOString()

  let projectId, name, spaceId, nodes = []
  if (item.kind === 'project') {
    if (!item.uuid || !item.name) throw new Error('uuid and name required')
    if (item.stub && store.dbGet('SELECT 1 AS x FROM nodes WHERE project_id = ? LIMIT 1', ['kb_' + item.uuid])) return { skipped: 'exists', projectId: 'kb_' + item.uuid }
    spaceId = store.dbGet(`SELECT id FROM spaces WHERE project_uuids LIKE ?`, [`%"${item.uuid}"%`])?.id
    // Claude desktop mirrors each Cowork Project to claude.ai under the same name, not always with the uuid in spaces.json
    if (!spaceId) {
      const key = String(item.name).trim().toLowerCase()
      const same = store.dbAll('SELECT id, name FROM spaces').filter(sp => String(sp.name).trim().toLowerCase() === key)
      spaceId = (same.find(sp => !sp.id.startsWith('cp_')) || same[0])?.id
    }
    if (!spaceId) {
      // A claude.ai Project with no Cowork space: give it a space of its own so it is listed like the others
      spaceId = 'cp_' + item.uuid
      store.dbRun(`INSERT INTO spaces (id, name, project_uuids, folders, updated_at) VALUES (?, ?, ?, '[]', ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`, [spaceId, item.name, JSON.stringify([item.uuid]), now])
    }
    projectId = 'kb_' + item.uuid
    name = `Project knowledge · ${item.name}`
  } else if (item.kind === 'memory') {
    if (!item.spaceId) throw new Error('spaceId required')
    spaceId = item.spaceId
    const spName = store.dbGet('SELECT name FROM spaces WHERE id = ?', [spaceId])?.name || spaceId
    projectId = 'kbmem_' + spaceId
    name = `Project memory · ${spName}`
  } else throw new Error('unknown kind')

  const existing = store.dbGet('SELECT id, content_hash, space_id FROM projects WHERE id = ?', [projectId])
  if (existing && existing.content_hash === hash && existing.space_id === spaceId) return { skipped: 'unchanged', projectId }

  const created = iso(item.syncedAt, now)
  const add = (type, content, tags, createdAt) => nodes.push({ type, content: redactIds(content), tags, createdAt: createdAt || created })

  if (item.kind === 'project') {
    const fileLines = []
    for (const d of item.docs || []) fileLines.push(`${d.name} (${(d.text || '').length} chars)`)
    const parsed = []
    for (const f of item.files || []) {
      const ext = (f.name.split('.').pop() || '').toLowerCase()
      if (typeof f.text === 'string' && f.text.trim()) {
        parsed.push({ label: f.name, text: f.text.slice(0, MAX_TEXT), mtime: f.mtime })
        fileLines.push(`${f.name} (${f.text.length} chars)`)
        continue
      }
      if (ext === 'pdf' && f.b64) {
        try {
          const r = await pdfText(Buffer.from(f.b64, 'base64'))
          if (r && r.text) {
            const clean = redactIds(r.text)
            const first = (clean.split('\n').map(s => s.trim()).find(s => s.length >= 4) || '').split(/(?<=[.!?。！？])\s/)[0]
            const title = first.length > 60 ? first.slice(0, 60).replace(/\s+\S*$/, '') + '…' : first
            const label = `${f.name}${title ? ` 「${title}」` : ''}`
            parsed.push({ label, text: clean.slice(0, MAX_TEXT), mtime: f.mtime })
            fileLines.push(`${label} (PDF, ${r.pages} pages)`)
            continue
          }
        } catch (e) { console.warn(`knowledge: pdf ${f.name}: ${e.message}`) }
        fileLines.push(`${f.name} (PDF, text not extracted)`)
      } else fileLines.push(`${f.name} (${ext || 'file'}, ${Math.round((f.size || 0) / 1024)} KB, not imported)`)
    }
    add('I', [
      `Claude Project「${item.name}」 (claude.ai project ${item.uuid})`,
      item.description ? `Description: ${item.description}` : '',
      item.instructions ? `Has custom instructions (see the instructions entry).` : 'No custom instructions.',
      fileLines.length ? `Knowledge files (${fileLines.length}):\n${fileLines.map(l => '- ' + l).join('\n')}`
        : item.stub ? 'Knowledge files are not on this computer yet (open the Project once in Claude desktop to import them).' : 'No knowledge files cached.'
    ].filter(Boolean).join('\n'), ['project-knowledge', 'overview'])
    if (item.instructions) {
      const parts = chunkText(item.instructions)
      parts.forEach((p, i) => add('W', `[Custom instructions of Claude Project「${item.name}」${parts.length > 1 ? ` (${i + 1}/${parts.length})` : ''}]\n${p}`, ['project-knowledge', 'instructions']))
    }
    for (const d of item.docs || []) {
      const parts = chunkText(String(d.text || '').slice(0, MAX_TEXT))
      parts.forEach((p, i) => add('K', `[Project doc · ${item.name} · ${d.name}${parts.length > 1 ? ` (${i + 1}/${parts.length})` : ''}]\n${p}`, ['project-knowledge', 'file:' + d.name], iso(d.mtime, created)))
    }
    for (const f of parsed) {
      const parts = chunkText(f.text)
      parts.forEach((p, i) => add('K', `[Project file · ${item.name} · ${f.label}${parts.length > 1 ? ` (${i + 1}/${parts.length})` : ''}]\n${p}`, ['project-knowledge', 'file:' + f.label], iso(f.mtime, created)))
    }
  } else {
    const spName = name.replace(/^Project memory · /, '')
    const files = [...(item.files || [])].sort((a, b) => (a.name === 'MEMORY.md' ? -1 : b.name === 'MEMORY.md' ? 1 : a.name.localeCompare(b.name)))
    for (const f of files) {
      const parts = chunkText(String(f.text || '').slice(0, MAX_TEXT))
      parts.forEach((p, i) => add('K', `[Project memory · ${spName} · ${f.name}${parts.length > 1 ? ` (${i + 1}/${parts.length})` : ''}]\n${p}`, ['project-memory', 'file:' + f.name], iso(f.mtime, now)))
    }
  }

  // Replace this Project's entries
  store.dbRun(`DELETE FROM connections WHERE from_node_id IN (SELECT id FROM nodes WHERE project_id = ?) OR to_node_id IN (SELECT id FROM nodes WHERE project_id = ?)`, [projectId, projectId])
  store.dbRun('DELETE FROM nodes WHERE project_id = ?', [projectId])
  if (existing) {
    store.dbRun('UPDATE projects SET name = ?, platform = ?, space_id = ?, content_hash = NULL, updated_at = ?, last_ingest = ? WHERE id = ?', [name, KB_PLATFORM, spaceId, now, now, projectId])
  } else {
    store.dbRun(`INSERT INTO projects (id, name, color, created_at, updated_at, platform, space_id, content_hash, last_ingest, space_checked)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`, [projectId, name, '#00897b', now, now, KB_PLATFORM, spaceId, now, now])
  }
  const short = projectId.replace(/^kb(mem)?_/, '').replace(/-/g, '')  // full id: uuids created close together share long prefixes
  nodes.forEach((n, i) => {
    store.dbRun(`INSERT INTO nodes (id, type, project_id, source_platform, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [`${projectId.startsWith('kbmem_') ? 'pmem' : 'pdoc'}_${short}_${i}`, n.type, projectId, KB_PLATFORM, n.content, JSON.stringify(n.tags), n.createdAt, now])
  })
  // Only now mark the content as stored, so a failed write is retried on the next sync
  store.dbRun('UPDATE projects SET content_hash = ? WHERE id = ?', [hash, projectId])
  store.save()
  return { projectId, spaceId, name: name.replace(/^Project (knowledge|memory) · /, ''), nodes: nodes.length }
}

/** Fold a claude.ai Project's own space ("cp_<uuid>") into the Cowork space that now links that uuid. */
export function reconcileProjectSpaces(store) {
  let merged = 0
  for (const cp of store.dbAll(`SELECT id FROM spaces WHERE id LIKE 'cp\\_%' ESCAPE '\\'`)) {
    const uuid = cp.id.slice(3)
    const real = store.dbGet(`SELECT id FROM spaces WHERE id NOT LIKE 'cp\\_%' ESCAPE '\\' AND project_uuids LIKE ?`, [`%"${uuid}"%`])
    if (!real) continue
    store.dbRun('UPDATE projects SET space_id = ? WHERE space_id = ?', [real.id, cp.id])
    store.dbRun('DELETE FROM spaces WHERE id = ?', [cp.id])
    merged++
  }
  return merged
}
