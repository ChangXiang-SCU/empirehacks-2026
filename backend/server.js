import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

// Import custom modules
import { importChatGPT } from './lib/importers/chatgpt.js'
import { importClaudeCode } from './lib/importers/claudeCode.js'
import { importClaudeWeb } from './lib/importers/claudeWeb.js'
import { classifySession } from './lib/sessionClassifier.js'
import { seedData } from './db/seedData.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Setup
const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })
const upload = multer({ storage: multer.memoryStorage() })

const PORT = process.env.BACKEND_PORT || 3001
const DB_PATH = process.env.DATABASE_PATH || './backend/db/mnemosyne.db'

// Initialize database
function initializeDatabase() {
  const dbDir = dirname(DB_PATH)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  const db = new Database(DB_PATH)
  const schema = fs.readFileSync(join(__dirname, 'db/schema.sql'), 'utf-8')
  db.exec(schema)

  // Check if database has data
  const nodeCount = db.prepare('SELECT COUNT(*) as count FROM nodes').get().count
  if (nodeCount === 0) {
    // Seed demo data
    seedDatabase(db)
  }

  return db
}

function seedDatabase(db) {
  try {
    const data = seedData()
    const insertNode = db.prepare(`
      INSERT INTO nodes (id, type, project_id, source_platform, content, tags, dtype, mcp_source, shared_projects, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertConnection = db.prepare(`
      INSERT INTO connections (id, from_node_id, to_node_id, label, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    const insertProject = db.prepare(`
      INSERT INTO projects (id, name, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    const insertMcpSource = db.prepare(`
      INSERT INTO mcp_sources (id, name, status, icon, data_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const now = new Date().toISOString()

    // Insert projects
    data.projects.forEach(proj => {
      insertProject.run(proj.id, proj.name, proj.color, now, now)
    })

    // Insert nodes
    data.nodes.forEach(node => {
      insertNode.run(
        node.id,
        node.type,
        node.projectId,
        node.sourcePlatform,
        node.content,
        JSON.stringify(node.tags || []),
        node.dtype || null,
        node.mcpSource || null,
        JSON.stringify(node.sharedProjects || []),
        node.createdAt,
        now
      )
    })

    // Insert connections
    data.connections.forEach(conn => {
      insertConnection.run(
        conn.id,
        conn.fromNodeId,
        conn.toNodeId,
        conn.label,
        now
      )
    })

    // Insert MCP sources
    data.mcpSources.forEach(source => {
      insertMcpSource.run(
        source.id,
        source.name,
        source.status,
        source.icon,
        source.dataCount,
        now,
        now
      )
    })

    console.log('✓ Database seeded with demo data')
  } catch (error) {
    console.error('Error seeding database:', error)
  }
}

const db = initializeDatabase()

// Middleware
app.use(express.json())
app.use(express.static(join(__dirname, '../frontend/dist')))

// Helper functions
function getGraph(db) {
  const nodes = db.prepare('SELECT * FROM nodes').all().map(row => ({
    id: row.id,
    type: row.type,
    projectId: row.project_id,
    sourcePlatform: row.source_platform,
    content: row.content,
    tags: JSON.parse(row.tags || '[]'),
    dtype: row.dtype,
    mcpSource: row.mcp_source,
    sharedProjects: JSON.parse(row.shared_projects || '[]'),
    createdAt: row.created_at
  }))

  const connections = db.prepare('SELECT * FROM connections').all().map(row => ({
    id: row.id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    label: row.label
  }))

  const projects = db.prepare('SELECT * FROM projects').all().map(row => ({
    id: row.id,
    name: row.name,
    color: row.color
  }))

  const mcpSources = db.prepare('SELECT * FROM mcp_sources').all().map(row => ({
    id: row.id,
    name: row.name,
    status: row.status,
    icon: row.icon,
    dataCount: row.data_count
  }))

  return { nodes, connections, projects, mcpSources }
}

function broadcastToClients(message) {
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(message))
    }
  })
}

// Routes
app.get('/api/graph', (req, res) => {
  try {
    const graph = getGraph(db)
    res.json(graph)
  } catch (error) {
    console.error('Error fetching graph:', error)
    res.status(500).json({ error: 'Failed to fetch graph' })
  }
})

