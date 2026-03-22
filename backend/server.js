import 'dotenv/config'
import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import path from 'path'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'
import initSqlJs from 'sql.js'
import fs from 'fs'
import crypto from 'crypto'

// Import custom modules
import { importChatGPT } from './lib/importers/chatgpt.js'
import { importClaudeCode } from './lib/importers/claudeCode.js'
import { importClaudeWeb } from './lib/importers/claudeWeb.js'
import { importCodex } from './lib/importers/codex.js'
import { seedData } from './db/seedData.js'
import {
  transformDataToInfo,
  transformInfoToKnowledge,
  transformKnowledgeToWisdom,
  autoTransformBatch,
  generateSkillMd,
  generateClaudeMd,
  shouldTransform,
  lockedAutoTransform,
  callLLM,
  transformDtoI_upsert,
  transformItoK_upsert,
  transformKtoW_upsert
} from './lib/dikwEngine.js'
import { recommendForProject, recommendOnImport } from './lib/recommendEngine.js'
import { startFileWatcher } from './lib/fileWatcher.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })
const upload = multer({ storage: multer.memoryStorage() })

const PORT = process.env.BACKEND_PORT || 3001
const DB_PATH = join(__dirname, 'db', 'mnemosyne.db')

// \u2500\u2500 Database helpers (sql.js) \u2500\u2500
let db = null

function dbAll(sql, params = []) {
  const stmt = db.prepare(sql)
  if (params.length) stmt.bind(params)
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

function dbGet(sql, params = []) {
  const rows = dbAll(sql, params)
  return rows[0] || null
}

function dbRun(sql, params = []) {
  db.run(sql, params)
}

function saveDb() {
  const data = db.export()
  const buffer = Buffer.from(data)
  const dir = dirname(DB_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(DB_PATH, buffer)
}

// \u2500\u2500 Initialize \u2500\u2500
async function initializeDatabase() {
  const SQL = await initSqlJs()

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH)
    db = new SQL.Database(fileBuffer)
    console.log('\u2713 Loaded existing database')
  } else {
    db = new SQL.Database()
    console.log('\u2713 Created new database')
  }

  const schema = fs.readFileSync(join(__dirname, 'db/schema.sql'), 'utf-8')
  db.exec(schema)

  const row = dbGet('SELECT COUNT(*) as count FROM nodes')
  if (row && row.count === 0) {
    // seedDatabase()  // Skip seed for clean demo
    console.log('✓ Empty database ready (no seed data)')
  }

  saveDb()
}

function seedDatabase() {
  try {
    const data = seedData()
    const now = new Date().toISOString()

    data.projects.forEach(proj => {
      dbRun(
        'INSERT OR IGNORE INTO projects (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [proj.id, proj.name, proj.color, now, now]
      )
    })

    data.nodes.forEach(node => {
      dbRun(
        `INSERT OR IGNORE INTO nodes (id, type, project_id, source_platform, content, tags, dtype, mcp_source, shared_projects, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          node.id, node.type, node.projectId, node.sourcePlatform, node.content,
          JSON.stringify(node.tags || []), node.dtype || null, node.mcpSource || null,
          JSON.stringify(node.sharedProjects || []), node.createdAt, now
        ]
      )
    })

    data.connections.forEach(conn => {
      dbRun(
        'INSERT OR IGNORE INTO connections (id, from_node_id, to_node_id, label, created_at) VALUES (?, ?, ?, ?, ?)',
        [conn.id, conn.fromNodeId, conn.toNodeId, conn.label, now]
      )
    })

    data.mcpSources.forEach(source => {
      dbRun(
        'INSERT OR IGNORE INTO mcp_sources (id, name, status, icon, data_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [source.id, source.name, source.status, source.icon, source.dataCount, now, now]
      )
    })

    console.log('\u2713 Database seeded with demo data')
  } catch (error) {
    console.error('Error seeding database:', error)
  }
}

// \u2500\u2500 Helpers \u2500\u2500
function getGraph() {
  const nodes = dbAll('SELECT * FROM nodes').map(row => ({
    id: row.id, type: row.type, projectId: row.project_id,
    sourcePlatform: row.source_platform, content: row.content,
    tags: JSON.parse(row.tags || '[]'), dtype: row.dtype,
    mcpSource: row.mcp_source, sharedProjects: JSON.parse(row.shared_projects || '[]'),
    createdAt: row.created_at
  }))

  const connections = dbAll('SELECT * FROM connections').map(row => ({
    id: row.id, fromNodeId: row.from_node_id, toNodeId: row.to_node_id, label: row.label
  }))

  const projects = dbAll('SELECT * FROM projects').map(row => ({
    id: row.id, name: row.name, color: row.color
  }))

  const mcpSources = dbAll('SELECT * FROM mcp_sources').map(row => ({
    id: row.id, name: row.name, status: row.status, icon: row.icon, dataCount: row.data_count
  }))

  return { nodes, connections, projects, mcpSources }
}

function broadcastToClients(message) {
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(JSON.stringify(message))
  })
}

function insertNodeToDb(node) {
  const now = new Date().toISOString()
  dbRun(
    `INSERT OR IGNORE INTO nodes (id, type, project_id, source_platform, content, tags, dtype, mcp_source, shared_projects, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      node.id, node.type, node.projectId, node.sourcePlatform, node.content,
      JSON.stringify(node.tags || []), node.dtype || null, node.mcpSource || null,
      JSON.stringify(node.sharedProjects || []), node.createdAt || now, now
    ]
  )
}

function insertConnectionToDb(conn) {
  const now = new Date().toISOString()
  dbRun(
    'INSERT OR IGNORE INTO connections (id, from_node_id, to_node_id, label, created_at) VALUES (?, ?, ?, ?, ?)',
    [conn.id, conn.fromNodeId, conn.toNodeId, conn.label, now]
  )
}

// \u2500\u2500 Routes \u2500\u2500
app.use(express.json())
app.use(express.static(join(__dirname, '../frontend/dist')))

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE')
  next()
})

// \u2500\u2500 GET /api/graph \u2500\u2500
app.get('/api/graph', (req, res) => {
  try {
    res.json(getGraph())
  } catch (error) {
    console.error('Error fetching graph:', error)
    res.status(500).json({ error: 'Failed to fetch graph' })
  }
})

// \u2500\u2500 POST /api/import \u2014 Import file + auto-transform \u2500\u2500
app.post('/api/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' })

  try {
    const fileContent = req.file.buffer.toString('utf-8')
    let dataNodes = []
    let platform = 'unknown'

    // Detect format and parse
    try {
      const data = JSON.parse(fileContent)
      // ChatGPT official export: [{title, mapping: {...}}]
      if (Array.isArray(data) && data[0]?.mapping) {
        dataNodes = importChatGPT(data)
        platform = 'chatgpt'
      }
      // Claude.ai export: {conversations: [...]}
      else if (data.conversations) {
        dataNodes = importClaudeWeb(data)
        platform = 'claude-web'
      }
      // Claude.ai single conversation
      else if (data.conversation_content || data.messages) {
        dataNodes = importClaudeWeb(data)
        platform = 'claude-web'
      }
      // Simple array format [{role, content}]
      else if (Array.isArray(data) && data[0]?.role) {
        dataNodes = importChatGPT(data)
        platform = 'chatgpt'
      }
      // Generic array — try ChatGPT
      else if (Array.isArray(data)) {
        dataNodes = importChatGPT(data)
        platform = 'chatgpt'
      }
    } catch {
      // Not valid JSON — try JSONL (Codex rollout or Claude Code)
      const firstLine = fileContent.split("\n")[0] || ""
      let firstEntry = null
      try { firstEntry = JSON.parse(firstLine) } catch {}
      if (firstEntry && firstEntry.type === "session_meta") {
        const codexResult = importCodex(fileContent)
        dataNodes = codexResult.nodes
        platform = 'codex'
      } else {
        const ccResult = importClaudeCode(fileContent)
        dataNodes = ccResult.nodes
        platform = 'claude-code'
      }
    }

    if (dataNodes.length === 0) {
      return res.status(400).json({ error: 'No data found in file' })
    }

    const now = new Date().toISOString()
    const projectId = 'project_' + uuidv4().slice(0, 8)
    const projectName = req.body?.projectName || `Imported ${platform} (${new Date().toLocaleDateString()})`

    // Create project
    dbRun('INSERT INTO projects (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [projectId, projectName, '#00897b', now, now])

    // Assign project to all data nodes & insert
    dataNodes.forEach(node => {
      node.projectId = projectId
      insertNodeToDb(node)
    })

    // Auto-transform: D \u2192 I \u2192 K \u2192 W
    const transformed = await autoTransformBatch(dataNodes, { id: projectId, name: projectName })
    transformed.nodes.forEach(node => {
      node.projectId = projectId
      insertNodeToDb(node)
    })
    transformed.connections.forEach(conn => insertConnectionToDb(conn))

    saveDb()

    // Broadcast full graph update
    const graph = getGraph()
    broadcastToClients({ type: 'import:completed', data: graph })

    res.json({
      success: true,
      platform,
      projectId,
      projectName,
      dataNodesCount: dataNodes.length,
      transformedNodesCount: transformed.nodes.length,
      connectionsCount: transformed.connections.length,
      totalNodes: dataNodes.length + transformed.nodes.length,
      recommendations: recommendOnImport(db, dataNodes, projectId, 5)
    })
  } catch (error) {
    console.error('Import error:', error)
    res.status(500).json({ error: 'Import failed: ' + error.message })
  }
})

