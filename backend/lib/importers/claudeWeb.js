import { v4 as uuidv4 } from 'uuid'

export function importClaudeWeb(data) {
  const nodes = []
  const now = new Date().toISOString()

  if (!data.conversations || !Array.isArray(data.conversations)) {
    return nodes
  }

  data.conversations.forEach(conv => {
    if (!conv.conversation_content || !Array.isArray(conv.conversation_content)) {
      return
    }

    conv.conversation_content.forEach(msg => {
      if (!msg.text) return

      const nodeId = `node_${uuidv4()}`
      const content = msg.text.substring(0, 500)

      nodes.push({
        id: nodeId,
        type: 'D',
        projectId: 'unclassified',
        sourcePlatform: 'claude-web',
        content,
        tags: [msg.sender || 'message', 'claude-web'],
        dtype: msg.sender,
        mcpSource: null,
        sharedProjects: [],
        createdAt: msg.created_at ? new Date(msg.created_at).toISOString() : now
      })
    })
  })

  return nodes
}
