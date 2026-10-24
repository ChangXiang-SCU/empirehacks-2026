import { v4 as uuidv4 } from 'uuid'
import { cleanMessage, makeTitle, workspaceFromCwd } from '../text.js'

/**
 * Import a Codex rollout JSONL (session_meta + response_item events).
 * Returns { sessionId, projectName, title, cwd, workspace, nodes[] }
 */
export function importCodex(fileContent, opts = {}) {
  const maxChars = opts.maxChars || 5000
  const nodes = []
  const now = new Date().toISOString()

  let sessionId = null
  let cwd = null
  let model = null
  let firstUserMsg = null
  let metaTitle = null

  for (const line of fileContent.split('\n')) {
    if (!line.trim()) continue
    let entry
    try { entry = JSON.parse(line) } catch { continue }

    if (entry.type === 'session_meta') {
      const p = entry.payload || {}
      sessionId = sessionId || p.id
      cwd = cwd || p.cwd
      model = model || p.model_provider
      metaTitle = metaTitle || p.title || null
      continue
    }
    if (entry.type !== 'response_item') continue

    const p = entry.payload || {}
    const role = p.role
    if (role !== 'user' && role !== 'assistant') continue

    const parts = (p.content || [])
      .filter(c => c && (c.type === 'input_text' || c.type === 'output_text' || c.type === 'text'))
      .map(c => role === 'user' ? cleanMessage(c.text) : (c.text || '').trim())
      .filter(t => t && t.length >= 4)
    if (!parts.length) continue
    const text = parts.join('\n')

    if (role === 'user' && !firstUserMsg) firstUserMsg = text

    if (nodes.length > 0) {
      const last = nodes[nodes.length - 1]
      if (last.dtype === role && last.content.slice(role.length + 3, role.length + 83) === text.slice(0, 80)) continue
    }

    nodes.push({
      id: `node_${uuidv4()}`,
      type: 'D',
      projectId: 'unclassified',
      sourcePlatform: 'codex',
      content: `[${role}] ${text.substring(0, maxChars)}`,
      tags: [role, 'codex', ...(model ? [model] : [])],
      dtype: role,
      mcpSource: null,
      sharedProjects: [],
      createdAt: entry.timestamp || opts.fileTime || now
    })
  }

  const workspace = workspaceFromCwd(cwd)
  const title = makeTitle(firstUserMsg) || makeTitle(metaTitle) || (workspace ? `Codex · ${workspace}` : 'Codex session')
  return { sessionId: sessionId || `codex_${Date.now()}`, projectName: title, title, cwd, workspace, nodes }
}