// \u2500\u2500 POST /api/transform \u2014 Manual DIKW transformation \u2500\u2500
app.post('/api/transform', async (req, res) => {
  try {
    const { nodeIds, direction } = req.body
    // direction: 'D\u2192I', 'I\u2192K', 'K\u2192W', or 'auto'

    if (!nodeIds || !nodeIds.length) {
      return res.status(400).json({ error: 'No node IDs provided' })
    }

    // Fetch source nodes from DB
    const placeholders = nodeIds.map(() => '?').join(',')
    const sourceNodes = dbAll(`SELECT * FROM nodes WHERE id IN (${placeholders})`, nodeIds)
      .map(row => ({
        id: row.id, type: row.type, projectId: row.project_id,
        sourcePlatform: row.source_platform, content: row.content,
        tags: JSON.parse(row.tags || '[]'), dtype: row.dtype,
        mcpSource: row.mcp_source, sharedProjects: JSON.parse(row.shared_projects || '[]'),
        createdAt: row.created_at
      }))

    if (sourceNodes.length === 0) {
      return res.status(404).json({ error: 'No matching nodes found' })
    }

    let result = { node: null, connections: [] }
    const sourceType = sourceNodes[0].type
    const projectContext = { id: sourceNodes[0].projectId }

    if (direction === 'auto' || !direction) {
      // Auto-detect based on source node type
      if (sourceType === 'D') result = await transformDataToInfo(sourceNodes, projectContext)
      else if (sourceType === 'I') result = await transformInfoToKnowledge(sourceNodes, projectContext)
      else if (sourceType === 'K') result = await transformKnowledgeToWisdom(sourceNodes, projectContext)
      else return res.status(400).json({ error: 'Wisdom nodes cannot be further transformed' })
    } else if (direction === 'D\u2192I') {
      result = await transformDataToInfo(sourceNodes.filter(n => n.type === 'D'), projectContext)
    } else if (direction === 'I\u2192K') {
      result = await transformInfoToKnowledge(sourceNodes.filter(n => n.type === 'I'), projectContext)
    } else if (direction === 'K\u2192W') {
      result = await transformKnowledgeToWisdom(sourceNodes.filter(n => n.type === 'K'), projectContext)
    }

    if (!result.node) {
      return res.status(400).json({ error: 'Transformation produced no result' })
    }

    // Save to DB
    insertNodeToDb(result.node)
    result.connections.forEach(conn => insertConnectionToDb(conn))
    saveDb()

    // Broadcast
    broadcastToClients({ type: 'node:added', data: result.node })
    result.connections.forEach(conn => {
      broadcastToClients({ type: 'connection:added', data: conn })
    })

    // Also broadcast full graph for simpler client-side handling
    broadcastToClients({ type: 'graph:updated', data: getGraph() })

    res.json({
      success: true,
      newNode: result.node,
      newConnections: result.connections
    })
  } catch (error) {
    console.error('Transform error:', error)
    res.status(500).json({ error: 'Transformation failed: ' + error.message })
  }
})

// -- POST /api/export/skill/:nodeId -- Export Knowledge node as SKILL.md --
app.post('/api/export/skill/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params
    const deploy = req.query.deploy === 'true'
    const node = dbGet('SELECT * FROM nodes WHERE id = ? AND type = ?', [nodeId, 'K'])
    if (!node) return res.status(404).json({ error: 'Knowledge node not found' })

    const knowledgeNode = {
      id: node.id, type: node.type, content: node.content,
      tags: JSON.parse(node.tags || '[]'), sourcePlatform: node.source_platform
    }

    // Find related nodes via connections
    const relatedIds = dbAll('SELECT from_node_id FROM connections WHERE to_node_id = ?', [nodeId]).map(r => r.from_node_id)
    const wisdomIds = dbAll('SELECT to_node_id FROM connections WHERE from_node_id = ?', [nodeId]).map(r => r.to_node_id)
    const allRelatedIds = [...relatedIds, ...wisdomIds]
    let relatedNodes = []
    if (allRelatedIds.length > 0) {
      const ph = allRelatedIds.map(() => '?').join(',')
      relatedNodes = dbAll(`SELECT * FROM nodes WHERE id IN (${ph})`, allRelatedIds)
        .map(row => ({ id: row.id, type: row.type, content: row.content, tags: JSON.parse(row.tags || '[]') }))
    }

    // Use LLM to generate a richer SKILL.md
    let markdown
    try {
      const skillPrompt = `Generate a comprehensive SKILL.md for Claude Code based on this knowledge.
The skill should be actionable and reusable across projects.

Knowledge: ${knowledgeNode.content}
Tags: ${knowledgeNode.tags.join(', ')}
Related insights: ${relatedNodes.map(n => n.content.slice(0, 150)).join('\n')}

Output format:
# Skill: [concise title]
## When to Use
[Describe triggers and scenarios]
## Key Practices
[Actionable guidelines]
## Common Patterns
[Code patterns or workflows]
## Pitfalls to Avoid
[Anti-patterns and warnings]
## Related Tags
[Tags for discovery]`
      markdown = await callLLM('You distill development knowledge into reusable Claude Code skills.', skillPrompt)
      if (!markdown) markdown = generateSkillMd(knowledgeNode, relatedNodes)
    } catch (e) {
      console.log('LLM skill generation failed, using template:', e.message)
      markdown = generateSkillMd(knowledgeNode, relatedNodes)
    }

    if (deploy) {
      const projectId = node.project_id || 'general'
      const projectName = projectId.replace(/[^a-zA-Z0-9_-]/g, '-')
      const homeDir = process.env.USERPROFILE || process.env.HOME
      const skillDir = path.join(homeDir, '.claude', 'skills', `mnemosyne-${projectName}`)
      fs.mkdirSync(skillDir, { recursive: true })
      const skillPath = path.join(skillDir, 'SKILL.md')

      if (fs.existsSync(skillPath)) {
        const existing = fs.readFileSync(skillPath, 'utf-8')
        if (existing.includes(`<!-- mnemosyne-node:${nodeId} -->`)) {
          return res.json({ deployed: true, path: skillPath, message: 'Already deployed', markdown })
        }
        fs.appendFileSync(skillPath, `\n\n<!-- mnemosyne-node:${nodeId} -->\n${markdown}`)
      } else {
        fs.writeFileSync(skillPath, `<!-- mnemosyne-node:${nodeId} -->\n${markdown}`)
      }
      console.log(`Deployed SKILL.md to ${skillPath}`)
      return res.json({ deployed: true, path: skillPath, markdown })
    }

    res.setHeader('Content-Type', 'text/markdown')
    res.setHeader('Content-Disposition', `attachment; filename="SKILL_${nodeId}.md"`)
    res.send(markdown)
  } catch (error) {
    console.error('Export error:', error)
    res.status(500).json({ error: 'Export failed' })
  }
})

// -- POST /api/export/claude/:projectId -- Export Wisdom as CLAUDE.md --
app.post('/api/export/claude/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params
    const deploy = req.query.deploy === 'true'
    const targetDir = req.body?.targetDir
    const project = dbGet('SELECT * FROM projects WHERE id = ?', [projectId])
    const wisdomNodes = dbAll('SELECT * FROM nodes WHERE project_id = ? AND type = ?', [projectId, 'W'])
      .map(row => ({ id: row.id, content: row.content, tags: JSON.parse(row.tags || '[]') }))
    const knowledgeNodes = dbAll('SELECT * FROM nodes WHERE project_id = ? AND type = ?', [projectId, 'K'])
      .map(row => ({ id: row.id, content: row.content, tags: JSON.parse(row.tags || '[]') }))

    if (wisdomNodes.length === 0 && knowledgeNodes.length === 0) {
      return res.status(404).json({ error: 'No wisdom or knowledge nodes found' })
    }

    let markdown
    try {
      const claudePrompt = `Generate a CLAUDE.md context file for a development project.
This file will be read by Claude at session start to provide project wisdom.

Project: ${project?.name || projectId}

Wisdom (high-level principles):
${wisdomNodes.map((w, i) => `${i+1}. ${w.content}`).join('\n')}

Knowledge (reusable patterns):
${knowledgeNodes.map((k, i) => `${i+1}. ${k.content}`).join('\n')}

Output a well-structured CLAUDE.md with:
1. Brief project context
2. Key principles and guidelines (from wisdom)
3. Technical patterns (from knowledge)
4. Common pitfalls
Keep it concise and actionable.`
      markdown = await callLLM('You create CLAUDE.md project context files that help AI assistants work effectively.', claudePrompt)
      if (!markdown) markdown = generateClaudeMd(wisdomNodes, project?.name || 'Project')
    } catch (e) {
      console.log('LLM CLAUDE.md generation failed, using template:', e.message)
      markdown = generateClaudeMd(wisdomNodes, project?.name || 'Project')
    }

    if (deploy) {
      const homeDir = process.env.USERPROFILE || process.env.HOME
      let claudePath
      if (targetDir && fs.existsSync(targetDir)) {
        claudePath = path.join(targetDir, 'CLAUDE.md')
      } else {
        const projDir = path.join(homeDir, '.claude', 'projects', `mnemosyne-${projectId.replace(/[^a-zA-Z0-9_-]/g, '-')}`)
        fs.mkdirSync(projDir, { recursive: true })
        claudePath = path.join(projDir, 'CLAUDE.md')
      }

      const marker = '<!-- MNEMOSYNE-WISDOM-START -->'
      const endMarker = '<!-- MNEMOSYNE-WISDOM-END -->'
      const block = `${marker}\n${markdown}\n${endMarker}`

      if (fs.existsSync(claudePath)) {
        let existing = fs.readFileSync(claudePath, 'utf-8')
        if (existing.includes(marker)) {
          const si = existing.indexOf(marker)
          const ei = existing.indexOf(endMarker) + endMarker.length
          existing = existing.slice(0, si) + block + existing.slice(ei)
        } else {
          existing += '\n\n' + block
        }
        fs.writeFileSync(claudePath, existing)
      } else {
        fs.writeFileSync(claudePath, block)
      }
      console.log(`Deployed CLAUDE.md to ${claudePath}`)
      return res.json({ deployed: true, path: claudePath, markdown })
    }

    res.setHeader('Content-Type', 'text/markdown')
    res.setHeader('Content-Disposition', `attachment; filename="CLAUDE_${projectId}.md"`)
    res.send(markdown)
  } catch (error) {
    console.error('Export error:', error)
    res.status(500).json({ error: 'Export failed' })
  }
})

