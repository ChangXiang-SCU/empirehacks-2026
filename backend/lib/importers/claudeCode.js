import { v4 as uuidv4 } from 'uuid'

/**
 * Import Claude Code session JSONL files
 * Only extracts meaningful user/assistant text messages
 * Returns { sessionId, projectName, nodes[] }
 */
export function importClaudeCode(jsonlContent) {
  const nodes = []
  const now = new Date().toISOString()
  const lines = jsonlContent.trim().split('\n')

  let sessionId = null
  let firstUserMsg = null

  for (const line of lines) {
    if (!line.trim()) continue
    let event
    try { event = JSON.parse(line) } catch { continue }

    const eventType = event.type

    // Extract sessionId from queue-operation if available
    if (eventType === 'queue-operation' && event.sessionId) {
      if (!sessionId) sessionId = event.sessionId
      continue // Skip queue events as nodes
    }

    // Skip non-message events entirely
    if (eventType !== 'user' && eventType !== 'assistant') continue

    // Extract text content from the message
    const msg = event.message
    if (!msg) continue

    let textContent = ''
    const role = msg.role || eventType

    if (typeof msg.content === 'string') {
      textContent = msg.content
    } else if (Array.isArray(msg.content)) {
      // Extract only text blocks, skip tool_use and tool_result
      const textParts = msg.content
        .filter(c => c.type === 'text')
        .map(c => c.text || '')
        .filter(t => t.length > 0)
      textContent = textParts.join('\n')
    }

    if (!textContent || textContent.length < 15) continue

    // Skip system prompts / boilerplate
    const SKIP_PREFIXES = [
      '<permissions', '<app-context', '<collaboration_mode',
      '<skills_instructions', '<environment_context',
      '<tool_', '<system', 'You are ', '<?xml',
      '<turn_aborted', '<environment_context', '<cwd>'
    ]
    if (SKIP_PREFIXES.some(p => textContent.trimStart().startsWith(p))) continue

    // Remember first user message for project naming
    if (role === 'user' && !firstUserMsg) {
      firstUserMsg = textContent.substring(0, 80).replace(/\n/g, ' ')
    }

    // Truncate for storage
    const content = `[${role}] ${textContent.substring(0, 5000)}`

    // Dedup adjacent identical messages
    if (nodes.length > 0) {
      const lastContent = nodes[nodes.length - 1].content?.replace(/^\[(user|assistant)\]\s*/, '')
      if (lastContent?.substring(0, 80) === textContent.substring(0, 80)) continue
    }

    nodes.push({
      id: `node_${uuidv4()}`,
      type: 'D',
      projectId: 'unclassified',
      sourcePlatform: 'claude-code',
      content,
      tags: [role, 'claude-code'],
      dtype: role,
      mcpSource: null,
      sharedProjects: [],
      createdAt: event.timestamp || now
    })
  }

  // Derive session ID and project name
  if (!sessionId) {
    // Try to extract from file content or generate one
    sessionId = `cc_${Date.now()}`
  }

  const projectName = firstUserMsg
    ? `Claude: ${firstUserMsg.substring(0, 50)}${firstUserMsg.length > 50 ? '...' : ''}`
    : 'Claude Code Session'

  return { sessionId, projectName, nodes }
}
