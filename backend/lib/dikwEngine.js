import { v4 as uuidv4 } from 'uuid'

// ── Smart DIKW Transformation Engine ──
// Transforms nodes up the DIKW pyramid using rule-based content analysis.
// D→I: Extract patterns and context from raw data
// I→K: Synthesize reusable skills from multiple information nodes
// K→W: Generate meta-judgment about when/why to apply knowledge

// ── D → I: Contextualize raw data into insight ──
export function transformDataToInfo(dataNodes, projectContext = {}) {
  if (!dataNodes.length) return { node: null, connections: [] }

  // Analyze data nodes to find patterns
  const toolCalls = dataNodes.filter(n => (n.tags || []).includes('tool-use') || (n.dtype === 'tool-call'))
  const messages = dataNodes.filter(n => (n.tags || []).includes('text') || (n.dtype === 'message'))
  const results = dataNodes.filter(n => (n.tags || []).includes('tool-result') || (n.dtype === 'tool-result'))

  // Extract key patterns
  const toolNames = toolCalls.map(n => {
    const match = n.content.match(/Tool:\s*(\w+)/)
    return match ? match[1] : 'unknown'
  }).filter(t => t !== 'unknown')

  const uniqueTools = [...new Set(toolNames)]
  const toolFreq = {}
  toolNames.forEach(t => { toolFreq[t] = (toolFreq[t] || 0) + 1 })
  const mostUsedTool = Object.entries(toolFreq).sort((a, b) => b[1] - a[1])[0]

  // Extract file paths mentioned
  const allContent = dataNodes.map(n => n.content).join(' ')
  const filePaths = allContent.match(/[\w./\\-]+\.(js|jsx|ts|tsx|py|java|css|html|md|json|sql|sh)/gi) || []
  const uniqueFiles = [...new Set(filePaths)]

  // Build contextual summary
  const parts = []
  parts.push(`Session with ${dataNodes.length} events across ${uniqueTools.length} tools`)
  if (mostUsedTool) {
    parts.push(`Primary tool: ${mostUsedTool[0]} (used ${mostUsedTool[1]}x)`)
  }
  if (uniqueFiles.length > 0) {
    parts.push(`Files involved: ${uniqueFiles.slice(0, 5).join(', ')}`)
  }
  if (messages.length > 0) {
    // Extract first meaningful user message as topic hint
    const firstMsg = messages[0]?.content?.replace(/^\[user\]\s*/i, '').slice(0, 120)
    if (firstMsg) parts.push(`Topic: "${firstMsg}"`)
  }

  // Detect workflow pattern
  const workflow = detectWorkflow(uniqueTools)
  if (workflow) parts.push(`Pattern: ${workflow}`)

  const infoId = `info_${uuidv4()}`
  const infoNode = {
    id: infoId,
    type: 'I',
    projectId: dataNodes[0]?.projectId || projectContext.id || 'unclassified',
    sourcePlatform: dataNodes[0]?.sourcePlatform || 'mixed',
    content: parts.join('. ') + '.',
    tags: ['auto-transformed', 'contextual', ...(workflow ? [workflow] : [])],
    dtype: null,
    mcpSource: dataNodes[0]?.mcpSource || null,
    sharedProjects: [],
    createdAt: new Date().toISOString()
  }

  // Create connections from source Data nodes to this Info node
  const connections = dataNodes.slice(0, 8).map(dNode => ({
    id: `conn_${dNode.id}_${infoId}`,
    fromNodeId: dNode.id,
    toNodeId: infoId,
    label: 'contextualizes'
  }))

  return { node: infoNode, connections }
}