// -- GET /api/context/:projectId -- Hierarchical DIKW context for SessionStart hook --
// Returns W->K->I->D layers, each only if relevant. Used by session-start.mjs hook.
app.get('/api/context/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params
    const depth = req.query.depth || 'auto'  // 'W', 'K', 'I', 'D', or 'auto'
    const taskDesc = req.query.task || ''     // optional: what the user is about to do

    // Gather nodes by type for this project + cross-project
    function getNodes(type, pid) {
      return dbAll(
        'SELECT * FROM nodes WHERE type = ? AND (project_id = ? OR project_id = ?)',
        [type, pid, 'cross-project']
      ).map(row => ({
        id: row.id, type: row.type, projectId: row.project_id,
        content: row.content, tags: JSON.parse(row.tags || '[]'),
        createdAt: row.created_at
      }))
    }

    // Also find nodes from OTHER projects that might be relevant (by tag overlap)
    function getCrossProjectNodes(type, pid) {
      const myTags = dbAll(
        'SELECT DISTINCT tags FROM nodes WHERE project_id = ?', [pid]
      ).flatMap(r => { try { return JSON.parse(r.tags || '[]') } catch { return [] } })
      if (myTags.length === 0) return []
      // Find nodes from other projects that share tags
      const allOther = dbAll(
        'SELECT * FROM nodes WHERE type = ? AND project_id != ? AND project_id != ?',
        [type, pid, 'cross-project']
      ).map(row => ({
        id: row.id, type: row.type, projectId: row.project_id,
        content: row.content, tags: JSON.parse(row.tags || '[]'),
        createdAt: row.created_at
      }))
      // Score by tag overlap
      return allOther.filter(n => {
        const overlap = n.tags.filter(t => myTags.includes(t) && t !== 'auto-transformed' && t !== 'ai-generated')
        return overlap.length > 0
      }).slice(0, 5)
    }

    const wisdomNodes = [...getNodes('W', projectId), ...getCrossProjectNodes('W', projectId)]
    const knowledgeNodes = [...getNodes('K', projectId), ...getCrossProjectNodes('K', projectId)]

    // Build the context object -- always include W and K
    const context = {
      projectId,
      wisdom: wisdomNodes.map(n => ({ id: n.id, content: n.content, from: n.projectId })),
      knowledge: knowledgeNodes.map(n => ({ id: n.id, content: n.content, from: n.projectId, tags: n.tags })),
      information: [],
      data: []
    }

    // If depth allows, include I and D
    if (depth === 'auto' || depth === 'I' || depth === 'D') {
      const infoNodes = getNodes('I', projectId)
      context.information = infoNodes.slice(-10).map(n => ({ id: n.id, content: n.content }))
    }
    if (depth === 'D') {
      const dataNodes = getNodes('D', projectId)
      context.data = dataNodes.slice(-15).map(n => ({ id: n.id, content: n.content?.slice(0, 200) }))
    }

    // If a task description is provided, use LLM to adapt the knowledge
    if (taskDesc && (knowledgeNodes.length > 0 || wisdomNodes.length > 0)) {
      const allKW = [...wisdomNodes, ...knowledgeNodes]
      const kwSummary = allKW.map((n, i) =>
        `[${i+1}] (${n.type}, from: ${n.projectId}) ${n.content?.slice(0, 400)}`
      ).join('\n')

      const adaptPrompt = `You are Mnemosyne's knowledge adaptation engine.
The user is starting a new session for project "${projectId}".
Task: ${taskDesc}

Below are Knowledge and Wisdom nodes from this and related projects.
For each node, determine:
1. Is it relevant to the current task? (yes/partial/no)
2. What parts are directly reusable?
3. What parts need adaptation? (e.g., different domain, different tech stack)
4. Any caveats or warnings?

Output a concise briefing (max 300 words) that the AI agent can use as context.
Focus on actionable guidance. Do NOT just copy the nodes — synthesize and adapt them.
If a skill from a different domain applies partially, explain what transfers and what does not.

Nodes:
${kwSummary}`

      const adapted = await callLLM(
        'You produce concise, actionable project briefings from existing knowledge. Be specific about what applies and what does not.',
        adaptPrompt
      )
      if (adapted) {
        context.adaptedBriefing = adapted
      }
    }

    // Generate a formatted text version for the hook to inject
    const lines = []
    if (context.adaptedBriefing) {
      lines.push('## Mnemosyne Knowledge Briefing', '', context.adaptedBriefing, '')
    } else {
      if (context.wisdom.length > 0) {
        lines.push('## Wisdom (Meta-level guidance)', '')
        context.wisdom.forEach(w => lines.push(`- [${w.from}] ${w.content}`, ''))
      }
      if (context.knowledge.length > 0) {
        lines.push('## Knowledge (Reusable skills)', '')
        context.knowledge.forEach(k => lines.push(`- [${k.from}] ${k.content}`, ''))
      }
    }
    context.formattedText = lines.join('\n')

    res.json(context)
  } catch (error) {
    console.error('Context error:', error)
    res.status(500).json({ error: 'Context retrieval failed' })
  }
})

// \u2500\u2500 GET /api/recommend/:projectId \u2014 Cross-project knowledge recommendations \u2500\u2500
app.get('/api/recommend/:projectId', (req, res) => {
  try {
    const { projectId } = req.params
    const limit = parseInt(req.query.limit) || 5
    const recommendations = recommendForProject(db, projectId, limit)
    res.json({ projectId, recommendations })
  } catch (error) {
    console.error('Recommend error:', error)
    res.status(500).json({ error: 'Recommendation failed' })
  }
})

// \u2500\u2500 POST /api/classify \u2500\u2500
app.post('/api/classify', (req, res) => {
  try {
    const { sessionId, projectId } = req.body
    const now = new Date().toISOString()
    dbRun('UPDATE sessions SET project_id = ?, classified_at = ? WHERE id = ?', [projectId, now, sessionId])
    saveDb()
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Classification failed' })
  }
})


