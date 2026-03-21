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

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })
const upload = multer({ storage: multer.memoryStorage() })

const PORT = process.env.BACKEND_PORT || 3001
const DB_PATH = join(__dirname, 'db', 'mnemosyne.db')

// ── Database helpers (sql.js uses a different API than better-sqlite3) ──
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

// ── Initialize ──
async function initializeDatabase() {
  const SQL = await initSqlJs()

  // Try loading existing DB
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH)
    db = new SQL.Database(fileBuffer)
    console.log('✓ Loaded existing database')
  } else {
    db = new SQL.Database()
    console.log('✓ Created new database')
  }

  // Run schema
  const schema = fs.readFileSync(join(__dirname, 'db/schema.sql'), 'utf-8')
  db.exec(schema)

  // Seed if empty
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

    console.log('✓ Database seeded with demo data')
  } catch (error) {
    console.error('Error seeding database:', error)
  }
}

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

// ── Routes ──
app.use(express.json())
app.use(express.static(join(__dirname, '../frontend/dist')))

// CORS for dev
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE')
  next()
})

app.get('/api/graph', (req, res) => {
  try {
    res.json(getGraph())
  } catch (error) {
    console.error('Error fetching graph:', error)
    res.status(500).json({ error: 'Failed to fetch graph' })
  }
})

app.post('/api/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' })

  try {
    const fileContent = req.file.buffer.toString('utf-8')
    let nodes = []
    let platform = 'unknown'

    try {
      const data = JSON.parse(fileContent)
      if (Array.isArray(data) && data[0]?.role === 'user') {
        nodes = importChatGPT(data)
        platform = 'chatgpt'
      } else if (data.conversations) {
        nodes = importClaudeWeb(data)
        platform = 'claude-web'
      }
    } catch {
      // Try JSONL
      nodes = importClaudeCode(fileContent)
      platform = 'claude-code'
    }

    const now = new Date().toISOString()
    const projectId = 'project_' + uuidv4()
    dbRun('INSERT INTO projects (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [projectId, `Imported ${platform}`, '#00897b', now, now])

    nodes.forEach(node => {
      dbRun(
        'INSERT INTO nodes (id, type, project_id, source_platform, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [node.id, node.type, projectId, platform, node.content, JSON.stringify(node.tags || []), node.createdAt, now]
      )
    })

    saveDb()
    const graph = getGraph()
    broadcastToClients({ type: 'import:completed', data: graph })
    res.json({ platform, sessions: 1, nodes, connections: [] })
  } catch (error) {
    console.error('Import error:', error)
    res.status(500).json({ error: 'Import failed' })
  }
})

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

app.post('/api/hook/tool-use', (req, res) => {
  try {
    const { tool, session, timestamp } = req.body
    const now = new Date().toISOString()
    const nodeId = 'node_' + uuidv4()
    dbRun(
      'INSERT INTO nodes (id, type, project_id, source_platform, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [nodeId, 'D', session || 'unknown', 'claude-code', `Tool: ${tool}`, JSON.stringify(['tool-call']), timestamp || now, now]
    )
    saveDb()
    broadcastToClients({ type: 'node:added', data: { id: nodeId, tool } })
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Hook processing failed' })
  }
})

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

// ── Start ──
initializeDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`✓ Mnemosyne backend running on http://localhost:${PORT}`)
    console.log(`✓ WebSocket ready`)
  })
}).catch(err => {
  console.error('Failed to initialize database:', err)
  process.exit(1)
})