// ── I → K: Synthesize reusable knowledge from information ──
export function transformInfoToKnowledge(infoNodes, projectContext = {}) {
  if (!infoNodes.length) return { node: null, connections: [] }

  // Analyze information nodes to find cross-cutting patterns
  const allContent = infoNodes.map(n => n.content).join(' ')
  const allTags = infoNodes.flatMap(n => n.tags || [])

  // Detect recurring themes
  const themes = detectThemes(allContent)
  const workflows = allTags.filter(t =>
    ['debug-fix', 'build-test', 'explore-implement', 'research-write', 'refactor'].includes(t)
  )

  // Build knowledge statement
  const parts = []

  if (workflows.length > 0) {
    const primaryWorkflow = workflows[0]
    const workflowAdvice = {
      'debug-fix': 'When debugging: reproduce first, isolate the component, verify fix with test. Avoid shotgun debugging.',
      'build-test': 'For build/test workflows: write test first, implement minimal code, iterate. Red-green-refactor cycle.',
      'explore-implement': 'For new implementations: explore existing patterns first, prototype quickly, then solidify.',
      'research-write': 'For research-to-writing: gather sources first, outline structure, draft iteratively. Do not polish early.',
      'refactor': 'For refactoring: ensure test coverage first, make small incremental changes, verify after each step.'
    }
    parts.push(workflowAdvice[primaryWorkflow] || `Workflow pattern: ${primaryWorkflow}`)
  }

  if (themes.length > 0) {
    parts.push(`Key techniques: ${themes.slice(0, 3).join(', ')}`)
  }

  // Extract tool-specific skills
  const toolMentions = allContent.match(/Primary tool:\s*(\w+)/g) || []
  const tools = toolMentions.map(m => m.replace('Primary tool: ', ''))
  if (tools.length > 0) {
    const uniqueToolSet = [...new Set(tools)]
    parts.push(`Tooling preference: ${uniqueToolSet.join(', ')} \u2014 effective for this type of task`)
  }

  // Add session count context
  parts.push(`Synthesized from ${infoNodes.length} session insights`)

  const knowId = `know_${uuidv4()}`
  const knowNode = {
    id: knowId,
    type: 'K',
    projectId: infoNodes[0]?.projectId || projectContext.id || 'unclassified',
    sourcePlatform: 'synthesis',
    content: parts.join('. ') + '.',
    tags: ['auto-transformed', 'skill', 'reusable', ...themes.slice(0, 2)],
    dtype: null,
    mcpSource: null,
    sharedProjects: [],
    createdAt: new Date().toISOString()
  }

  const connections = infoNodes.map(iNode => ({
    id: `conn_${iNode.id}_${knowId}`,
    fromNodeId: iNode.id,
    toNodeId: knowId,
    label: 'synthesizes'
  }))

  return { node: knowNode, connections }
}

// ── K → W: Generate meta-judgment from knowledge ──
export function transformKnowledgeToWisdom(knowledgeNodes, projectContext = {}) {
  if (!knowledgeNodes.length) return { node: null, connections: [] }

  const allContent = knowledgeNodes.map(n => n.content).join(' ')

  // Build wisdom \u2014 when to apply vs when NOT to apply
  const parts = []

  // Identify constraints
  const hasTimeConstraint = allContent.match(/time|deadline|hours|minutes|sprint|hackathon/i)
  const hasScaleConstraint = allContent.match(/scale|performance|large|production/i)
  const hasTeamConstraint = allContent.match(/team|collaborate|review|pair/i)

  parts.push(`From ${knowledgeNodes.length} knowledge patterns:`)

  // Extract the core skills
  knowledgeNodes.forEach((kNode, i) => {
    const shortSkill = kNode.content.split('.')[0].slice(0, 100)
    parts.push(`(${i + 1}) ${shortSkill}`)
  })

  // Generate applicability judgment
  const constraints = []
  if (hasTimeConstraint) constraints.push('Under time pressure, prioritize shipping over optimization')
  if (hasScaleConstraint) constraints.push('At scale, invest in architecture over quick fixes')
  if (hasTeamConstraint) constraints.push('With team involvement, prioritize readable code over clever solutions')

  if (constraints.length > 0) {
    parts.push(`Trade-offs: ${constraints.join('. ')}`)
  } else {
    parts.push('Trade-off: These patterns work well for individual exploration. Reassess for production or collaborative contexts.')
  }

  const wisdomId = `wisdom_${uuidv4()}`
  const wisdomNode = {
    id: wisdomId,
    type: 'W',
    projectId: knowledgeNodes[0]?.projectId || projectContext.id || 'unclassified',
    sourcePlatform: 'meta-analysis',
    content: parts.join(' '),
    tags: ['auto-transformed', 'meta-judgment', 'context-dependent'],
    dtype: null,
    mcpSource: null,
    sharedProjects: [],
    createdAt: new Date().toISOString()
  }

  const connections = knowledgeNodes.map(kNode => ({
    id: `conn_${kNode.id}_${wisdomId}`,
    fromNodeId: kNode.id,
    toNodeId: wisdomId,
    label: 'judges'
  }))

  return { node: wisdomNode, connections }
}

// ── Auto-transform: Run the full pipeline on newly imported Data nodes ──
export function autoTransformBatch(dataNodes, projectContext = {}) {
  const results = { nodes: [], connections: [] }

  // Step 1: D \u2192 I (group data nodes into chunks of ~10 for one Info node)
  const chunkSize = Math.max(5, Math.ceil(dataNodes.length / 3))
  const chunks = []
  for (let i = 0; i < dataNodes.length; i += chunkSize) {
    chunks.push(dataNodes.slice(i, i + chunkSize))
  }

  const infoNodes = []
  chunks.forEach(chunk => {
    const { node, connections } = transformDataToInfo(chunk, projectContext)
    if (node) {
      infoNodes.push(node)
      results.nodes.push(node)
      results.connections.push(...connections)
    }
  })

  // Step 2: I \u2192 K (if we have 2+ info nodes, synthesize knowledge)
  if (infoNodes.length >= 2) {
    const { node: kNode, connections: kConns } = transformInfoToKnowledge(infoNodes, projectContext)
    if (kNode) {
      results.nodes.push(kNode)
      results.connections.push(...kConns)

      // Step 3: K \u2192 W (generate wisdom from knowledge)
      const { node: wNode, connections: wConns } = transformKnowledgeToWisdom([kNode], projectContext)
      if (wNode) {
        results.nodes.push(wNode)
        results.connections.push(...wConns)
      }
    }
  }

  return results
}

