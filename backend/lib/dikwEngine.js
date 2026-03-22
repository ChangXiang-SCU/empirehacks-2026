import { v4 as uuidv4 } from 'uuid'

// ── AI-Powered DIKW Transformation Engine ──
// Uses OpenAI API (GPT-4.1) for intelligent DIKW transforms.
// Easy to swap to Anthropic API later by changing callLLM().

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const MODEL = 'gpt-5.4'

// ── Transform lock to prevent concurrent transforms on same project ──
const _locks = new Map()
async function withLock(key, fn) {
  while (_locks.get(key)) {
    await new Promise(r => setTimeout(r, 500))
  }
  _locks.set(key, true)
  try { return await fn() }
  finally { _locks.delete(key) }
}

// ── LLM API helper ──
export async function callLLM(systemPrompt, userPrompt) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('OPENAI_API_KEY not set - using fallback')
    return null
  }
  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_completion_tokens: 1024,
        temperature: 0.3
      })
    })
    if (!res.ok) {
      const err = await res.text()
      console.error(`OpenAI API error ${res.status}:`, err.slice(0, 200))
      return null
    }
    const data = await res.json()
    return data.choices?.[0]?.message?.content?.trim() || null
  } catch (err) {
    console.error('LLM call failed:', err.message)
    return null
  }
}

// ── Should we transform? Ask LLM to evaluate ──
export async function shouldTransform(existingNodes, newNode, targetLevel) {
  const desc = {
    'D->I': 'whether raw data points reveal a meaningful pattern or insight',
    'I->K': 'whether information nodes have enough patterns to synthesize into reusable knowledge',
    'K->W': 'whether knowledge nodes can be elevated into meta-level wisdom'
  }
  const nodesSummary = existingNodes.map((n, i) =>
    `[${i+1}] (${n.type}) ${n.content?.slice(0, 200)}`
  ).join('\n')
  const newStr = `[NEW] (${newNode.type}) ${newNode.content?.slice(0, 200)}`

  const sys = `You are a DIKW analysis engine. Decide ${desc[targetLevel] || 'whether a transform should happen'}.
Rules: Be conservative. Only trigger when there's genuine signal, not noise.
For D->I: need 2+ related data points showing a coherent task/workflow.
For I->K: need at least one rich insight with enough detail to extract a reusable skill. Even a single deep insight can become knowledge if it contains a clear, replicable technique.
For K->W: need enough knowledge for meta-level trade-off judgment.
Respond with ONLY a JSON object (no markdown fences): {"transform": true/false, "reason": "brief explanation"}`

  const user = `Existing nodes:\n${nodesSummary}\n\nNew node:\n${newStr}\n\nShould we trigger ${targetLevel} transform?`
  const result = await callLLM(sys, user)
  if (!result) return { transform: existingNodes.length >= 3, reason: 'API unavailable, fallback threshold' }
  try {
    return JSON.parse(result.replace(/```json\n?|\n?```/g, '').trim())
  } catch {
    console.error('Parse error for shouldTransform:', result.slice(0, 100))
    return { transform: existingNodes.length >= 3, reason: 'Parse error, fallback' }
  }
}

// ── D -> I: Contextualize raw data into insight ──
export async function transformDataToInfo(dataNodes, projectContext = {}) {
  if (!dataNodes.length) return { node: null, connections: [] }
  const nodesContent = dataNodes.map((n, i) => `[${i+1}] ${n.content?.slice(0, 1000)}`).join('\n')

  const sys = `You are Mnemosyne's Information extraction engine.
Given raw Data nodes (conversation messages between a user and an AI assistant), extract the KEY FACTUAL CONTENT and INSIGHTS discussed.
Your output should:
1. Extract the ACTUAL DOMAIN KNOWLEDGE from the conversation — specific facts, findings, concepts, names, techniques, comparisons, or conclusions
2. Do NOT describe the process ("the user asked about X") — instead, directly state the knowledge ("X involves Y because Z")
3. If the conversation discusses specific papers, tools, technologies, or methods, name them and summarize their contributions
4. Be a coherent 2-4 sentence paragraph that captures the most valuable information someone would want to remember
5. Write as domain knowledge, not as a conversation summary
Respond with ONLY the summary text. No JSON, no markdown headers, no prefixes.`

  const user = `Project: ${projectContext.id || 'unknown'}\nData nodes (${dataNodes.length}):\n${nodesContent}\n\nSynthesize into an Information node.`
  let content = await callLLM(sys, user)
  if (!content) content = fallbackDtoI(dataNodes, projectContext)

  const infoId = `info_${uuidv4()}`
  return {
    node: {
      id: infoId, type: 'I',
      projectId: dataNodes[0]?.projectId || projectContext.id || 'unclassified',
      sourcePlatform: dataNodes[0]?.sourcePlatform || 'mixed',
      content, tags: ['auto-transformed', 'ai-generated'],
      dtype: null, mcpSource: dataNodes[0]?.mcpSource || null,
      sharedProjects: [], createdAt: new Date().toISOString()
    },
    connections: dataNodes.slice(0, 12).map(d => ({
      id: `conn_${d.id}_${infoId}`, fromNodeId: d.id, toNodeId: infoId, label: 'contextualizes'
    }))
  }
}

