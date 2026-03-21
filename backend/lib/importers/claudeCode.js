import { v4 as uuidv4 } from 'uuid'

export function importClaudeCode(jsonlContent) {
  const nodes = []
  const now = new Date().toISOString()
  const lines = jsonlContent.trim().split('\n')

  lines.forEach((line, idx) => {
    if (!line.trim()) return

    try {
      const event = JSON.parse(line)
      const nodeId = `node_${uuidv4()}`

      let content = ''
      let dtype = 'event'
      const tags = ['claude-code']

      if (event.type === 'tool_use') {
        dtype = 'tool-call'
        content = `Tool: ${event.tool_name || 'unknown'}`
        if (event.input) {
          content += ` - ${JSON.stringify(event.input).substring(0, 200)}`
        }
        tags.push('tool-use', event.tool_name || '')
      } else if (event.type === 'text') {
        dtype = 'message'
        content = event.text?.substring(0, 500) || ''
        tags.push('text')
      } else if (event.type === 'tool_result') {
        dtype = 'tool-result'
        content = `Result: ${event.content?.substring(0, 300) || 'success'}`
        tags.push('tool-result')
      } else {
        content = JSON.stringify(event).substring(0, 300)
      }

      nodes.push({
        id: nodeId,
        type: 'D',
        projectId: 'unclassified',
        sourcePlatform: 'claude-code',
        content,
        tags,
        dtype,
        mcpSource: null,
        sharedProjects: [],
        createdAt: event.timestamp || now
      })
    } catch (e) {
      console.error('Error parsing JSONL line:', e)
    }
  })

  return nodes
}
