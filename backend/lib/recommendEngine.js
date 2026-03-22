/**
 * Cross-project knowledge recommendation engine for Mnemosyne DIKW system
 * Finds relevant Knowledge (K) and Wisdom (W) nodes from other projects
 */

/**
 * Extract keywords from content and tags
 * Identifies tool names, file extensions, themes, and programming concepts
 */
export function extractKeywords(content) {
  if (!content) return []

  // Tool names from the available tool set
  const toolNames = ['edit', 'read', 'bash', 'grep', 'glob', 'write', 'notebook',
    'find', 'search', 'list', 'create', 'delete', 'move', 'copy', 'update',
    'fetch', 'navigate', 'screenshot', 'hover', 'click', 'type', 'scroll']

  // Common file extensions
  const fileExtensionPattern = /\.([a-z0-9]+)\b/gi

  // Theme keywords
  const themeKeywords = ['debug', 'test', 'api', 'style', 'database', 'deploy',
    'algorithm', 'performance', 'refactor', 'auth', 'login', 'form', 'component',
    'ui', 'ux', 'async', 'promise', 'state', 'hook', 'query', 'schema', 'cache',
    'validation', 'error', 'logging', 'monitoring', 'security', 'optimization',
    'integration', 'migration', 'backup', 'config', 'setup', 'install', 'build',
    'compile', 'bundle', 'parse', 'serialize', 'serialize', 'encrypt', 'hash',
    'stream', 'buffer', 'event', 'listener', 'handler', 'middleware', 'router']

  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
    'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
    'she', 'it', 'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why',
    'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
    'such', 'no', 'nor', 'not', 'only', 'same', 'so', 'than', 'too', 'very'
  ])

  const keywords = new Set()

  // Extract tool names (case insensitive)
  const contentLower = content.toLowerCase()
  for (const tool of toolNames) {
    if (contentLower.includes(tool)) {
      keywords.add(tool)
    }
  }

  // Extract file extensions
  let match
  const extRegex = /\.([a-z0-9]+)\b/gi
  while ((match = extRegex.exec(content)) !== null) {
    keywords.add(`.${match[1].toLowerCase()}`)
  }

  // Extract theme keywords
  for (const theme of themeKeywords) {
    if (contentLower.includes(theme)) {
      keywords.add(theme)
    }
  }

  // Extract words from content (alphanumeric sequences 3+ chars, not stopwords)
  const wordPattern = /\b[a-z0-9]{3,}\b/gi
  while ((match = wordPattern.exec(content)) !== null) {
    const word = match[0].toLowerCase()
    if (!stopWords.has(word) && !keywords.has(word)) {
      keywords.add(word)
    }
  }

  return Array.from(keywords)
}

/**
 * Score two sets of keywords by overlap
 */
function scoreKeywordMatch(sourceKeywords, targetKeywords) {
  if (!sourceKeywords.length || !targetKeywords.length) return 0

  const sourceSet = new Set(sourceKeywords)
  const targetSet = new Set(targetKeywords)

  let matches = 0
  for (const keyword of sourceSet) {
    if (targetSet.has(keyword)) matches++
  }

  // Normalize by geometric mean of both sets
  const denominator = Math.sqrt(sourceSet.size * targetSet.size)
  return denominator > 0 ? matches / denominator : 0
}

/**
 * Recommend Knowledge and Wisdom nodes from other projects for a given project
 */
