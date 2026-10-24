import { v4 as uuidv4 } from 'uuid'
import { cleanMessage, makeTitle, workspaceFromCwd } from '../text.js'

/**
 * Import a Claude Code transcript JSONL (~/.claude/projects/<cwd>/<session>.jsonl)
 * or a Cowork / Agent SDK audit log (local-agent-mode-sessions/.../audit.jsonl).
 * Both use { type: 'user'|'assistant', message: { content } } events.
 * Only user/assistant text is kept; tool calls, tool results and thinking are dropped.
 * Returns { sessionId, projectName, title, cwd, workspace, nodes[] }
 */
export function importClaudeCode(jsonlContent, opts = {}) {
  const platform = opts.platform || 'claude-code'
  const maxChars = opts.maxChars || 5000
  const nodes = []
  const now = new Date().toISOString()

  let sessionId = null
  let cwd = null
  let firstUserMsg = null
  let summary = null
  let lastTs = null
  const toIso = (v) => {
    if (v == null || v === '') return null
    const d = new Date(typeof v === 'number' && v < 1e12 ? v * 1000 : v)
    return isNaN(d) ? null : d.toISOString()
  }

  for (const line of jsonlContent.split('\n')) {
    if (!line.trim()) continue
    let event
    try { event = JSON.parse(line) } catch { continue }

    if (!sessionId) sessionId = event.sessionId || event.session_id || null
    const ts = toIso(event.timestamp) || toIso(event._audit_timestamp)
    if (ts) lastTs = ts
    if (!cwd && event.cwd) cwd = event.cwd
    if (event.type === 'summary' && event.summary) { summary = event.summary; continue }
    if (event.type === 'custom-title' && event.customTitle) { summary = event.customTitle; continue }

    const eventType = event.type
    if (eventType !== 'user' && eventType !== 'assistant') continue
    if (event.isMeta || event.isSidechain || event.parent_tool_use_id) continue
    if (event.isReplay) continue

    const msg = event.message
    if (!msg) continue
    const role = msg.role || eventType

    let text = ''
    if (typeof msg.content === 'string') text = msg.content
    else if (Array.isArray(msg.content)) {
      text = msg.content.filter(c => c && c.type === 'text' && c.text).map(c => c.text).join('\n')
    }
    if (role === 'user') text = cleanMessage(text)
    else text = (text || '').trim()
    if (!text || text.length < 4) continue

    if (role === 'user' && !firstUserMsg) firstUserMsg = text

    if (nodes.length > 0) {
      const last = nodes[nodes.length - 1]
      if (last.dtype === role && last.content.slice(role.length + 3, role.length + 83) === text.slice(0, 80)) continue
    }

    nodes.push({
      id: `node_${uuidv4()}`,
      type: 'D',
      projectId: 'unclassified',
      sourcePlatform: platform,
      content: `[${role}] ${text.substring(0, maxChars)}`,
      tags: [role, platform],
      dtype: role,
      mcpSource: null,
      sharedProjects: [],
      createdAt: ts || lastTs || opts.fileTime || now
    })
  }

  if (!sessionId) sessionId = opts.fallbackId || `cc_${Date.now()}`
  const title = makeTitle(summary || firstUserMsg) || (platform === 'cowork' ? 'Cowork session' : 'Claude Code session')
  return { sessionId, projectName: title, title, cwd, workspace: workspaceFromCwd(cwd), nodes }
}
