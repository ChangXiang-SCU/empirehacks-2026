import { v4 as uuidv4 } from 'uuid'

/**
 * Import Claude.ai web export
 * Handles:
 * 1. Official export: {conversations: [{uuid, name, conversation_content: [{sender, text}]}]}
 * 2. Single conversation: {conversation_content: [...]}
 * 3. Array of messages: [{sender/role, text/content}]
 */
export function importClaudeWeb(data) {
  const nodes = []
  const now = new Date().toISOString()

  function parseMessages(messages, convTitle) {
    if (!Array.isArray(messages)) return
    messages.forEach(msg => {
      const text = msg.text || msg.content || ''
      if (typeof text !== 'string' || text.length < 10) return
      const role = msg.sender || msg.role || 'unknown'
      if (role === 'system') return

      nodes.push({
        id: `node_${uuidv4()}`, type: 'D',
        projectId: 'unclassified',
        sourcePlatform: 'claude-web',
        content: `[${role}] ${text.substring(0, 800)}`,
        tags: [role, 'claude-web', ...(convTitle ? [convTitle.slice(0, 30)] : [])],
        dtype: role, mcpSource: null,
        sharedProjects: [],
        createdAt: msg.created_at ? new Date(msg.created_at).toISOString() : now
      })
    })
  }

  // Format 1: Official export with conversations array
  if (data.conversations && Array.isArray(data.conversations)) {
    data.conversations.forEach(conv => {
      parseMessages(conv.conversation_content || conv.messages, conv.name || conv.title)
    })
    return nodes
  }

  // Format 2: Single conversation
  if (data.conversation_content || data.messages) {
    parseMessages(data.conversation_content || data.messages, data.name || data.title)
    return nodes
  }

  // Format 3: Direct array of messages
  if (Array.isArray(data)) {
    parseMessages(data, null)
    return nodes
  }

  return nodes
}
