import { v4 as uuidv4 } from 'uuid'

export function importChatGPT(conversation) {
  const nodes = []
  const now = new Date().toISOString()

  if (!Array.isArray(conversation)) {
    return nodes
  }

  conversation.forEach((msg, idx) => {
    if (!msg.content) return

    const nodeId = `node_${uuidv4()}`
    const content = typeof msg.content === 'string'
      ? msg.content.substring(0, 500)
      : JSON.stringify(msg.content).substring(0, 500)

    nodes.push({
      id: nodeId,
      type: 'D',
      projectId: 'unclassified',
      sourcePlatform: 'chatgpt',
      content: `[${msg.role || 'unknown'}] ${content}`,
      tags: [msg.role || 'message', 'chatgpt'],
      dtype: msg.role,
      mcpSource: null,
      sharedProjects: [],
      createdAt: msg.date ? new Date(msg.date).toISOString() : now
    })
  })

  return nodes
}
