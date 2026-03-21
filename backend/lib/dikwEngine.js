import { v4 as uuidv4 } from 'uuid'

export function dataToInfo(dataNodes, projectContext = {}) {
  return dataNodes.map(node => ({
    id: `info_${uuidv4()}`,
    type: 'I',
    projectId: node.projectId,
    sourcePlatform: node.sourcePlatform,
    content: `Context: ${node.content}. In context of ${projectContext.name || 'project'}: identifies pattern in approach.`,
    tags: [...(node.tags || []), 'contextual'],
    dtype: null,
    mcpSource: node.mcpSource,
    sharedProjects: node.sharedProjects,
    createdAt: new Date().toISOString()
  }))
}

export function infoToKnowledge(infoNodes) {
  return infoNodes.map(node => ({
    id: `know_${uuidv4()}`,
    type: 'K',
    projectId: node.projectId,
    sourcePlatform: node.sourcePlatform,
    content: `Skill: Extract reusable pattern from ${node.content}. Apply when similar conditions present.`,
    tags: [...(node.tags || []), 'skill', 'reusable'],
    dtype: null,
    mcpSource: node.mcpSource,
    sharedProjects: node.sharedProjects,
    createdAt: new Date().toISOString()
  }))
}

export function knowledgeToWisdom(knowledgeNodes) {
  return knowledgeNodes.map(node => ({
    id: `wisdom_${uuidv4()}`,
    type: 'W',
    projectId: node.projectId,
    sourcePlatform: node.sourcePlatform,
    content: `Wisdom: ${node.content} BUT consider trade-offs: time constraints, team capacity, external dependencies.`,
    tags: [...(node.tags || []), 'meta-judgment', 'context-dependent'],
    dtype: null,
    mcpSource: node.mcpSource,
    sharedProjects: node.sharedProjects,
    createdAt: new Date().toISOString()
  }))
}

export function transformDIKW(database, nodeId) {
  const node = database.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId)
  if (!node) return null

  const now = new Date().toISOString()
  const insertNode = database.prepare(`
    INSERT INTO nodes (id, type, project_id, source_platform, content, tags, dtype, mcp_source, shared_projects, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  if (node.type === 'D') {
    // D -> I
    const infoNode = {
      id: `info_${uuidv4()}`,
      type: 'I',
      projectId: node.project_id,
      sourcePlatform: node.source_platform,
      content: `Insight from data: ${node.content}. Pattern recognition applied.`,
      tags: JSON.stringify([...JSON.parse(node.tags || '[]'), 'auto-transformed']),
      dtype: null,
      mcpSource: node.mcp_source,
      sharedProjects: node.shared_projects
    }
    insertNode.run(
      infoNode.id, infoNode.type, infoNode.projectId, infoNode.sourcePlatform,
      infoNode.content, infoNode.tags, infoNode.dtype, infoNode.mcpSource,
      infoNode.sharedProjects, now, now
    )
    return infoNode.id
  }

  return null
}