// ── Helper: detect workflow pattern from tools used ──
function detectWorkflow(tools) {
  const toolSet = new Set(tools.map(t => t.toLowerCase()))

  if (toolSet.has('bash') && (toolSet.has('edit') || toolSet.has('write'))) {
    if (toolSet.has('grep') || toolSet.has('glob')) return 'debug-fix'
    return 'build-test'
  }
  if (toolSet.has('read') && (toolSet.has('edit') || toolSet.has('write'))) {
    return 'explore-implement'
  }
  if (toolSet.has('websearch') || toolSet.has('webfetch')) {
    return 'research-write'
  }
  if (toolSet.has('edit') && !toolSet.has('write')) {
    return 'refactor'
  }
  return null
}

// ── Helper: detect themes from content ──
function detectThemes(content) {
  const themes = []
  const lower = content.toLowerCase()

  if (lower.includes('debug') || lower.includes('fix') || lower.includes('error')) themes.push('debugging')
  if (lower.includes('test') || lower.includes('spec') || lower.includes('assert')) themes.push('testing')
  if (lower.includes('refactor') || lower.includes('clean') || lower.includes('restructur')) themes.push('refactoring')
  if (lower.includes('api') || lower.includes('endpoint') || lower.includes('fetch')) themes.push('api-integration')
  if (lower.includes('style') || lower.includes('css') || lower.includes('layout')) themes.push('ui-styling')
  if (lower.includes('database') || lower.includes('sql') || lower.includes('query')) themes.push('data-management')
  if (lower.includes('deploy') || lower.includes('build') || lower.includes('docker')) themes.push('deployment')
  if (lower.includes('algorithm') || lower.includes('optimization') || lower.includes('performance')) themes.push('optimization')

  return themes
}

// ── Export: Generate SKILL.md from a Knowledge node ──
export function generateSkillMd(knowledgeNode, relatedNodes = []) {
  const lines = []
  lines.push(`# Skill: ${knowledgeNode.content.split('.')[0]}`)
  lines.push('')
  lines.push('## Description')
  lines.push(knowledgeNode.content)
  lines.push('')

  if (knowledgeNode.tags?.length > 0) {
    lines.push('## Tags')
    lines.push(knowledgeNode.tags.map(t => `- ${t}`).join('\n'))
    lines.push('')
  }

  // Add source context from related Data/Info nodes
  const dataNodes = relatedNodes.filter(n => n.type === 'D')
  const infoNodes = relatedNodes.filter(n => n.type === 'I')
  const wisdomNodes = relatedNodes.filter(n => n.type === 'W')

  if (infoNodes.length > 0) {
    lines.push('## Source Insights')
    infoNodes.forEach(n => {
      lines.push(`- ${n.content.slice(0, 200)}`)
    })
    lines.push('')
  }

  if (wisdomNodes.length > 0) {
    lines.push('## When to Apply')
    wisdomNodes.forEach(n => {
      lines.push(n.content)
    })
    lines.push('')
  }

  if (dataNodes.length > 0) {
    lines.push('## Raw Evidence')
    lines.push(`Based on ${dataNodes.length} data points from ${knowledgeNode.sourcePlatform || 'multiple'} sessions.`)
    lines.push('')
  }

  lines.push('---')
  lines.push(`*Generated by Mnemosyne on ${new Date().toISOString().split('T')[0]}*`)

  return lines.join('\n')
}

// ── Export: Generate CLAUDE.md from Wisdom nodes ──
export function generateClaudeMd(wisdomNodes, projectName = 'Project') {
  const lines = []
  lines.push(`# ${projectName} \u2014 Wisdom Context`)
  lines.push('')
  lines.push('Use this context to guide decision-making in this project.')
  lines.push('')

  wisdomNodes.forEach((w, i) => {
    lines.push(`## Principle ${i + 1}`)
    lines.push(w.content)
    lines.push('')
  })

  lines.push('---')
  lines.push(`*Generated by Mnemosyne on ${new Date().toISOString().split('T')[0]}*`)

  return lines.join('\n')
}
