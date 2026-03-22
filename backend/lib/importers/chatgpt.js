import { v4 as uuidv4 } from 'uuid'

/**
 * Import ChatGPT conversations export
 * Handles multiple formats:
 * 1. Official export: [{title, mapping: {id: {message: {content: {parts}}}}}]
 * 2. Simple format: [{role, content}]
 * 3. Shared link JSON: {title, conversation_turns: [...]}
 */
export function importChatGPT(data) {
  const nodes = []
  const now = new Date().toISOString()

  // Format 1: Official ChatGPT data export (conversations.json)
  if (Array.isArray(data) && data[0]?.mapping) {
    data.forEach(conv => {
      const title = conv.title || 'Untitled'
      const mapping = conv.mapping || {}
      const createTime = conv.create_time
        ? new Date(conv.create_time * 1000).toISOString() : now

      Object.values(mapping).forEach(entry => {
        const msg = entry?.message
        if (!msg || !msg.content?.parts) return
        const role = msg.author?.role || 'unknown'
        if (role === 'system') return // skip system prompts

        const text = msg.content.parts
          .filter(p => typeof p === 'string')
          .join('\n')
          .trim()
        if (!text || text.length < 10) return

        const content = text.substring(0, 800)
        const nodeId = `node_${uuidv4()}`
        const msgTime = msg.create_time
          ? new Date(msg.create_time * 1000).toISOString() : createTime

        nodes.push({
          id: nodeId, type: 'D',
          projectId: 'unclassified',
          sourcePlatform: 'chatgpt',
          content: `[${role}] ${content}`,
          tags: [role, 'chatgpt', title.slice(0, 30)],
          dtype: role, mcpSource: null,
          sharedProjects: [], createdAt: msgTime
        })
      })
    })
    return nodes
  }

  // Format 2: Simple array [{role, content}]
  if (Array.isArray(data)) {
    data.forEach(msg => {
      if (!msg.content) return
      const content = typeof msg.content === 'string'
        ? msg.content.substring(0, 800)
        : JSON.stringify(msg.content).substring(0, 800)
      if (content.length < 10) return

      nodes.push({
        id: `node_${uuidv4()}`, type: 'D',
        projectId: 'unclassified',
        sourcePlatform: 'chatgpt',
        content: `[${msg.role || 'unknown'}] ${content}`,
        tags: [msg.role || 'message', 'chatgpt'],
        dtype: msg.role, mcpSource: null,
        sharedProjects: [],
        createdAt: msg.date ? new Date(msg.date).toISOString() : now
      })
    })
    return nodes
  }

  // Format 3: Single conversation object with conversation_turns
  if (data.conversation_turns || data.messages) {
    const turns = data.conversation_turns || data.messages || []
    turns.forEach(turn => {
      const text = turn.text || turn.content || ''
      if (text.length < 10) return
      nodes.push({
        id: `node_${uuidv4()}`, type: 'D',
        projectId: 'unclassified',
        sourcePlatform: 'chatgpt',
        content: `[${turn.role || turn.author || 'unknown'}] ${text.substring(0, 800)}`,
        tags: [turn.role || 'message', 'chatgpt'],
        dtype: turn.role, mcpSource: null,
        sharedProjects: [], createdAt: now
      })
    })
    return nodes
  }

  return nodes
}