export function recommendForProject(db, projectId, limit = 5) {
  if (!db || !projectId) return []

  // Get all nodes from target project
  const projectNodesStmt = db.prepare(
    'SELECT id, content, tags FROM nodes WHERE project_id = ? AND type IN ("K", "W")'
  )
  projectNodesStmt.bind([projectId])

  const projectNodeKeywords = new Map()
  while (projectNodesStmt.step()) {
    const row = projectNodesStmt.getAsObject()
    const keywords = extractKeywords(row.content)

    // Also extract from tags
    if (row.tags) {
      try {
        const tags = JSON.parse(row.tags)
        if (Array.isArray(tags)) keywords.push(...tags)
      } catch (e) {
        // Skip tag parsing errors
      }
    }

    projectNodeKeywords.set(row.id, keywords)
  }
  projectNodesStmt.free()

  if (projectNodeKeywords.size === 0) return []

  // Merge all keywords from project
  const allProjectKeywords = new Set()
  for (const keywords of projectNodeKeywords.values()) {
    keywords.forEach(k => allProjectKeywords.add(k))
  }

  const projectKeywordArray = Array.from(allProjectKeywords)

  // Find K and W nodes from OTHER projects
  const otherNodesStmt = db.prepare(
    'SELECT id, type, project_id, content, tags FROM nodes WHERE project_id != ? AND type IN ("K", "W")'
  )
  otherNodesStmt.bind([projectId])

  const recommendations = []

  while (otherNodesStmt.step()) {
    const row = otherNodesStmt.getAsObject()
    const nodeKeywords = extractKeywords(row.content)

    // Extract from tags
    if (row.tags) {
      try {
        const tags = JSON.parse(row.tags)
        if (Array.isArray(tags)) nodeKeywords.push(...tags)
      } catch (e) {
        // Skip tag parsing errors
      }
    }

    const score = scoreKeywordMatch(projectKeywordArray, nodeKeywords)

    if (score > 0) {
      // Find matching keywords for reason
      const matchingKeywords = projectKeywordArray.filter(k =>
        nodeKeywords.includes(k)
      ).slice(0, 3)

      recommendations.push({
        node: {
          id: row.id,
          type: row.type,
          project_id: row.project_id,
          content: row.content,
          tags: row.tags ? JSON.parse(row.tags) : []
        },
        score,
        reason: `Matches: ${matchingKeywords.join(', ')}`
      })
    }
  }
  otherNodesStmt.free()

  // Sort by score descending and limit
  return recommendations
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * Find relevant Knowledge for newly imported data nodes
 */
export function recommendOnImport(db, newDataNodes, newProjectId, limit = 5) {
  if (!db || !Array.isArray(newDataNodes) || newDataNodes.length === 0) {
    return []
  }

  // Extract keywords from all new data nodes
  const allNewKeywords = new Set()
  for (const node of newDataNodes) {
    const keywords = extractKeywords(node.content || '')

    // Also extract from tags if present
    if (node.tags) {
      if (Array.isArray(node.tags)) {
        node.tags.forEach(t => allNewKeywords.add(t))
      } else if (typeof node.tags === 'string') {
        const parsed = JSON.parse(node.tags)
        if (Array.isArray(parsed)) parsed.forEach(t => allNewKeywords.add(t))
      }
    }

    keywords.forEach(k => allNewKeywords.add(k))
  }

  const newKeywordArray = Array.from(allNewKeywords)

  if (newKeywordArray.length === 0) return []

  // Find K and W nodes from existing projects (exclude new project if it exists)
  const stmt = db.prepare(
    'SELECT id, type, project_id, content, tags FROM nodes WHERE type IN ("K", "W")'
  )

  const recommendations = []

  while (stmt.step()) {
    const row = stmt.getAsObject()

    // Skip nodes from the project we're importing to
    if (newProjectId && row.project_id === newProjectId) continue

    const nodeKeywords = extractKeywords(row.content || '')

    // Extract from tags
    if (row.tags) {
      try {
        const tags = JSON.parse(row.tags)
        if (Array.isArray(tags)) nodeKeywords.push(...tags)
      } catch (e) {
        // Skip tag parsing errors
      }
    }

    const score = scoreKeywordMatch(newKeywordArray, nodeKeywords)

    if (score > 0) {
      const matchingKeywords = newKeywordArray.filter(k =>
        nodeKeywords.includes(k)
      ).slice(0, 3)

      recommendations.push({
        node: {
          id: row.id,
          type: row.type,
          project_id: row.project_id,
          content: row.content,
          tags: row.tags ? JSON.parse(row.tags) : []
        },
        score,
        reason: `Matches: ${matchingKeywords.join(', ')}`
      })
    }
  }
  stmt.free()

  return recommendations
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * Find similar nodes across all projects based on content and tag overlap
 */
export function findSimilarNodes(db, nodeId, limit = 5) {
  if (!db || !nodeId) return []

  // Get the source node
  const sourceStmt = db.prepare(
    'SELECT id, content, tags, project_id FROM nodes WHERE id = ?'
  )
  sourceStmt.bind([nodeId])

  let sourceContent = ''
  let sourceTags = []
  let sourceProjectId = null

  if (sourceStmt.step()) {
    const row = sourceStmt.getAsObject()
    sourceContent = row.content || ''
    sourceProjectId = row.project_id

    if (row.tags) {
      try {
        sourceTags = JSON.parse(row.tags)
      } catch (e) {
        // Skip tag parsing errors
      }
    }
  }
  sourceStmt.free()

  if (!sourceContent && sourceTags.length === 0) return []

  const sourceKeywords = extractKeywords(sourceContent)
  sourceKeywords.push(...sourceTags)

  if (sourceKeywords.length === 0) return []

  // Find all other nodes
  const stmt = db.prepare(
    'SELECT id, content, tags, project_id FROM nodes WHERE id != ?'
  )
  stmt.bind([nodeId])

  const recommendations = []

  while (stmt.step()) {
    const row = stmt.getAsObject()
    const nodeKeywords = extractKeywords(row.content || '')

    if (row.tags) {
      try {
        const tags = JSON.parse(row.tags)
        if (Array.isArray(tags)) nodeKeywords.push(...tags)
      } catch (e) {
        // Skip tag parsing errors
      }
    }

    const score = scoreKeywordMatch(sourceKeywords, nodeKeywords)

    if (score > 0) {
      const matchingKeywords = sourceKeywords.filter(k =>
        nodeKeywords.includes(k)
      ).slice(0, 3)

      recommendations.push({
        node: {
          id: row.id,
          content: row.content,
          tags: row.tags ? JSON.parse(row.tags) : [],
          project_id: row.project_id
        },
        score,
        reason: `Matches: ${matchingKeywords.join(', ')}`
      })
    }
  }
  stmt.free()

  return recommendations
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
