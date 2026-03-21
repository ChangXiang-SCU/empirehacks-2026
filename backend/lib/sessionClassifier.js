export function classifySession(sessionData, projects) {
  const features = extractFeatures(sessionData)
  const ruleMatch = ruleBasedMatch(features, projects)

  if (ruleMatch.confidence > 0.7) {
    return ruleMatch
  }

  return {
    projectId: null,
    confidence: 0,
    reasoning: 'No confident match found'
  }
}

function extractFeatures(session) {
  const features = {
    filePaths: [],
    topics: [],
    tools: [],
    keywords: []
  }

  if (typeof session === 'string') {
    const fileMatch = session.match(/\b[\w.\-/\\]+\.(java|py|js|ts|docx|md|txt|csv)\b/gi)
    if (fileMatch) {
      features.filePaths = fileMatch
    }

    const toolMatches = session.match(/\b(git|github|search|database|api|slack|scholar)\b/gi)
    if (toolMatches) {
      features.tools = [...new Set(toolMatches.map(t => t.toLowerCase()))]
    }
  }

  return features
}

function ruleBasedMatch(features, projects) {
  let bestMatch = null
  let bestScore = 0

  projects.forEach(project => {
    let score = 0

    // Match project keywords
    const projectNameLower = project.name.toLowerCase()

    features.filePaths.forEach(path => {
      if (projectNameLower.includes('cs2110') && path.match(/fibonacci|algorithm|java/i)) {
        score += 0.3
      }
      if (projectNameLower.includes('govt') && path.match(/carbon|tax|essay|docx/i)) {
        score += 0.3
      }
      if (projectNameLower.includes('hackathon') && path.match(/hack|brief|api|architecture/i)) {
        score += 0.3
      }
    })

    features.tools.forEach(tool => {
      if (projectNameLower.includes('cs2110') && tool === 'github') {
        score += 0.2
      }
      if (projectNameLower.includes('govt') && tool === 'scholar') {
        score += 0.2
      }
      if (projectNameLower.includes('hackathon') && tool === 'slack') {
        score += 0.2
      }
    })

    if (score > bestScore) {
      bestScore = score
      bestMatch = {
        projectId: project.id,
        confidence: Math.min(bestScore, 0.95),
        reasoning: `Matched on keywords and tools (score: ${score})`
      }
    }
  })

  return bestMatch || { projectId: null, confidence: 0, reasoning: 'No match' }
}
