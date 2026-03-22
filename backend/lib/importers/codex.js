import { v4 as uuidv4 } from 'uuid'

/**
 * Import Codex CLI session rollout JSONL files
 * Returns { sessionId, projectName, nodes[] }
 */
export function importCodex(fileContent) {
  const nodes = []
  const now = new Date().toISOString()

  const lines = fileContent.split('\n').filter(l => l.trim())
  let sessionId = null
  let cwd = null
  let model = null
  let firstUserMsg = null

  const SYSTEM_PREFIXES = [
    '<permissions', '<app-context', '<collaboration_mode',
    '<skills_instructions', '<environment_context',
    '<tool_', '<system', 'You are ', '<turn_aborted',
    '<environment_context', '<cwd>'
  ]

  for (const line of lines) {
    let entry
    try { entry = JSON.parse(line) } catch { continue }

    if (entry.type === 'session_meta') {
      const p = entry.payload || {}
      sessionId = p.id
      cwd = p.cwd
      model = p.model_provider
      continue
    }

    if (entry.type === 'response_item') {
      const p = entry.payload || {}
      const role = p.role
      if (!role || role === 'developer' || role === 'system') continue

      const contentParts = p.content || []
      const textParts = contentParts
        .filter(c => c.type === 'input_text' || c.type === 'output_text' || c.type === 'text')
        .map(c => c.text || '')
        .filter(t => {
          if (t.length < 15) return false
          return !SYSTEM_PREFIXES.some(prefix => t.trimStart().startsWith(prefix))
        })

      if (textParts.length === 0) continue
      const text = textParts.join('\n').substring(0, 5000)

      // Remember first user message for project naming
      if (role === 'user' && !firstUserMsg) {
        firstUserMsg = text.substring(0, 80).replace(/\n/g, ' ')
      }

      // Dedup adjacent identical messages
      if (nodes.length > 0) {
        const lastContent = nodes[nodes.length - 1].content?.replace(/^\[(user|assistant)\]\s*/, '')
        if (lastContent?.substring(0, 80) === text.substring(0, 80)) continue
      }

      nodes.push({
        id: `node_${uuidv4()}`,
        type: 'D',
        projectId: 'unclassified',
        sourcePlatform: 'codex',
        content: `[${role}] ${text}`,
        tags: [role, 'codex', ...(model ? [model] : [])],
        dtype: role,
        mcpSource: null,
        sharedProjects: [],
        createdAt: entry.timestamp || now
      })
    }
  }

  // Derive a project name from context
  const cwdShort = cwd ? cwd.replace(/\\/g, '/').split('/').pop() : null
  const projectName = firstUserMsg
    ? `Codex: ${firstUserMsg.substring(0, 50)}${firstUserMsg.length > 50 ? '...' : ''}`
    : cwdShort
      ? `Codex: ${cwdShort}`
      : 'Codex Session'

  return {
    sessionId: sessionId || `codex_${Date.now()}`,
    projectName,
    nodes
  }
}