// ── I -> K: Synthesize reusable knowledge ──
export async function transformInfoToKnowledge(infoNodes, projectContext = {}) {
  if (!infoNodes.length) return { node: null, connections: [] }
  const nodesContent = infoNodes.map((n, i) => `[${i+1}] ${n.content?.slice(0, 800)}`).join('\n')

  const sys = `You are Mnemosyne's Knowledge synthesis engine.
Given Information nodes, synthesize reusable Knowledge — structured understanding that can be applied in the future.
Your output should:
1. Title the knowledge clearly (e.g., "Key evolution of autonomous driving research 2020-2024")
2. Distill the core frameworks, taxonomies, or principles from the information
3. Include specific names, references, and relationships (papers, tools, methods, etc.)
4. Make it REUSABLE — someone reading this later should gain real domain understanding
5. 3-6 sentences capturing the structured knowledge, not a meta-description of the learning process
Respond with ONLY the text. No JSON, no markdown headers.`

  const user = `Project: ${projectContext.id || 'unknown'}\nInfo nodes (${infoNodes.length}):\n${nodesContent}\n\nSynthesize into a Knowledge node.`
  let content = await callLLM(sys, user)
  if (!content) content = fallbackItoK(infoNodes, projectContext)

  const knowId = `know_${uuidv4()}`
  return {
    node: {
      id: knowId, type: 'K',
      projectId: infoNodes[0]?.projectId || projectContext.id || 'unclassified',
      sourcePlatform: 'synthesis', content,
      tags: ['auto-transformed', 'ai-generated', 'skill', 'reusable'],
      dtype: null, mcpSource: null, sharedProjects: [],
      createdAt: new Date().toISOString()
    },
    connections: infoNodes.map(i => ({
      id: `conn_${i.id}_${knowId}`, fromNodeId: i.id, toNodeId: knowId, label: 'synthesizes'
    }))
  }
}

// ── K -> W: Generate meta-judgment ──
export async function transformKnowledgeToWisdom(knowledgeNodes, projectContext = {}) {
  if (!knowledgeNodes.length) return { node: null, connections: [] }
  const nodesContent = knowledgeNodes.map((n, i) => `[${i+1}] ${n.content?.slice(0, 1000)}`).join('\n')

  const sys = `You are Mnemosyne's Wisdom generation engine.
Given Knowledge nodes, generate meta-level Wisdom — deep judgment and principles that transcend the specific domain.
Your output should be WISDOM:
1. What are the deeper patterns or principles at work? (e.g., "paradigm shifts follow a pattern of representation→task-organization→model-scale")
2. What non-obvious trade-offs or tensions exist?
3. What lessons transfer to other domains or future decisions?
4. What would an expert consider that a novice would miss?
5. 3-6 sentences of principled, transferable insight — NOT just a restatement of the knowledge
Respond with ONLY the text. No JSON, no markdown headers.`

  const user = `Project: ${projectContext.id || 'unknown'}\nKnowledge nodes (${knowledgeNodes.length}):\n${nodesContent}\n\nGenerate Wisdom.`
  let content = await callLLM(sys, user)
  if (!content) content = fallbackKtoW(knowledgeNodes, projectContext)

  const wisdomId = `wisdom_${uuidv4()}`
  return {
    node: {
      id: wisdomId, type: 'W',
      projectId: knowledgeNodes[0]?.projectId || projectContext.id || 'unclassified',
      sourcePlatform: 'meta-analysis', content,
      tags: ['auto-transformed', 'ai-generated', 'meta-judgment', 'context-dependent'],
      dtype: null, mcpSource: null, sharedProjects: [],
      createdAt: new Date().toISOString()
    },
    connections: knowledgeNodes.map(k => ({
      id: `conn_${k.id}_${wisdomId}`, fromNodeId: k.id, toNodeId: wisdomId, label: 'judges'
    }))
  }
}

