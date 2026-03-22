import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'
import initSqlJs from 'sql.js'
import fs from 'fs'

// Import custom modules
import { importChatGPT } from './lib/importers/chatgpt.js'
import { importClaudeCode } from './lib/importers/claudeCode.js'
import { importClaudeWeb } from './lib/importers/claudeWeb.js'
import { seedData } from './db/seedData.js'
import {
  transformDataToInfo,
  transformInfoToKnowledge,
  transformKnowledgeToWisdom,
  autoTransformBatch,
  generateSkillMd,
  generateClaudeMd
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
    seedDatabase()
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
      if (Array.isArray(data) && data[0]?.role === 'user') {
        dataNodes = importChatGPT(data)
        platform = 'chatgpt'
      } else if (data.conversations) {
        dataNodes = importClaudeWeb(data)
        platform = 'claude-web'
      } else if (Array.isArray(data)) {
        dataNodes = importChatGPT(data)
        platform = 'chatgpt'
      }
    } catch {
      dataNodes = importClaudeCode(fileContent)
      platform = 'claude-code'
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
    const transformed = autoTransformBatch(dataNodes, { id: projectId, name: projectName })
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
app.post('/api/transform', (req, res) => {
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
      if (sourceType === 'D') result = transformDataToInfo(sourceNodes, projectContext)
      else if (sourceType === 'I') result = transformInfoToKnowledge(sourceNodes, projectContext)
      else if (sourceType === 'K') result = transformKnowledgeToWisdom(sourceNodes, projectContext)
      else return res.status(400).json({ error: 'Wisdom nodes cannot be further transformed' })
    } else if (direction === 'D\u2192I') {
      result = transformDataToInfo(sourceNodes.filter(n => n.type === 'D'), projectContext)
    } else if (direction === 'I\u2192K') {
      result = transformInfoToKnowledge(sourceNodes.filter(n => n.type === 'I'), projectContext)
    } else if (direction === 'K\u2192W') {
      result = transformKnowledgeToWisdom(sourceNodes.filter(n => n.type === 'K'), projectContext)
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

// \u2500\u2500 POST /api/export/skill/:nodeId \u2014 Export Knowledge node as SKILL.md \u2500\u2500
app.post('/api/export/skill/:nodeId', (req, res) => {
  try {
    const { nodeId } = req.params
    const node = dbGet('SELECT * FROM nodes WHERE id = ? AND type = ?', [nodeId, 'K'])

    if (!node) {
      return res.status(404).json({ error: 'Knowledge node not found' })
    }

    const knowledgeNode = {
      id: node.id, type: node.type, content: node.content,
      tags: JSON.parse(node.tags || '[]'),
      sourcePlatform: node.source_platform
    }

    // Find related nodes via connections
    const relatedIds = dbAll(
      'SELECT from_node_id FROM connections WHERE to_node_id = ?', [nodeId]
    ).map(r => r.from_node_id)

    const wisdomIds = dbAll(
      'SELECT to_node_id FROM connections WHERE from_node_id = ?', [nodeId]
    ).map(r => r.to_node_id)

    const allRelatedIds = [...relatedIds, ...wisdomIds]
    let relatedNodes = []
    if (allRelatedIds.length > 0) {
      const ph = allRelatedIds.map(() => '?').join(',')
      relatedNodes = dbAll(`SELECT * FROM nodes WHERE id IN (${ph})`, allRelatedIds)
        .map(row => ({
          id: row.id, type: row.type, content: row.content,
          tags: JSON.parse(row.tags || '[]')
        }))
    }

    const markdown = generateSkillMd(knowledgeNode, relatedNodes)
    res.setHeader('Content-Type', 'text/markdown')
    res.setHeader('Content-Disposition', `attachment; filename="SKILL_${nodeId}.md"`)
    res.send(markdown)
  } catch (error) {
    console.error('Export error:', error)
    res.status(500).json({ error: 'Export failed' })
  }
})

// \u2500\u2500 POST /api/export/claude/:projectId \u2014 Export Wisdom as CLAUDE.md \u2500\u2500
app.post('/api/export/claude/:projectId', (req, res) => {
  try {
    const { projectId } = req.params
    const project = dbGet('SELECT * FROM projects WHERE id = ?', [projectId])
    const wisdomNodes = dbAll('SELECT * FROM nodes WHERE project_id = ? AND type = ?', [projectId, 'W'])
      .map(row => ({
        id: row.id, content: row.content,
        tags: JSON.parse(row.tags || '[]')
      }))

    if (wisdomNodes.length === 0) {
      return res.status(404).json({ error: 'No wisdom nodes found for this project' })
    }

    const markdown = generateClaudeMd(wisdomNodes, project?.name || 'Project')
    res.setHeader('Content-Type', 'text/markdown')
    res.setHeader('Content-Disposition', `attachment; filename="CLAUDE_${projectId}.md"`)
    res.send(markdown)
  } catch (error) {
    console.error('Export error:', error)
    res.status(500).json({ error: 'Export failed' })
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

// \u2500\u2500 POST /api/hook/tool-use \u2014 Claude Code hook: log tool call \u2500\u2500
app.post('/api/hook/tool-use', (req, res) => {
  try {
    const { tool, session, timestamp, input, project } = req.body
    const now = new Date().toISOString()
    const nodeId = 'node_' + uuidv4()

    let content = `Tool: ${tool}`
    if (input) content += ` \u2014 ${JSON.stringify(input).substring(0, 200)}`

    dbRun(
      `INSERT INTO nodes (id, type, project_id, source_platform, content, tags, dtype, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nodeId, 'D', project || session || 'live-session', 'claude-code',
       content, JSON.stringify(['tool-call', tool || '']), 'tool-call',
       timestamp || now, now]
    )
    saveDb()

    const node = {
      id: nodeId, type: 'D', projectId: project || session || 'live-session',
      sourcePlatform: 'claude-code', content, tags: ['tool-call', tool || ''],
      dtype: 'tool-call', createdAt: timestamp || now
    }
    broadcastToClients({ type: 'node:added', data: node })

    res.json({ success: true, nodeId })
  } catch (error) {
    res.status(500).json({ error: 'Hook processing failed' })
  }
})

// \u2500\u2500 POST /api/hook/session-end \u2014 Trigger D\u2192I reflection \u2500\u2500
app.post('/api/hook/session-end', (req, res) => {
  try {
    const { session, timestamp } = req.body

    // Find all Data nodes from this session that haven't been transformed yet
    const dataNodes = dbAll(
      `SELECT * FROM nodes WHERE project_id = ? AND type = 'D'
       AND id NOT IN (SELECT from_node_id FROM connections WHERE label = 'contextualizes')`,
      [session || 'live-session']
    ).map(row => ({
      id: row.id, type: row.type, projectId: row.project_id,
      sourcePlatform: row.source_platform, content: row.content,
      tags: JSON.parse(row.tags || '[]'), dtype: row.dtype,
      createdAt: row.created_at
    }))

    if (dataNodes.length < 2) {
      return res.json({ success: true, message: 'Not enough data nodes to transform', count: dataNodes.length })
    }

    // Auto-transform
    const result = transformDataToInfo(dataNodes, { id: session || 'live-session' })
    if (result.node) {
      insertNodeToDb(result.node)
      result.connections.forEach(conn => insertConnectionToDb(conn))
      saveDb()
      broadcastToClients({ type: 'graph:updated', data: getGraph() })
    }

    res.json({ success: true, transformed: !!result.node })
  } catch (error) {
    console.error('Session-end hook error:', error)
    res.status(500).json({ error: 'Session reflection failed' })
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
    }

    res.status(400).json({ error: 'Unknown MCP method' })
  } catch (error) {
    console.error('MCP error:', error)
    res.status(500).json({ error: 'MCP request failed' })
  }
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
initializeDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`\u2713 Mnemosyne backend running on http://localhost:${PORT}`)
    console.log(`\u2713 WebSocket ready`)
    console.log(`\u2713 DIKW transform engine loaded`)
    console.log(`\u2713 MCP endpoint at POST /api/mcp`)
    console.log(`\u2713 Recommendation engine loaded`)

    // Start file watcher for auto-capture
    try {
      startFileWatcher((session) => {
        console.log(`\ud83d\udce1 Detected new session: ${session.path}`)
        try {
          const content = fs.readFileSync(session.path, 'utf-8')
          let dataNodes = []
          if (session.type === 'claude-code') {
            dataNodes = importClaudeCode(content)
          }
          if (dataNodes.length > 0) {
            const now = new Date().toISOString()
            const projectId = 'project_live_' + Date.now()
            dbRun('INSERT OR IGNORE INTO projects (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
              [projectId, `Live: ${session.type}`, '#667eea', now, now])
            dataNodes.forEach(node => { node.projectId = projectId; insertNodeToDb(node) })
            const transformed = autoTransformBatch(dataNodes, { id: projectId })
            transformed.nodes.forEach(node => { node.projectId = projectId; insertNodeToDb(node) })
            transformed.connections.forEach(conn => insertConnectionToDb(conn))
            saveDb()
            broadcastToClients({ type: 'graph:updated', data: getGraph() })
            console.log(`\u2713 Auto-imported ${dataNodes.length} nodes from ${session.path}`)
          }
        } catch (e) {
          console.error('Auto-import error:', e.message)
        }
      })
      console.log(`\u2713 File watcher active (monitoring ~/.claude/ and ~/.openclaw/)`)
    } catch (e) {
      console.log(`\u26a0 File watcher skipped: ${e.message}`)
    }
  })
}).catch(err => {
  console.error('Failed to initialize database:', err)
  process.exit(1)
})