// ── Helper: format tool call content for human readability ──
function formatToolContent(tool, input, output) {
  // Special case: assistant final response text (captured by Stop hook)
  if (tool === '__assistant_response__') {
    const text = input?.text || ''
    return text.slice(0, 8000)
  }

  const parts = []
  parts.push(tool || 'unknown')

  if (input) {
    // Edit: show file + diff
    if (input.old_string != null && input.new_string != null) {
      const fp = (input.file_path || '').replace(/\\/g, '/').split('/').slice(-2).join('/')
      const removed = input.old_string.trim().split('\n')[0].slice(0, 60)
      const added = input.new_string.trim().split('\n')[0].slice(0, 60)
      parts.push(': ' + fp + ' | "' + removed + '" \u2192 "' + added + '"')
    }
    // Write: show file + preview
    else if (input.content != null && input.file_path) {
      const fp = (input.file_path || 'file').replace(/\\/g, '/').split('/').slice(-2).join('/')
      const lines = (input.content.match(/\n/g) || []).length + 1
      const preview = input.content.trim().split('\n')[0].slice(0, 60)
      parts.push(': write ' + fp + ' (' + lines + ' lines) "' + preview + '"')
    }
    // Command (Bash)
    else if (input.command) {
      parts.push(': ' + input.command.slice(0, 120))
    }
    // Search pattern (Grep)
    else if (input.pattern) {
      parts.push(': search "' + input.pattern + '"' + (input.path ? ' in ' + input.path : ''))
    }
    // Generic file read
    else if (input.file_path) {
      const fp = input.file_path.replace(/\\/g, '/')
      const shortPath = fp.split('/').slice(-3).join('/')
      parts.push(': ' + shortPath)
    }
    // WebSearch
    else if (input.query) {
      parts.push(': "' + input.query.slice(0, 80) + '"')
    }
    // WebFetch — capture URL
    else if (input.url) {
      parts.push(': fetch ' + input.url.slice(0, 120))
    }
    // Fallback — include all keys for richer capture
    else {
      const keys = Object.keys(input).slice(0, 3)
      if (keys.length) parts.push(': ' + keys.map(k => k + '=' + String(input[k]).slice(0, 80)).join(', '))
    }
  }

  // Rich output capture — include more of the tool response for search/fetch
  if (output != null) {
    const o = typeof output === 'string' ? output.trim()
            : typeof output === 'object' ? JSON.stringify(output) : String(output)
    if (o.length > 0) {
      if (tool === 'WebSearch' || tool === 'WebFetch') {
        // Search/fetch results are the most valuable data — capture generously
        parts.push('\n--- Result ---\n' + o.slice(0, 3000))
      } else if (tool === 'Read') {
        const lines = o.split('\n').length
        parts.push(' (' + lines + ' lines)')
        if (lines <= 80) parts.push('\n' + o.slice(0, 2000))
      } else if (tool === 'Bash') {
        parts.push('\n\u2192 ' + o.slice(0, 1000))
      } else if (o.length < 200) {
        parts.push(' \u2192 ' + o)
      } else {
        parts.push(' \u2192 ' + o.slice(0, 500) + '...')
      }
    }
  }
  return parts.join('')
}
// ── Helper: ensure project exists in DB ──
const PROJECT_COLORS = ['#00897b','#e53935','#1e88e5','#7b1fa2','#f57c00','#43a047','#3949ab','#c62828','#00838f','#ad1457']
let _colorIdx = 0
function ensureProject(projectId) {
  const exists = dbGet('SELECT id FROM projects WHERE id = ?', [projectId])
  if (!exists) {
    const now = new Date().toISOString()
    const clean = projectId.replace(/[\\\\/:"'&|;$(){}]/g, '').replace(/\s+/g, ' ').trim()
    const name = clean.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || projectId
    const color = PROJECT_COLORS[_colorIdx % PROJECT_COLORS.length]
    _colorIdx++
    dbRun('INSERT OR IGNORE INTO projects (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [projectId, name, color, now, now])
    saveDb()
    console.log('Created project:', projectId, '->', name, color)
  }
}

// ── POST /api/hook/tool-use ──
app.post('/api/hook/tool-use', async (req, res) => {
  try {
    const { tool, session, timestamp, output, project } = req.body
    let { input } = req.body
    const now = new Date().toISOString()
    const nodeId = 'node_' + uuidv4()
    const sessionId = project || session || 'live-session'
    ensureProject(sessionId)

    // Parse input if it came as a string (old hook format compatibility)
    if (typeof input === 'string') {
      try { input = JSON.parse(input) } catch { input = { raw: input } }
    }

    // Determine node dtype: assistant-response vs tool-call
    const isAssistantResponse = tool === '__assistant_response__'
    const dtype = isAssistantResponse ? 'assistant' : 'tool-call'
    const tags = isAssistantResponse
      ? ['assistant', 'response', 'claude-code']
      : ['tool-call', tool || '', 'claude-code']

    // Format D node content to be human-readable
    let content = formatToolContent(tool, input, output)
    dbRun(
      `INSERT INTO nodes (id, type, project_id, source_platform, content, tags, dtype, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nodeId, 'D', sessionId, 'claude-code', content,
       JSON.stringify(tags), dtype, timestamp || now, now]
    )
    saveDb()
    const newNode = { id: nodeId, type: 'D', projectId: sessionId,
      sourcePlatform: 'claude-code', content, tags,
      dtype, createdAt: timestamp || now }
    broadcastToClients({ type: 'node:added', data: newNode })
    console.log(`[Hook] ${tool} → D node ${nodeId.slice(0,12)}... (${content.length} chars)`)
    res.json({ success: true, nodeId })

    // Batch mode: Stop hook sends skipAutoTransform=true for each D node,
    // then we debounce and auto-trigger DIKW pipeline after all nodes arrive
    if (req.body.skipAutoTransform) {
      // Debounce: reset timer each time a batch node arrives
      if (global._batchDIKWTimer) clearTimeout(global._batchDIKWTimer)
      const batchSessionId = sessionId
      global._batchDIKWTimer = setTimeout(async () => {
        try {
          const dataNodes = dbAll(
            `SELECT * FROM nodes WHERE project_id = ? AND type = 'D'
             AND id NOT IN (SELECT from_node_id FROM connections WHERE label = 'contextualizes')`,
            [batchSessionId]
          ).map(row => ({ id: row.id, type: row.type, projectId: row.project_id,
            sourcePlatform: row.source_platform, content: row.content,
            tags: JSON.parse(row.tags || '[]'), dtype: row.dtype, createdAt: row.created_at }))
          if (dataNodes.length < 2) return
          console.log(`[Batch DIKW] ${dataNodes.length} D nodes — running full pipeline for "${batchSessionId}"`)
          const result = await autoTransformBatch(dataNodes, { id: batchSessionId })
          if (result.nodes.length > 0) {
            result.nodes.forEach(node => insertNodeToDb(node))
            result.connections.forEach(conn => insertConnectionToDb(conn))
            saveDb()
            broadcastToClients({ type: 'graph:updated', data: getGraph() })
          }
          console.log(`[Batch DIKW] Complete: +${result.nodes.length} nodes`)
        } catch (e) { console.error('[Batch DIKW] Error:', e.message) }
      }, 2000) // Wait 2s after last D node before triggering
      return
    }

    // AI-powered auto-transform (locked to prevent concurrent transforms)
    lockedAutoTransform(
      sessionId,
      (type, label) => dbAll(
        `SELECT * FROM nodes WHERE project_id = ? AND type = ?
         AND id NOT IN (SELECT from_node_id FROM connections WHERE label = ?)`,
        [sessionId, type, label]
      ).map(row => ({ id: row.id, type: row.type, projectId: row.project_id,
        sourcePlatform: row.source_platform, content: row.content,
        tags: JSON.parse(row.tags || '[]'), dtype: row.dtype, createdAt: row.created_at })),
      insertNodeToDb, insertConnectionToDb, saveDb, broadcastToClients, getGraph
    ).catch(e => console.error('Auto DIKW error:', e.message))
  } catch (error) {
    console.error('Hook error:', error)
    if (!res.headersSent) res.status(500).json({ error: 'Hook processing failed' })
  }
})

// ── POST /api/hook/session-end ──
app.post('/api/hook/session-end', async (req, res) => {
  try {
    const { session, timestamp } = req.body
    const sessionId = session || 'live-session'
    const dataNodes = dbAll(
      `SELECT * FROM nodes WHERE project_id = ? AND type = 'D'
       AND id NOT IN (SELECT from_node_id FROM connections WHERE label = 'contextualizes')`,
      [sessionId]
    ).map(row => ({ id: row.id, type: row.type, projectId: row.project_id,
      sourcePlatform: row.source_platform, content: row.content,
      tags: JSON.parse(row.tags || '[]'), dtype: row.dtype, createdAt: row.created_at }))
    if (dataNodes.length < 2) {
      return res.json({ success: true, message: 'Not enough data nodes', count: dataNodes.length })
    }
    console.log('Session end:', dataNodes.length, 'untransformed D nodes - running pipeline')
    const result = await autoTransformBatch(dataNodes, { id: sessionId })
    if (result.nodes.length > 0) {
      result.nodes.forEach(node => insertNodeToDb(node))
      result.connections.forEach(conn => insertConnectionToDb(conn))
      saveDb()
      broadcastToClients({ type: 'graph:updated', data: getGraph() })
    }
    res.json({ success: true, transformed: result.nodes.length })
  } catch (error) {
    console.error('Session-end error:', error)
    res.status(500).json({ error: 'Session reflection failed' })
  }
})

// -- POST /api/aggregate -- Cross-project K/W aggregation --
app.post('/api/aggregate', async (req, res) => {
  try {
    // Gather ALL untransformed I nodes across ALL projects
    const allI = dbAll(
      `SELECT * FROM nodes WHERE type = 'I'
       AND id NOT IN (SELECT from_node_id FROM connections WHERE label = 'synthesizes')`
    ).map(row => ({
      id: row.id, type: row.type, projectId: row.project_id,
      sourcePlatform: row.source_platform, content: row.content,
      tags: JSON.parse(row.tags || '[]'), dtype: row.dtype, createdAt: row.created_at
    }))

    console.log('[Aggregate] Found', allI.length, 'untransformed I nodes across all projects')
    if (allI.length < 1) {
      return res.json({ success: true, message: 'No untransformed I nodes', generated: [] })
    }

    const generated = []

    // Generate K from all I nodes (cross-project)
    const kResult = await transformInfoToKnowledge(allI, { id: 'cross-project' })
    if (kResult.node) {
      kResult.node.projectId = 'cross-project'
      kResult.node.tags.push('cross-project')
      ensureProject('cross-project')
      insertNodeToDb(kResult.node)
      kResult.connections.forEach(c => insertConnectionToDb(c))
      generated.push(kResult.node)
      console.log('[Aggregate] Generated K node:', kResult.node.id)

      // Now gather ALL untransformed K nodes and generate W
      const allK = dbAll(
        `SELECT * FROM nodes WHERE type = 'K'
         AND id NOT IN (SELECT from_node_id FROM connections WHERE label = 'judges')`
      ).map(row => ({
        id: row.id, type: row.type, projectId: row.project_id,
        sourcePlatform: row.source_platform, content: row.content,
        tags: JSON.parse(row.tags || '[]'), dtype: row.dtype, createdAt: row.created_at
      }))

      if (allK.length >= 1) {
        const wResult = await transformKnowledgeToWisdom(allK, { id: 'cross-project' })
        if (wResult.node) {
          wResult.node.projectId = 'cross-project'
          wResult.node.tags.push('cross-project')
          insertNodeToDb(wResult.node)
          wResult.connections.forEach(c => insertConnectionToDb(c))
          generated.push(wResult.node)
          console.log('[Aggregate] Generated W node:', wResult.node.id)
        }
      }
    }

    saveDb()
    broadcastToClients({ type: 'graph:updated', data: getGraph() })
    res.json({ success: true, generated: generated.map(n => ({ id: n.id, type: n.type, content: n.content?.slice(0, 200) })) })
  } catch (error) {
    console.error('Aggregate error:', error)
    res.status(500).json({ error: 'Aggregation failed' })
  }
})

// \u2500\u2500 GET /api/nodes \u2014 Query nodes with filters \u2500\u2500
app.get('/api/nodes', (req, res) => {
  try {
    const { type, project } = req.query
    let sql = 'SELECT * FROM nodes WHERE 1=1'
    const params = []
    if (type) { sql += ' AND type = ?'; params.push(type) }
    if (project) { sql += ' AND project_id = ?'; params.push(project) }

    const nodes = dbAll(sql, params).map(row => ({
      id: row.id, type: row.type, projectId: row.project_id,
      content: row.content, tags: JSON.parse(row.tags || '[]'), createdAt: row.created_at
    }))
    res.json(nodes)
  } catch (error) {
    res.status(500).json({ error: 'Query failed' })
  }
})


// -- GET /api/inbox -- Get unclassified nodes --
app.get('/api/inbox', (req, res) => {
  try {
    const unclassified = dbAll("SELECT * FROM nodes WHERE project_id = 'unclassified' OR project_id IS NULL ORDER BY created_at DESC LIMIT 200")
      .map(row => ({
        id: row.id, type: row.type, projectId: row.project_id,
        content: row.content, tags: JSON.parse(row.tags || '[]'),
        sourcePlatform: row.source_platform, dtype: row.dtype, createdAt: row.created_at
      }))
    const groups = {}
    unclassified.forEach(node => {
      const date = node.createdAt ? node.createdAt.split('T')[0] : 'unknown'
      const key = (node.sourcePlatform || 'unknown') + '_' + date
      if (!groups[key]) {
        groups[key] = { id: key, platform: node.sourcePlatform || 'unknown', date, nodes: [], preview: '' }
      }
      groups[key].nodes.push(node)
    })
    const sessions = Object.values(groups).map(g => {
      g.preview = g.nodes.slice(0, 3).map(n => n.content.slice(0, 100)).join(' | ')
      g.nodeCount = g.nodes.length
      return g
    })
    res.json({ sessions, totalUnclassified: unclassified.length })
  } catch (error) {
    console.error('Inbox error:', error)
    res.status(500).json({ error: 'Inbox query failed' })
  }
})

// -- POST /api/classify -- Auto-classification of unclassified nodes --
app.post('/api/classify', async (req, res) => {
  try {
    const { nodeIds, projectId: manualProjectId } = req.body
    const projects = dbAll('SELECT id, name FROM projects')
    let nodesToClassify
    if (nodeIds && nodeIds.length > 0) {
      const ph = nodeIds.map(() => '?').join(',')
      nodesToClassify = dbAll(`SELECT * FROM nodes WHERE id IN (${ph})`, nodeIds)
    } else {
      nodesToClassify = dbAll("SELECT * FROM nodes WHERE project_id = 'unclassified' LIMIT 50")
    }
    if (nodesToClassify.length === 0) return res.json({ classified: 0, results: [] })
    if (manualProjectId) {
      nodesToClassify.forEach(n => dbRun('UPDATE nodes SET project_id = ? WHERE id = ?', [manualProjectId, n.id]))
      saveDb()
      broadcastToClients({ type: "nodes:updated" })
      return res.json({ classified: nodesToClassify.length, projectId: manualProjectId })
    }
    const projectList = projects.map(p => p.id + ' (' + p.name + ')').join(', ')
    const nodeSnippets = nodesToClassify.slice(0, 20).map((n, i) => (i+1) + '. [' + n.type + '] ' + n.content.slice(0, 200)).join('\n')
    const prompt = `Classify these nodes into a project.\nExisting projects: ${projectList}\nIf none fit, suggest a new project name.\nNodes:\n${nodeSnippets}\n\nReply as JSON: {"projectId": "id", "projectName": "name", "confidence": 0.0-1.0, "reason": "why"}`
    let classification
    try {
      const llmResult = await callLLM('You classify development session data into projects.', prompt)
      const jsonMatch = llmResult.match(/\{[\s\S]*?\}/)
      classification = jsonMatch ? JSON.parse(jsonMatch[0]) : null
    } catch (e) {
      console.log('LLM classification failed:', e.message)
      classification = null
    }
    if (!classification) return res.json({ classified: 0, error: 'LLM classification failed' })
    let targetProjectId = classification.projectId
    const existingProject = dbGet('SELECT id FROM projects WHERE id = ?', [targetProjectId])
    if (!existingProject) {
      const now = new Date().toISOString()
      const name = classification.projectName || targetProjectId
      dbRun('INSERT INTO projects (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [targetProjectId, name, '#7b1fa2', now, now])
    }
    nodesToClassify.forEach(n => dbRun('UPDATE nodes SET project_id = ? WHERE id = ?', [targetProjectId, n.id]))
    saveDb()
    broadcastToClients({ type: "nodes:updated" })
    res.json({ classified: nodesToClassify.length, projectId: targetProjectId, projectName: classification.projectName, confidence: classification.confidence, reason: classification.reason })
  } catch (error) {
    console.error('Classify error:', error)
    res.status(500).json({ error: 'Classification failed' })
  }
})

// -- GET /api/recommendations/:projectId -- Cross-project recommendations --
app.get('/api/recommendations/:projectId', (req, res) => {
  try {
    const { projectId } = req.params
    const limit = parseInt(req.query.limit) || 10
    const recommendations = recommendForProject(db, projectId, limit)
    res.json(recommendations)
  } catch (error) {
    res.status(500).json({ error: 'Recommendations failed' })
  }
})

// \u2500\u2500 GET /api/stats \u2014 Dashboard stats \u2500\u2500
app.get('/api/stats', (req, res) => {
  try {
    const totalNodes = dbGet('SELECT COUNT(*) as count FROM nodes')?.count || 0
    const byType = {}
    ;['D', 'I', 'K', 'W'].forEach(t => {
      byType[t] = dbGet('SELECT COUNT(*) as count FROM nodes WHERE type = ?', [t])?.count || 0
    })
    const totalConnections = dbGet('SELECT COUNT(*) as count FROM connections')?.count || 0
    const totalProjects = dbGet('SELECT COUNT(*) as count FROM projects')?.count || 0

    res.json({ totalNodes, byType, totalConnections, totalProjects })
  } catch (error) {
    res.status(500).json({ error: 'Stats failed' })
  }
})



// Helper: generate AGENTS.md from template (fallback when LLM unavailable)
function generateAgentsMd(kNodes, wNodes, projectName = 'Project') {
  let md = `# AGENTS.md - ${projectName}\n\n`
  md += `## Project Overview\n\nThis project uses knowledge extracted by Mnemosyne DIKW.\n\n`
  if (kNodes.length > 0) {
    md += `## Code Patterns & Conventions\n\n`
    kNodes.forEach((k, i) => { md += `${i+1}. ${k.content}\n\n` })
  }
  if (wNodes.length > 0) {
    md += `## Principles & Guidelines\n\n`
    wNodes.forEach((w, i) => { md += `${i+1}. ${w.content}\n\n` })
  }
  md += `---\n*Generated by Mnemosyne DIKW*\n`
  return md
}
// -- POST /api/export/agents/:projectId -- Export Knowledge as AGENTS.md (for Codex) --
app.post('/api/export/agents/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params
    const deploy = req.query.deploy === 'true'
    const targetDir = req.body?.targetDir
    const project = dbGet('SELECT * FROM projects WHERE id = ?', [projectId])
    const kNodes = dbAll('SELECT * FROM nodes WHERE project_id = ? AND type = ?', [projectId, 'K'])
      .map(row => ({ id: row.id, content: row.content, tags: JSON.parse(row.tags || '[]') }))
    const wNodes = dbAll('SELECT * FROM nodes WHERE project_id = ? AND type = ?', [projectId, 'W'])
      .map(row => ({ id: row.id, content: row.content, tags: JSON.parse(row.tags || '[]') }))

    if (kNodes.length === 0 && wNodes.length === 0) {
      return res.status(404).json({ error: 'No knowledge or wisdom nodes for AGENTS.md' })
    }

    let markdown
    try {
      const prompt = `Generate an AGENTS.md file for a Codex CLI project.
This file provides instructions to OpenAI's Codex coding agent.

Project: ${project?.name || projectId}

Knowledge (reusable patterns):
${kNodes.map((k, i) => `${i+1}. ${k.content}`).join('\n')}

Wisdom (principles):
${wNodes.map((w, i) => `${i+1}. ${w.content}`).join('\n')}

Output a well-structured AGENTS.md with:
1. Project overview
2. Code patterns and conventions
3. Key guidelines and principles
4. Common pitfalls to avoid
Keep it concise and actionable for a coding agent.`
      markdown = await callLLM('You create AGENTS.md files that help coding agents work effectively.', prompt)
      if (!markdown) markdown = generateAgentsMd(kNodes, wNodes, project?.name || 'Project')
    } catch (e) {
      console.log('LLM AGENTS.md generation failed, using template:', e.message)
      markdown = generateAgentsMd(kNodes, wNodes, project?.name || 'Project')
    }

    if (deploy) {
      let agentsPath
      if (targetDir && fs.existsSync(targetDir)) {
        agentsPath = path.join(targetDir, 'AGENTS.md')
      } else {
        const homeDir = process.env.USERPROFILE || process.env.HOME
        const projDir = path.join(homeDir, '.codex', 'projects', `mnemosyne-${projectId.replace(/[^a-zA-Z0-9_-]/g, '-')}`)
        fs.mkdirSync(projDir, { recursive: true })
        agentsPath = path.join(projDir, 'AGENTS.md')
      }

      const marker = '<!-- MNEMOSYNE-AGENTS-START -->'
      const endMarker = '<!-- MNEMOSYNE-AGENTS-END -->'
      const block = `${marker}\n${markdown}\n${endMarker}`

      if (fs.existsSync(agentsPath)) {
        let existing = fs.readFileSync(agentsPath, 'utf-8')
        if (existing.includes(marker)) {
          const si = existing.indexOf(marker)
          const ei = existing.indexOf(endMarker) + endMarker.length
          existing = existing.slice(0, si) + block + existing.slice(ei)
        } else {
          existing += '\n\n' + block
        }
        fs.writeFileSync(agentsPath, existing)
      } else {
        fs.writeFileSync(agentsPath, block)
      }
      console.log(`Deployed AGENTS.md to ${agentsPath}`)
      return res.json({ deployed: true, path: agentsPath, markdown })
    }

    res.json({ markdown })
  } catch (error) {
    console.error('AGENTS.md export error:', error)
    res.status(500).json({ error: 'AGENTS.md export failed' })
  }
})
// \u2500\u2500 MCP Server endpoint (for external agents to query) \u2500\u2500
app.post('/api/mcp', (req, res) => {
  try {
    const { method, params } = req.body

    if (method === 'tools/list') {
      return res.json({
        tools: [
          { name: 'query_knowledge', description: 'Query knowledge by type/project/tags',
            inputSchema: { type: 'object', properties: { type: { type: 'string' }, project: { type: 'string' }, tags: { type: 'array' } } } },
          { name: 'get_skill', description: 'Get a specific skill node',
            inputSchema: { type: 'object', properties: { skillId: { type: 'string' } }, required: ['skillId'] } },
          { name: 'record_learning', description: 'Record a new insight',
            inputSchema: { type: 'object', properties: { content: { type: 'string' }, type: { type: 'string', enum: ['D','I','K','W'] }, tags: { type: 'array' }, project: { type: 'string' } }, required: ['content', 'type'] } }
          ,{ name: 'get_project_context', description: 'Get hierarchical DIKW context for a project (W->K->I->D). Use at session start to load project knowledge.',
            inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Project ID' }, task: { type: 'string', description: 'Optional current task description for adapted briefing' } }, required: ['project'] } },
          { name: 'suggest_skills', description: 'Get skill recommendations for a project based on tag overlap with other projects.',
            inputSchema: { type: 'object', properties: { project: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['project'] } },
          { name: 'export_knowledge', description: 'Deploy a Knowledge node as SKILL.md to ~/.claude/skills/ or Wisdom as CLAUDE.md.',
            inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, type: { type: 'string', enum: ['skill', 'claude'] } }, required: ['nodeId', 'type'] } },
          { name: 'search_knowledge', description: 'Full-text search across all DIKW nodes.',
            inputSchema: { type: 'object', properties: { query: { type: 'string' }, type: { type: 'string', enum: ['D','I','K','W'] }, limit: { type: 'number' } }, required: ['query'] } }
        ]
      })
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params || {}

      if (name === 'query_knowledge') {
        let sql = 'SELECT * FROM nodes WHERE 1=1'
        const sqlParams = []
        if (args.type) { sql += ' AND type = ?'; sqlParams.push(args.type) }
        if (args.project) { sql += ' AND project_id = ?'; sqlParams.push(args.project) }
        const results = dbAll(sql, sqlParams).map(row => ({
          id: row.id, type: row.type, content: row.content, tags: JSON.parse(row.tags || '[]')
        }))
        return res.json({ content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] })
      }

      if (name === 'get_skill') {
        const skill = dbGet('SELECT * FROM nodes WHERE id = ? AND type = ?', [args.skillId, 'K'])
        if (!skill) return res.json({ content: [{ type: 'text', text: 'Skill not found' }] })
        return res.json({ content: [{ type: 'text', text: JSON.stringify({
          id: skill.id, content: skill.content, tags: JSON.parse(skill.tags || '[]')
        }, null, 2) }] })
      }

      if (name === 'record_learning') {
        const nodeId = `node_${uuidv4()}`
        const now = new Date().toISOString()
        dbRun(
          `INSERT INTO nodes (id, type, project_id, source_platform, content, tags, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [nodeId, args.type, args.project || 'mcp-input', 'mcp-agent', args.content,
           JSON.stringify(args.tags || []), now, now]
        )
        saveDb()
        broadcastToClients({ type: 'node:added', data: { id: nodeId, type: args.type, content: args.content } })
        return res.json({ content: [{ type: 'text', text: JSON.stringify({ success: true, nodeId }) }] })
      }
      if (name === 'get_project_context') {
        // Reuse the /api/context endpoint logic
        const projectId = args.project
        const depth = 'auto'
        const wisdomNodes = dbAll('SELECT * FROM nodes WHERE type = ? AND (project_id = ? OR project_id = ?)', ['W', projectId, 'cross-project'])
        const knowledgeNodes = dbAll('SELECT * FROM nodes WHERE type = ? AND (project_id = ? OR project_id = ?)', ['K', projectId, 'cross-project'])
        const infoNodes = dbAll('SELECT * FROM nodes WHERE type = ? AND project_id = ?', ['I', projectId])
        const result = {
          wisdom: wisdomNodes.map(r => ({ id: r.id, content: r.content, tags: JSON.parse(r.tags || '[]') })),
          knowledge: knowledgeNodes.map(r => ({ id: r.id, content: r.content, tags: JSON.parse(r.tags || '[]') })),
          information: infoNodes.map(r => ({ id: r.id, content: r.content, tags: JSON.parse(r.tags || '[]') }))
        }
        // Build formatted text
        let text = '# Project Context: ' + projectId + '\n\n'
        if (result.wisdom.length) { text += '## Wisdom\n'; result.wisdom.forEach(w => { text += '- ' + w.content.slice(0, 300) + '\n' }); text += '\n' }
        if (result.knowledge.length) { text += '## Knowledge\n'; result.knowledge.forEach(k => { text += '- ' + k.content.slice(0, 300) + '\n' }); text += '\n' }
        if (result.information.length) { text += '## Information\n'; result.information.forEach(i => { text += '- ' + i.content.slice(0, 200) + '\n' }); text += '\n' }
        return res.json({ content: [{ type: 'text', text }] })
      }

      if (name === 'suggest_skills') {
        const projectId = args.project
        const inputTags = args.tags || []
        // Get tags from current project if not provided
        let tags = inputTags
        if (tags.length === 0) {
          const projNodes = dbAll('SELECT tags FROM nodes WHERE project_id = ?', [projectId])
          const tagSet = new Set()
          projNodes.forEach(r => { JSON.parse(r.tags || '[]').forEach(t => tagSet.add(t)) })
          tags = Array.from(tagSet)
        }
        // Find K nodes from OTHER projects that share tags
        const allK = dbAll("SELECT * FROM nodes WHERE type = 'K' AND project_id != ?", [projectId])
        const scored = allK.map(row => {
          const nodeTags = JSON.parse(row.tags || '[]')
          const overlap = nodeTags.filter(t => tags.includes(t)).length
          return { ...row, tags: nodeTags, overlap }
        }).filter(n => n.overlap > 0).sort((a, b) => b.overlap - a.overlap).slice(0, 10)
        const suggestions = scored.map(s => ({
          id: s.id, project: s.project_id, content: s.content.slice(0, 200),
          tags: s.tags, overlap: s.overlap
        }))
        return res.json({ content: [{ type: 'text', text: JSON.stringify(suggestions, null, 2) }] })
      }

      if (name === 'export_knowledge') {
        const { nodeId, type: exportType } = args
        if (exportType === 'skill') {
          const node = dbGet('SELECT * FROM nodes WHERE id = ? AND type = ?', [nodeId, 'K'])
          if (!node) return res.json({ content: [{ type: 'text', text: 'Knowledge node not found' }] })
          const knowledgeNode = { id: node.id, content: node.content, tags: JSON.parse(node.tags || '[]') }
          const markdown = generateSkillMd(knowledgeNode, [])
          const projectName = (node.project_id || 'general').replace(/[^a-zA-Z0-9_-]/g, '-')
          const homeDir = process.env.USERPROFILE || process.env.HOME
          const skillDir = path.join(homeDir, '.claude', 'skills', 'mnemosyne-' + projectName)
          fs.mkdirSync(skillDir, { recursive: true })
          const skillPath = path.join(skillDir, 'SKILL.md')
          if (fs.existsSync(skillPath) && fs.readFileSync(skillPath, 'utf-8').includes('mnemosyne-node:' + nodeId)) {
            return res.json({ content: [{ type: 'text', text: 'Already deployed to ' + skillPath }] })
          }
          const prefix = '<!-- mnemosyne-node:' + nodeId + ' -->\n'
          if (fs.existsSync(skillPath)) { fs.appendFileSync(skillPath, '\n\n' + prefix + markdown) }
          else { fs.writeFileSync(skillPath, prefix + markdown) }
          return res.json({ content: [{ type: 'text', text: 'Deployed SKILL.md to ' + skillPath }] })
        }
        if (exportType === 'claude') {
          const node = dbGet('SELECT * FROM nodes WHERE id = ?', [nodeId])
          if (!node) return res.json({ content: [{ type: 'text', text: 'Node not found' }] })
          const projectId = node.project_id || 'general'
          const wisdomNodes = dbAll('SELECT * FROM nodes WHERE project_id = ? AND type = ?', [projectId, 'W'])
            .map(r => ({ id: r.id, content: r.content, tags: JSON.parse(r.tags || '[]') }))
          const markdown = generateClaudeMd(wisdomNodes, projectId)
          const homeDir = process.env.USERPROFILE || process.env.HOME
          const projDir = path.join(homeDir, '.claude', 'projects', 'mnemosyne-' + projectId.replace(/[^a-zA-Z0-9_-]/g, '-'))
          fs.mkdirSync(projDir, { recursive: true })
          const claudePath = path.join(projDir, 'CLAUDE.md')
          fs.writeFileSync(claudePath, '<!-- MNEMOSYNE-WISDOM-START -->\n' + markdown + '\n<!-- MNEMOSYNE-WISDOM-END -->')
          return res.json({ content: [{ type: 'text', text: 'Deployed CLAUDE.md to ' + claudePath }] })
        }
        return res.json({ content: [{ type: 'text', text: 'Unknown export type. Use skill or claude.' }] })
      }

      if (name === 'search_knowledge') {
        const { query, type: filterType, limit: maxResults } = args
        const lim = maxResults || 20
        let sql = "SELECT * FROM nodes WHERE content LIKE ?"
        const params = ['%' + query + '%']
        if (filterType) { sql += ' AND type = ?'; params.push(filterType) }
        sql += ' ORDER BY created_at DESC LIMIT ?'
        params.push(lim)
        const results = dbAll(sql, params).map(row => ({
          id: row.id, type: row.type, project: row.project_id,
          content: row.content.slice(0, 300), tags: JSON.parse(row.tags || '[]')
        }))
        return res.json({ content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] })
      }

    }


    res.status(400).json({ error: 'Unknown MCP method' })
  } catch (error) {
    console.error('MCP error:', error)
    res.status(500).json({ error: 'MCP request failed' })
  }
})


// ============================================================
// Platform Management APIs (Connect / Share)
// ============================================================

// -- GET /api/platform/mcps -- List MCP servers from Claude Code + Codex --
app.get('/api/platform/mcps', (req, res) => {
  try {
    const homeDir = process.env.USERPROFILE || process.env.HOME
    const mcps = []

    // Claude Code: ~/.claude/.mcp.json
    const claudeMcpPath = path.join(homeDir, '.claude', '.mcp.json')
    if (fs.existsSync(claudeMcpPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(claudeMcpPath, 'utf-8'))
        for (const [name, cfg] of Object.entries(data.mcpServers || {})) {
          mcps.push({ id: name, name, platform: 'claude-code', command: cfg.command, args: cfg.args || [], url: cfg.url || null })
        }
      } catch (e) { console.error('Error reading Claude MCP config:', e.message) }
    }

    // Codex: ~/.codex/config.toml [mcp_servers.*]
    const codexCfgPath = path.join(homeDir, '.codex', 'config.toml')
    if (fs.existsSync(codexCfgPath)) {
      try {
        const toml = fs.readFileSync(codexCfgPath, 'utf-8')
        // Simple TOML parser for [mcp_servers.*] sections
        const mcpRegex = /\[mcp_servers\.([^\]]+)\]/g
        let match
        while ((match = mcpRegex.exec(toml)) !== null) {
          const name = match[1]
          // Extract fields after this section header until next section
          const sectionStart = match.index + match[0].length
          const nextSection = toml.indexOf('\n[', sectionStart)
          const section = toml.slice(sectionStart, nextSection === -1 ? undefined : nextSection)
          const urlMatch = section.match(/url\s*=\s*"([^"]+)"/)
          const cmdMatch = section.match(/command\s*=\s*"([^"]+)"/)
          const argsMatch = section.match(/args\s*=\s*\[([^\]]+)\]/)
          mcps.push({
            id: name, name, platform: 'codex',
            command: cmdMatch ? cmdMatch[1] : null,
            args: argsMatch ? argsMatch[1].split(',').map(s => s.trim().replace(/"/g, '')) : [],
            url: urlMatch ? urlMatch[1] : null
          })
        }
      } catch (e) { console.error('Error reading Codex config:', e.message) }
    }

    // Mark shared (same name on both platforms)
    const claudeNames = new Set(mcps.filter(m => m.platform === 'claude-code').map(m => m.name))
    const codexNames = new Set(mcps.filter(m => m.platform === 'codex').map(m => m.name))
    mcps.forEach(m => {
      m.shared = (m.platform === 'claude-code' && codexNames.has(m.name)) || (m.platform === 'codex' && claudeNames.has(m.name))
    })

    res.json({ mcps })
  } catch (error) {
    res.status(500).json({ error: 'Failed to list MCPs' })
  }
})

// -- POST /api/platform/mcps/sync -- Sync an MCP server between platforms --
app.post('/api/platform/mcps/sync', (req, res) => {
  try {
    const { name, fromPlatform } = req.body
    if (!name || !fromPlatform) return res.status(400).json({ error: 'name and fromPlatform required' })
    const homeDir = process.env.USERPROFILE || process.env.HOME

    if (fromPlatform === 'claude-code') {
      // Read from Claude → write to Codex
      const claudeMcpPath = path.join(homeDir, '.claude', '.mcp.json')
      const data = JSON.parse(fs.readFileSync(claudeMcpPath, 'utf-8'))
      const cfg = (data.mcpServers || {})[name]
      if (!cfg) return res.status(404).json({ error: `MCP "${name}" not found in Claude Code` })

      const codexCfgPath = path.join(homeDir, '.codex', 'config.toml')
      let toml = fs.existsSync(codexCfgPath) ? fs.readFileSync(codexCfgPath, 'utf-8') : ''
      // Check if section already exists
      if (toml.includes(`[mcp_servers.${name}]`)) {
        return res.json({ ok: true, message: 'Already exists in Codex' })
      }
      // Append new MCP section
      toml += `\n[mcp_servers.${name}]\n`
      if (cfg.url) {
        toml += `url = "${cfg.url}"\n`
      } else {
        toml += `command = "${cfg.command}"\n`
        if (cfg.args && cfg.args.length) toml += `args = [${cfg.args.map(a => `"${a}"`).join(', ')}]\n`
      }
      fs.writeFileSync(codexCfgPath, toml)
      res.json({ ok: true, message: `Synced "${name}" to Codex` })

    } else if (fromPlatform === 'codex') {
      // Read from Codex → write to Claude
      const codexCfgPath = path.join(homeDir, '.codex', 'config.toml')
      const toml = fs.readFileSync(codexCfgPath, 'utf-8')
      const mcpRegex = new RegExp(`\\[mcp_servers\\.${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`)
      const match = mcpRegex.exec(toml)
      if (!match) return res.status(404).json({ error: `MCP "${name}" not found in Codex` })

      const sectionStart = match.index + match[0].length
      const nextSection = toml.indexOf('\n[', sectionStart)
      const section = toml.slice(sectionStart, nextSection === -1 ? undefined : nextSection)
      const urlMatch = section.match(/url\s*=\s*"([^"]+)"/)
      const cmdMatch = section.match(/command\s*=\s*"([^"]+)"/)
      const argsMatch = section.match(/args\s*=\s*\[([^\]]+)\]/)

      const claudeMcpPath = path.join(homeDir, '.claude', '.mcp.json')
      const data = fs.existsSync(claudeMcpPath) ? JSON.parse(fs.readFileSync(claudeMcpPath, 'utf-8')) : {}
      if (!data.mcpServers) data.mcpServers = {}
      if (data.mcpServers[name]) return res.json({ ok: true, message: 'Already exists in Claude Code' })

      data.mcpServers[name] = {}
      if (urlMatch) {
        data.mcpServers[name].url = urlMatch[1]
      } else {
        if (cmdMatch) data.mcpServers[name].command = cmdMatch[1]
        if (argsMatch) data.mcpServers[name].args = argsMatch[1].split(',').map(s => s.trim().replace(/"/g, ''))
      }
      fs.writeFileSync(claudeMcpPath, JSON.stringify(data, null, 2))
      res.json({ ok: true, message: `Synced "${name}" to Claude Code` })

    } else {
      res.status(400).json({ error: 'Invalid fromPlatform' })
    }
  } catch (error) {
    console.error('MCP sync error:', error.message)
    res.status(500).json({ error: 'Failed to sync MCP' })
  }
})

// -- GET /api/platform/skills -- List Skills from both platforms --
app.get('/api/platform/skills', (req, res) => {
  try {
    const homeDir = process.env.USERPROFILE || process.env.HOME
    const skills = []

    const scanSkills = (basePath, platform) => {
      if (!fs.existsSync(basePath)) return
      const dirs = fs.readdirSync(basePath).filter(d => {
        const fullPath = path.join(basePath, d)
        return fs.statSync(fullPath).isDirectory()
      })
      for (const dir of dirs) {
        const skillPath = path.join(basePath, dir, 'SKILL.md')
        if (fs.existsSync(skillPath)) {
          const content = fs.readFileSync(skillPath, 'utf-8')
          const stat = fs.statSync(skillPath)
          const titleMatch = content.match(/^#\s+(.+)/m)
          skills.push({
            id: dir, name: titleMatch ? titleMatch[1] : dir,
            platform, path: skillPath,
            size: content.length,
            updatedAt: stat.mtime.toISOString(),
            preview: content.slice(0, 300),
            isMnemosyne: dir.startsWith('mnemosyne-')
          })
        }
      }
    }

    scanSkills(path.join(homeDir, '.claude', 'skills'), 'claude-code')
    scanSkills(path.join(homeDir, '.codex', 'skills'), 'codex')

    // Mark shared skills (same dir name on both platforms)
    const claudeIds = new Set(skills.filter(s => s.platform === 'claude-code').map(s => s.id))
    const codexIds = new Set(skills.filter(s => s.platform === 'codex').map(s => s.id))
    skills.forEach(s => {
      s.shared = (s.platform === 'claude-code' && codexIds.has(s.id)) || (s.platform === 'codex' && claudeIds.has(s.id))
    })

    res.json({ skills })
  } catch (error) {
    res.status(500).json({ error: 'Failed to list skills' })
  }
})

// -- GET /api/platform/skills/:platform/:id/content -- Read a skill --
app.get('/api/platform/skills/:platform/:id/content', (req, res) => {
  try {
    const { platform, id } = req.params
    const homeDir = process.env.USERPROFILE || process.env.HOME
    const base = platform === 'codex' ? '.codex' : '.claude'
    const fp = path.join(homeDir, base, 'skills', id, 'SKILL.md')
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' })
    res.json({ content: fs.readFileSync(fp, 'utf-8'), path: fp })
  } catch (error) { res.status(500).json({ error: 'Read failed' }) }
})

// -- POST /api/platform/skills/sync -- Sync a skill to the other platform --
app.post('/api/platform/skills/sync', (req, res) => {
  try {
    const { id, fromPlatform } = req.body
    const homeDir = process.env.USERPROFILE || process.env.HOME
    const fromBase = fromPlatform === 'codex' ? '.codex' : '.claude'
    const toBase = fromPlatform === 'codex' ? '.claude' : '.codex'
    const srcDir = path.join(homeDir, fromBase, 'skills', id)
    const destDir = path.join(homeDir, toBase, 'skills', id)
    if (!fs.existsSync(srcDir)) return res.status(404).json({ error: 'Source skill not found' })

    // Recursively copy entire skill directory
    function copyDirRecursive(src, dest) {
      fs.mkdirSync(dest, { recursive: true })
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name)
        const destPath = path.join(dest, entry.name)
        if (entry.isDirectory()) copyDirRecursive(srcPath, destPath)
        else fs.copyFileSync(srcPath, destPath)
      }
    }
    copyDirRecursive(srcDir, destDir)
    const toPlatform = fromPlatform === 'codex' ? 'claude-code' : 'codex'
    console.log(`Synced skill "${id}" from ${fromPlatform} to ${toPlatform}`)
    res.json({ synced: true, from: fromPlatform, to: toPlatform, path: destDir })
  } catch (error) { res.status(500).json({ error: 'Sync failed: ' + error.message }) }
})

// -- DELETE /api/platform/skills/:platform/:id -- Remove a skill --
app.delete('/api/platform/skills/:platform/:id', (req, res) => {
  try {
    const { platform, id } = req.params
    const homeDir = process.env.USERPROFILE || process.env.HOME
    const base = platform === 'codex' ? '.codex' : '.claude'
    const dir = path.join(homeDir, base, 'skills', id)
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Not found' })
    fs.rmSync(dir, { recursive: true })
    console.log(`Removed skill "${id}" from ${platform}`)
    res.json({ removed: true })
  } catch (error) { res.status(500).json({ error: 'Remove failed' }) }
})

// -- GET /api/platform/rules -- List project-level CLAUDE.md / AGENTS.md --
app.get('/api/platform/rules', (req, res) => {
  try {
    const homeDir = process.env.USERPROFILE || process.env.HOME
    const rules = []

    // Claude Code: ~/.claude/projects/mnemosyne-*/CLAUDE.md
    const claudeProjBase = path.join(homeDir, '.claude', 'projects')
    if (fs.existsSync(claudeProjBase)) {
      const dirs = fs.readdirSync(claudeProjBase).filter(d => d.startsWith('mnemosyne-'))
      for (const dir of dirs) {
        const fp = path.join(claudeProjBase, dir, 'CLAUDE.md')
        if (fs.existsSync(fp)) {
          const ct = fs.readFileSync(fp, 'utf-8')
          const stat = fs.statSync(fp)
          rules.push({
            id: dir, platform: 'claude-code', type: 'CLAUDE.md',
            name: dir.replace('mnemosyne-', '').replace(/^project_/, ''),
            path: fp, size: ct.length,
            updatedAt: stat.mtime.toISOString(),
            preview: ct.slice(0, 300)
          })
        }
      }
    }

    // Codex: ~/.codex/projects/mnemosyne-*/AGENTS.md
    const codexProjBase = path.join(homeDir, '.codex', 'projects')
    if (fs.existsSync(codexProjBase)) {
      const dirs = fs.readdirSync(codexProjBase).filter(d => d.startsWith('mnemosyne-'))
      for (const dir of dirs) {
        const fp = path.join(codexProjBase, dir, 'AGENTS.md')
        if (fs.existsSync(fp)) {
          const ct = fs.readFileSync(fp, 'utf-8')
          const stat = fs.statSync(fp)
          rules.push({
            id: dir, platform: 'codex', type: 'AGENTS.md',
            name: dir.replace('mnemosyne-', '').replace(/^project_/, ''),
            path: fp, size: ct.length,
            updatedAt: stat.mtime.toISOString(),
            preview: ct.slice(0, 300)
          })
        }
      }
    }

    // Group by project name to show sync status
    const grouped = {}
    rules.forEach(r => {
      if (!grouped[r.id]) grouped[r.id] = { id: r.id, name: r.name, platforms: {} }
      grouped[r.id].platforms[r.platform] = r
    })

    res.json({ rules, grouped: Object.values(grouped) })
  } catch (error) {
    res.status(500).json({ error: 'Failed to list rules' })
  }
})

// -- GET /api/platform/rules/:platform/:id/content -- Read rules content --
app.get('/api/platform/rules/:platform/:id/content', (req, res) => {
  try {
    const { platform, id } = req.params
    const homeDir = process.env.USERPROFILE || process.env.HOME
    const base = platform === 'codex' ? '.codex' : '.claude'
    const fname = platform === 'codex' ? 'AGENTS.md' : 'CLAUDE.md'
    const fp = path.join(homeDir, base, 'projects', id, fname)
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' })
    res.json({ content: fs.readFileSync(fp, 'utf-8'), path: fp })
  } catch (error) { res.status(500).json({ error: 'Read failed' }) }
})

// -- DELETE /api/platform/rules/:platform/:id -- Remove project rules --
app.delete('/api/platform/rules/:platform/:id', (req, res) => {
  try {
    const { platform, id } = req.params
    const homeDir = process.env.USERPROFILE || process.env.HOME
    const base = platform === 'codex' ? '.codex' : '.claude'
    const fname = platform === 'codex' ? 'AGENTS.md' : 'CLAUDE.md'
    const fp = path.join(homeDir, base, 'projects', id, fname)
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' })
    fs.unlinkSync(fp)
    console.log(`Removed ${fname} for "${id}" from ${platform}`)
    res.json({ removed: true })
  } catch (error) { res.status(500).json({ error: 'Remove failed' }) }
})

// -- GET /api/deployments -- List all deployed skills, rules, and agents --
app.get('/api/deployments', (req, res) => {
  try {
    const homeDir = process.env.USERPROFILE || process.env.HOME
    const deployments = []

    // Scan ~/.claude/skills/mnemosyne-* for SKILL.md
    const skillsBase = path.join(homeDir, '.claude', 'skills')
    if (fs.existsSync(skillsBase)) {
      const dirs = fs.readdirSync(skillsBase).filter(d => d.startsWith('mnemosyne-'))
      for (const dir of dirs) {
        const sp = path.join(skillsBase, dir, 'SKILL.md')
        if (fs.existsSync(sp)) {
          const ct = fs.readFileSync(sp, 'utf-8')
          const stat = fs.statSync(sp)
          const tm = ct.match(/^#\s+(.+)/m)
          deployments.push({ id: dir, type: 'skill', name: tm ? tm[1] : dir.replace('mnemosyne-',''), path: sp, size: ct.length, updatedAt: stat.mtime.toISOString(), preview: ct.slice(0,200) })
        }
      }
    }

    // Scan ~/.claude/projects/mnemosyne-* for CLAUDE.md
    const projBase = path.join(homeDir, '.claude', 'projects')
    if (fs.existsSync(projBase)) {
      const dirs = fs.readdirSync(projBase).filter(d => d.startsWith('mnemosyne-'))
      for (const dir of dirs) {
        const cp = path.join(projBase, dir, 'CLAUDE.md')
        if (fs.existsSync(cp)) {
          const ct = fs.readFileSync(cp, 'utf-8')
          const stat = fs.statSync(cp)
          deployments.push({ id: dir, type: 'rules', name: dir.replace('mnemosyne-','').replace(/^project_/,''), path: cp, size: ct.length, updatedAt: stat.mtime.toISOString(), preview: ct.slice(0,200) })
        }
      }
    }

    // Scan ~/.codex/projects/mnemosyne-* for AGENTS.md
    const codexBase = path.join(homeDir, '.codex', 'projects')
    if (fs.existsSync(codexBase)) {
      const dirs = fs.readdirSync(codexBase).filter(d => d.startsWith('mnemosyne-'))
      for (const dir of dirs) {
        const ap = path.join(codexBase, dir, 'AGENTS.md')
        if (fs.existsSync(ap)) {
          const ct = fs.readFileSync(ap, 'utf-8')
          const stat = fs.statSync(ap)
          deployments.push({ id: dir, type: 'agents', name: dir.replace('mnemosyne-','').replace(/^project_/,''), path: ap, size: ct.length, updatedAt: stat.mtime.toISOString(), preview: ct.slice(0,200) })
        }
      }
    }
    res.json({ deployments })
  } catch (error) {
    console.error('List deployments error:', error)
    res.status(500).json({ error: 'Failed to list deployments' })
  }
})

app.get('/api/deployments/:type/:id/content', (req, res) => {
  try {
    const { type, id } = req.params
    const homeDir = process.env.USERPROFILE || process.env.HOME
    let fp
    if (type === 'skill') fp = path.join(homeDir, '.claude', 'skills', id, 'SKILL.md')
    else if (type === 'rules') fp = path.join(homeDir, '.claude', 'projects', id, 'CLAUDE.md')
    else if (type === 'agents') fp = path.join(homeDir, '.codex', 'projects', id, 'AGENTS.md')
    else return res.status(400).json({ error: 'Invalid type' })
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' })
    res.json({ content: fs.readFileSync(fp, 'utf-8'), path: fp })
  } catch (error) { res.status(500).json({ error: 'Failed to read deployment' }) }
})

app.delete('/api/deployments/:type/:id', (req, res) => {
  try {
    const { type, id } = req.params
    const homeDir = process.env.USERPROFILE || process.env.HOME
    let fp
    if (type === 'skill') fp = path.join(homeDir, '.claude', 'skills', id, 'SKILL.md')
    else if (type === 'rules') fp = path.join(homeDir, '.claude', 'projects', id, 'CLAUDE.md')
    else if (type === 'agents') fp = path.join(homeDir, '.codex', 'projects', id, 'AGENTS.md')
    else return res.status(400).json({ error: 'Invalid type' })
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' })
    fs.unlinkSync(fp)
    console.log('Removed deployment:', fp)
    res.json({ removed: true, path: fp })
  } catch (error) { res.status(500).json({ error: 'Failed to remove deployment' }) }
})

// WebSocket
wss.on('connection', (ws) => {
  console.log('Client connected')
  ws.on('close', () => console.log('Client disconnected'))
})

// Fallback to frontend
app.get('*', (req, res) => {
  const indexPath = join(__dirname, '../frontend/dist/index.html')
  if (fs.existsSync(indexPath)) res.sendFile(indexPath)
  else res.status(404).json({ error: 'Frontend not built yet. Run: npm run build -w frontend' })
})

// \u2500\u2500 Start \u2500\u2500
initializeDatabase().then(async () => {
  server.listen(PORT, () => {
    console.log(`\u2713 Mnemosyne backend running on http://localhost:${PORT}`)
    console.log(`\u2713 WebSocket ready`)
    console.log(`\u2713 DIKW transform engine loaded`)
    console.log(`\u2713 MCP endpoint at POST /api/mcp`)
    console.log(`\u2713 Recommendation engine loaded`)

    // Start file watcher for auto-capture
    try {
      // Session-complete detection: only import D nodes after AI finishes responding
      const dikwState = new Map() // projectId -> { isTransforming }
      const sessionImported = new Map() // filePath -> lastImportedSize (avoid re-importing same content)

      function isSessionComplete(filePath, sessionType) {
        // Read the last few lines of the JSONL to check for completion markers
        try {
          const content = fs.readFileSync(filePath, 'utf-8')
          const lines = content.trim().split('\n')
          // Check last 3 lines for completion markers
          for (let i = Math.max(0, lines.length - 3); i < lines.length; i++) {
            try {
              const event = JSON.parse(lines[i])
              if (sessionType === 'codex') {
                // Codex: look for event_msg with payload.type === 'task_complete'
                if (event.type === 'event_msg' && event.payload?.type === 'task_complete') return true
              } else if (sessionType === 'claude-code') {
                // Claude Code: look for type === 'last-prompt'
                if (event.type === 'last-prompt') return true
              }
            } catch {}
          }
          return false
        } catch { return false }
      }

      function getNodesByType(projectId, type) {
        const rows = db.exec("SELECT * FROM nodes WHERE project_id = '" + projectId.replace(/'/g, "''") + "' AND type = '" + type + "'")
        if (!rows.length || !rows[0].values.length) return []
        const cols = rows[0].columns
        return rows[0].values.map(row => {
          const obj = {}; cols.forEach((c, i) => { obj[c] = row[i] }); return obj
        }).map(d => ({
          id: d.id, type: d.type, projectId: d.project_id,
          content: d.content, tags: JSON.parse(d.tags || '[]'),
          sourcePlatform: d.source_platform, createdAt: d.created_at
        }))
      }

      function applyActions(actions, type, projectId, fromNodeIds, connLabel) {
        const now = new Date().toISOString()
        const resultIds = []
        for (const act of (actions || [])) {
          if (act.action === 'UPDATE' && act.existing_id) {
            dbRun("UPDATE nodes SET content = ?, updated_at = ? WHERE id = ? AND project_id = ?",
              [act.content, now, act.existing_id, projectId])
            resultIds.push(act.existing_id)
            console.log(`    ✏️  Updated ${type} node: ${act.existing_id.substring(0, 20)}...`)
          } else {
            const prefix = type === 'I' ? 'info' : type === 'K' ? 'know' : 'wisdom'
            const newId = prefix + '_' + uuidv4()
            const tags = type === 'W'
              ? ['auto-transformed', 'ai-generated', 'meta-judgment', 'context-dependent']
              : type === 'K'
              ? ['auto-transformed', 'ai-generated', 'skill', 'reusable']
              : ['auto-transformed', 'ai-generated']
            const sp = type === 'W' ? 'meta-analysis' : type === 'K' ? 'synthesis' : 'mixed'
            insertNodeToDb({ id: newId, type, projectId, sourcePlatform: sp, content: act.content, tags, createdAt: now })
            resultIds.push(newId)
            console.log(`    ➕ Created ${type} node: ${newId.substring(0, 20)}...`)
          }
        }
        for (const rid of resultIds) {
          const oldConns = db.exec("SELECT id FROM connections WHERE to_node_id = '" + rid.replace(/'/g, "''") + "' AND label = '" + connLabel + "'")
          if (oldConns.length && oldConns[0].values.length) {
            const ids = oldConns[0].values.map(r => "'" + r[0] + "'").join(',')
            dbRun("DELETE FROM connections WHERE id IN (" + ids + ")")
          }
          for (const fid of fromNodeIds) {
            const connId = 'conn_' + fid.substring(0, 20) + '_' + rid.substring(0, 20)
            insertConnectionToDb({ id: connId, fromNodeId: fid, toNodeId: rid, label: connLabel })
          }
        }
        return resultIds
      }

      async function runSmartDIKW(projectId, projectName) {
        const state = dikwState.get(projectId) || {}
        if (state.isTransforming) { console.log('  DIKW already running, skip'); return }
        state.isTransforming = true
        dikwState.set(projectId, state)
        try {
          const dNodes = getNodesByType(projectId, 'D')
          if (!dNodes.length) return
          console.log(`  🧠 Running smart DIKW on ${dNodes.length} D nodes for "${projectName}"...`)

          const existingI = getNodesByType(projectId, 'I')
          const iResult = await transformDtoI_upsert(dNodes, existingI, { id: projectId })
          const iIds = applyActions(iResult.actions, 'I', projectId, dNodes.map(d => d.id), 'contextualizes')

          const currentI = getNodesByType(projectId, 'I')
          const existingK = getNodesByType(projectId, 'K')
          if (currentI.length) {
            const kResult = await transformItoK_upsert(currentI, existingK, { id: projectId })
            const kIds = applyActions(kResult.actions, 'K', projectId, currentI.map(i => i.id), 'synthesizes')

            const currentK = getNodesByType(projectId, 'K')
            const existingW = getNodesByType(projectId, 'W')
            if (currentK.length) {
              const wResult = await transformKtoW_upsert(currentK, existingW, { id: projectId })
              applyActions(wResult.actions, 'W', projectId, currentK.map(k => k.id), 'judges')
            }
          }

          saveDb()
          broadcastToClients({ type: 'graph:updated', data: getGraph() })
          console.log(`  ✓ Smart DIKW complete for "${projectName}"`)
        } catch (e) {
          console.error('Smart DIKW error:', e.message)
        } finally {
          const s = dikwState.get(projectId) || {}
          s.isTransforming = false
          dikwState.set(projectId, s)
        }
      }

      startFileWatcher(async (session) => {
        console.log(`📡 File changed: ${path.basename(session.path)} (${session.type})`)
        try {
          // Step 1: Check if the AI session is complete
          if (!isSessionComplete(session.path, session.type)) {
            console.log(`  ⏳ Session still in progress, waiting...`)
            return
          }
          console.log(`  ✅ Session complete! Importing...`)

          // Step 2: Check if we already imported this exact file content
          const fileSize = fs.statSync(session.path).size
          if (sessionImported.get(session.path) === fileSize) {
            console.log(`  Skipped (already imported at this size: ${fileSize})`)
            return
          }

          // Step 3: Parse the session file
          const fileContent = fs.readFileSync(session.path, 'utf-8')
          if (fileContent.length < 100) return

          let dataNodes = []
          let sessionId = null
          let projectName = null

          if (session.type === 'codex') {
            const result = importCodex(fileContent)
            dataNodes = result.nodes
            sessionId = result.sessionId
            projectName = result.projectName
          } else if (session.type === 'claude-code') {
            const result = importClaudeCode(fileContent)
            dataNodes = result.nodes
            sessionId = result.sessionId || ('cc_' + path.basename(session.path, '.jsonl'))
            projectName = result.projectName
          }

          if (dataNodes.length === 0) {
            console.log(`  Skipped (no meaningful messages): ${session.path}`)
            return
          }

          const projectId = 'project_' + sessionId.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 50)
          const existing = dbGet("SELECT id FROM projects WHERE id = ?", [projectId])
          const now = new Date().toISOString()

          if (existing) {
            // Clear old D nodes only, keep I/K/W for upsert
            const dNodeIds = db.exec("SELECT id FROM nodes WHERE project_id = '" + projectId.replace(/'/g, "''") + "' AND type = 'D'")
            if (dNodeIds.length && dNodeIds[0].values.length) {
              const ids = dNodeIds[0].values.map(r => "'" + r[0] + "'").join(',')
              dbRun("DELETE FROM connections WHERE from_node_id IN (" + ids + ")")
            }
            dbRun("DELETE FROM nodes WHERE project_id = ? AND type = 'D'", [projectId])
          } else {
            dbRun('INSERT OR IGNORE INTO projects (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
              [projectId, projectName, '#667eea', now, now])
          }

          // Step 4: Import all D nodes
          dataNodes.forEach(node => { node.projectId = projectId; insertNodeToDb(node) })
          saveDb()
          broadcastToClients({ type: 'graph:updated', data: getGraph() })
          sessionImported.set(session.path, fileSize)
          console.log(`  📦 Imported ${dataNodes.length} D nodes into "${projectName}"`)

          // Step 5: Run DIKW immediately (session is already complete)
          await runSmartDIKW(projectId, projectName)

        } catch (e) {
          console.error('Auto-import error:', e.message)
        }
      })
      console.log(`✓ File watcher active (monitoring ~/.claude/projects/ and ~/.codex/sessions/)`)
    } catch (e) {
      console.log(`⚠ File watcher skipped: ${e.message}`)
    }
  })
}).catch(err => {
  console.error('Failed to initialize database:', err)
  process.exit(1)
})