// ── Auto-transform batch (with lock) ──
export async function autoTransformBatch(dataNodes, projectContext = {}) {
  const key = projectContext.id || 'default'
  return withLock(`batch_${key}`, async () => {
    const results = { nodes: [], connections: [] }
    const chunkSize = Math.max(5, Math.ceil(dataNodes.length / 3))
    const chunks = []
    for (let i = 0; i < dataNodes.length; i += chunkSize) chunks.push(dataNodes.slice(i, i + chunkSize))

    const infoNodes = []
    for (const chunk of chunks) {
      const { node, connections } = await transformDataToInfo(chunk, projectContext)
      if (node) { infoNodes.push(node); results.nodes.push(node); results.connections.push(...connections) }
    }
    if (infoNodes.length >= 1) {
      const { node: kNode, connections: kConns } = await transformInfoToKnowledge(infoNodes, projectContext)
      if (kNode) {
        results.nodes.push(kNode); results.connections.push(...kConns)
        const { node: wNode, connections: wConns } = await transformKnowledgeToWisdom([kNode], projectContext)
        if (wNode) { results.nodes.push(wNode); results.connections.push(...wConns) }
      }
    }
    return results
  })
}

// ── Locked wrapper for auto-transform in hook handler ──
export async function lockedAutoTransform(sessionId, getUntransformed, insertNode, insertConn, saveFn, broadcastFn, getGraphFn) {
  return withLock(`auto_${sessionId}`, async () => {
    const untransformedD = getUntransformed('D', 'contextualizes')
    if (untransformedD.length < 2) return

    const newNode = untransformedD[untransformedD.length - 1]
    const dec = await shouldTransform(untransformedD.slice(0, -1), newNode, 'D->I')
    console.log(`[DIKW] D->I (${untransformedD.length} nodes): ${dec.transform ? 'YES' : 'NO'} - ${dec.reason}`)

    if (!dec.transform) return

    const result = await transformDataToInfo(untransformedD, { id: sessionId })
    if (!result.node) return
    insertNode(result.node)
    result.connections.forEach(c => insertConn(c))

    const untransformedI = getUntransformed('I', 'synthesizes')
    if (untransformedI.length >= 1) {
      const iDec = await shouldTransform(untransformedI.length > 1 ? untransformedI.slice(0, -1) : [], result.node, 'I->K')
      console.log(`[DIKW] I->K (${untransformedI.length} nodes): ${iDec.transform ? 'YES' : 'NO'} - ${iDec.reason}`)
      if (iDec.transform) {
        const kR = await transformInfoToKnowledge(untransformedI, { id: sessionId })
        if (kR.node) {
          insertNode(kR.node)
          kR.connections.forEach(c => insertConn(c))
          const untransformedK = getUntransformed('K', 'judges')
          if (untransformedK.length >= 1) {
            const kDec = await shouldTransform(
              untransformedK.length > 1 ? untransformedK.slice(0,-1) : [], kR.node, 'K->W')
            console.log(`[DIKW] K->W: ${kDec.transform ? 'YES' : 'NO'} - ${kDec.reason}`)
            if (kDec.transform) {
              const wR = await transformKnowledgeToWisdom(untransformedK, { id: sessionId })
              if (wR.node) { insertNode(wR.node); wR.connections.forEach(c => insertConn(c)) }
            }
          }
        }
      }
    }
    saveFn()
    broadcastFn({ type: 'graph:updated', data: getGraphFn() })
  })
}