app.post('/api/import', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' })
  }

  try {
    const fileContent = req.file.buffer.toString('utf-8')
    let nodes = []
    let platform = 'unknown'

    if (req.file.mimetype === 'application/json') {
      try {
        const data = JSON.parse(fileContent)
        if (Array.isArray(data) && data[0]?.role === 'user') {
          // ChatGPT format
          nodes = importChatGPT(data)
          platform = 'chatgpt'
        } else if (data.conversations) {
          // Claude.ai format
          nodes = importClaudeWeb(data)
          platform = 'claude-web'
        }
      } catch (e) {
        console.error('Parse error:', e)
      }
    } else if (req.file.mimetype === 'application/x-ndjson' || req.file.originalname?.endsWith('.jsonl')) {
      // Claude Code JSONL format
      nodes = importClaudeCode(fileContent)
      platform = 'claude-code'
    }

    // Save nodes to database
    const now = new Date().toISOString()
    const insertNode = db.prepare(`
      INSERT INTO nodes (id, type, project_id, source_platform, content, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const projectId = 'project_' + uuidv4()
    const insertProject = db.prepare(`
      INSERT INTO projects (id, name, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    insertProject.run(projectId, `Imported ${platform}`, '#00897b', now, now)

    nodes.forEach(node => {
      insertNode.run(
        node.id,
        node.type,
        projectId,
        platform,
        node.content,
        JSON.stringify(node.tags || []),
        node.createdAt,
        now
      )
    })

    const graph = getGraph(db)
    broadcastToClients({ type: 'import:completed', data: graph })

    res.json({
      platform,
      sessions: 1,
      nodes,
      connections: []
    })
  } catch (error) {
    console.error('Import error:', error)
    res.status(500).json({ error: 'Import failed' })
  }
})

app.post('/api/classify', (req, res) => {
  try {
    const { sessionId, projectId } = req.body
    const now = new Date().toISOString()

    const updateSession = db.prepare(`
      UPDATE sessions SET project_id = ?, classified_at = ? WHERE id = ?
    `)
    updateSession.run(projectId, now, sessionId)

    res.json({ success: true })
  } catch (error) {
    console.error('Classify error:', error)
    res.status(500).json({ error: 'Classification failed' })
  }
})

app.post('/api/hook/tool-use', (req, res) => {
  try {
    const { tool, session, timestamp } = req.body
    const now = new Date().toISOString()

    const insertNode = db.prepare(`
      INSERT INTO nodes (id, type, project_id, source_platform, content, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const nodeId = 'node_' + uuidv4()
    insertNode.run(
      nodeId,
      'D',
      session || 'unknown',
      'claude-code',
      `Tool: ${tool}`,
      JSON.stringify(['tool-call']),
      timestamp || now,
      now
    )

    broadcastToClients({
      type: 'node:added',
      data: { id: nodeId, tool }
    })

    res.json({ success: true })
  } catch (error) {
    console.error('Hook error:', error)
    res.status(500).json({ error: 'Hook processing failed' })
  }
})

app.get('/api/nodes', (req, res) => {
  try {
    const { type, project } = req.query
    let query = 'SELECT * FROM nodes WHERE 1=1'
    const params = []

    if (type) {
      query += ' AND type = ?'
      params.push(type)
    }
    if (project) {
      query += ' AND project_id = ?'
      params.push(project)
    }

    const nodes = db.prepare(query).all(...params).map(row => ({
      id: row.id,
      type: row.type,
      projectId: row.project_id,
      content: row.content,
      tags: JSON.parse(row.tags || '[]'),
      createdAt: row.created_at
    }))

    res.json(nodes)
  } catch (error) {
    console.error('Query error:', error)
    res.status(500).json({ error: 'Query failed' })
  }
})

// WebSocket
wss.on('connection', (ws) => {
  console.log('Client connected')
  ws.on('close', () => {
    console.log('Client disconnected')
  })
})

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../frontend/dist/index.html'))
})

// Start server
server.listen(PORT, () => {
  console.log(`✓ Mnemosyne backend running on http://localhost:${PORT}`)
  console.log(`✓ Database: ${DB_PATH}`)
})