// ═══ Fallback functions ═══
function fallbackDtoI(dataNodes, ctx) {
  const all = dataNodes.map(n => n.content).join(' ')
  const tools = all.match(/Tool:\s*(\w+)/g)?.map(m => m.replace('Tool: ', '')) || []
  const uniq = [...new Set(tools)]
  const files = all.match(/[\w./\\-]+\.(js|jsx|ts|tsx|py|css|html|md|json)/gi) || []
  return `Session with ${dataNodes.length} events using ${uniq.join(', ') || 'various tools'}. Files: ${[...new Set(files)].slice(0,5).join(', ') || 'none detected'}.`
}
function fallbackItoK(infoNodes, ctx) {
  return `Synthesized from ${infoNodes.length} insights in project ${ctx.id || 'unknown'}.`
}
function fallbackKtoW(kNodes, ctx) {
  return `From ${kNodes.length} patterns: ${kNodes.map((k,i) => `(${i+1}) ${k.content.split('.')[0]}`).join('. ')}. Reassess for production contexts.`
}

// ── Export: Generate SKILL.md from a Knowledge node ──
export function generateSkillMd(knowledgeNode, relatedNodes = []) {
  const lines = [`# Skill: ${knowledgeNode.content.split('.')[0]}`, '', '## Description', knowledgeNode.content, '']
  if (knowledgeNode.tags?.length > 0) { lines.push('## Tags', knowledgeNode.tags.map(t => `- ${t}`).join('\n'), '') }
  const infoNodes = relatedNodes.filter(n => n.type === 'I')
  const wisdomNodes = relatedNodes.filter(n => n.type === 'W')
  const dataNodes = relatedNodes.filter(n => n.type === 'D')
  if (infoNodes.length > 0) { lines.push('## Source Insights'); infoNodes.forEach(n => lines.push(`- ${n.content.slice(0,200)}`)); lines.push('') }
  if (wisdomNodes.length > 0) { lines.push('## When to Apply'); wisdomNodes.forEach(n => lines.push(n.content)); lines.push('') }
  if (dataNodes.length > 0) { lines.push('## Raw Evidence', `Based on ${dataNodes.length} data points.`, '') }
  lines.push('---', `*Generated by Mnemosyne on ${new Date().toISOString().split('T')[0]}*`)
  return lines.join('\n')
}

// ── Export: Generate CLAUDE.md from Wisdom nodes ──
export function generateClaudeMd(wisdomNodes, projectName = 'Project') {
  const lines = [`# ${projectName} — Wisdom Context`, '', 'Use this context to guide decision-making.', '']
  wisdomNodes.forEach((w, i) => { lines.push(`## Principle ${i+1}`, w.content, '') })
  lines.push('---', `*Generated by Mnemosyne on ${new Date().toISOString().split('T')[0]}*`)
  return lines.join('\n')
}


// ── Upsert-aware DIKW transforms ──
// These pass existing nodes to LLM so it can decide: update existing or create new

export async function transformDtoI_upsert(dataNodes, existingINodes, projectContext = {}) {
  if (!dataNodes.length) return { actions: [] }
  const nodesContent = dataNodes.map((n, i) => `[${i+1}] ${n.content?.slice(0, 1000)}`).join('\n')
  const existingContent = existingINodes.length
    ? existingINodes.map((n, i) => `[existing_I_${i+1}] (id: ${n.id}) ${n.content?.slice(0, 800)}`).join('\n')
    : '(none)'

  const sys = `You are Mnemosyne's Information extraction engine with UPSERT capability.
You will receive:
1. Raw Data nodes (conversation messages)
2. Existing Information nodes already in the knowledge graph (may be empty)

Your job: Extract key factual content and insights from the Data nodes.
Then decide for EACH insight whether to:
- UPDATE an existing Information node (if the new data enriches/refines what's already captured)
- CREATE a new Information node (if the new data covers a genuinely different topic or angle)

Rules:
- Extract ACTUAL DOMAIN KNOWLEDGE — specific facts, findings, concepts, names, techniques
- Do NOT describe the process ("the user asked about X") — directly state the knowledge
- Each node should be a coherent 2-4 sentence paragraph
- If all new data just enriches existing nodes, only output UPDATEs
- If there's genuinely new ground, output CREATEs

Respond in JSON format:
{
  "actions": [
    { "action": "UPDATE", "existing_id": "<id of node to update>", "content": "<new full content>" },
    { "action": "CREATE", "content": "<content for new node>" }
  ]
}
Respond with ONLY valid JSON. No markdown fences.`

  const user = `Project: ${projectContext.id || 'unknown'}
Data nodes (${dataNodes.length}):
${nodesContent}

Existing Information nodes:
${existingContent}

Decide: update existing or create new Information nodes.`

  let result = await callLLM(sys, user)
  if (!result) return { actions: [{ action: 'CREATE', content: fallbackDtoI(dataNodes, projectContext) }] }
  try {
    return JSON.parse(result.replace(/```json\n?|\n?```/g, '').trim())
  } catch {
    return { actions: [{ action: 'CREATE', content: result }] }
  }
}

export async function transformItoK_upsert(infoNodes, existingKNodes, projectContext = {}) {
  if (!infoNodes.length) return { actions: [] }
  const nodesContent = infoNodes.map((n, i) => `[${i+1}] ${n.content?.slice(0, 800)}`).join('\n')
  const existingContent = existingKNodes.length
    ? existingKNodes.map((n, i) => `[existing_K_${i+1}] (id: ${n.id}) ${n.content?.slice(0, 800)}`).join('\n')
    : '(none)'

  const sys = `You are Mnemosyne's Knowledge synthesis engine with UPSERT capability.
You will receive Information nodes and existing Knowledge nodes.

Decide for each piece of knowledge whether to:
- UPDATE an existing Knowledge node (if the new info deepens/refines existing knowledge)
- CREATE a new Knowledge node (if there's a genuinely new framework, taxonomy, or principle)

Rules:
- Title knowledge clearly (e.g., "Key evolution of autonomous driving 2020-2024")
- Distill core frameworks, taxonomies, or principles
- Include specific names, references, relationships
- Make it REUSABLE — real domain understanding
- 3-6 sentences per node

Respond in JSON: { "actions": [ { "action": "UPDATE"|"CREATE", "existing_id": "<id if UPDATE>", "content": "..." } ] }
Respond with ONLY valid JSON. No markdown fences.`

  const user = `Project: ${projectContext.id || 'unknown'}
Info nodes (${infoNodes.length}):
${nodesContent}

Existing Knowledge nodes:
${existingContent}

Decide: update existing or create new Knowledge nodes.`

  let result = await callLLM(sys, user)
  if (!result) return { actions: [{ action: 'CREATE', content: fallbackItoK(infoNodes, projectContext) }] }
  try {
    return JSON.parse(result.replace(/```json\n?|\n?```/g, '').trim())
  } catch {
    return { actions: [{ action: 'CREATE', content: result }] }
  }
}

export async function transformKtoW_upsert(knowledgeNodes, existingWNodes, projectContext = {}) {
  if (!knowledgeNodes.length) return { actions: [] }
  const nodesContent = knowledgeNodes.map((n, i) => `[${i+1}] ${n.content?.slice(0, 1000)}`).join('\n')
  const existingContent = existingWNodes.length
    ? existingWNodes.map((n, i) => `[existing_W_${i+1}] (id: ${n.id}) ${n.content?.slice(0, 800)}`).join('\n')
    : '(none)'

  const sys = `You are Mnemosyne's Wisdom generation engine with UPSERT capability.
You will receive Knowledge nodes and existing Wisdom nodes.

Decide whether to:
- UPDATE an existing Wisdom node (if the new knowledge deepens existing wisdom)
- CREATE a new Wisdom node (if there's a genuinely new meta-insight or principle)

Rules:
- What are the deeper patterns or principles at work?
- What non-obvious trade-offs or tensions exist?
- What lessons transfer to other domains?
- What would an expert consider that a novice would miss?
- 3-6 sentences of principled, transferable insight

Respond in JSON: { "actions": [ { "action": "UPDATE"|"CREATE", "existing_id": "<id if UPDATE>", "content": "..." } ] }
Respond with ONLY valid JSON. No markdown fences.`

  const user = `Project: ${projectContext.id || 'unknown'}
Knowledge nodes (${knowledgeNodes.length}):
${nodesContent}

Existing Wisdom nodes:
${existingContent}

Decide: update existing or create new Wisdom nodes.`

  let result = await callLLM(sys, user)
  if (!result) return { actions: [{ action: 'CREATE', content: fallbackKtoW(knowledgeNodes, projectContext) }] }
  try {
    return JSON.parse(result.replace(/```json\n?|\n?```/g, '').trim())
  } catch {
    return { actions: [{ action: 'CREATE', content: result }] }
  }
}
