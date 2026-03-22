import initSqlJs from 'sql.js'
import fs from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import readline from 'readline'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, 'db', 'mnemosyne.db')

let db = null

// Initialize database connection
async function initDb() {
  const SQL = await initSqlJs()
  try {
    const fileBuffer = fs.readFileSync(DB_PATH)
    db = new SQL.Database(fileBuffer)
  } catch (e) {
    // Database doesn't exist yet, create empty one
    db = new SQL.Database()
    initializeSchema()
    saveDb()
  }
}

// Initialize database schema if needed
function initializeSchema() {
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('D', 'I', 'K', 'W')),
        tags TEXT,
        project_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
  } catch (e) {
    // Schema may already exist
  }
}

// Execute a query and return all rows
function dbAll(sql, params = []) {
  const stmt = db.prepare(sql)
  if (params.length) stmt.bind(params)
  const rows = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

// Execute a query and return first row
function dbGet(sql, params = []) {
  const rows = dbAll(sql, params)
  return rows[0] || null
}

// Execute an update/insert/delete
function dbRun(sql, params = []) {
  const stmt = db.prepare(sql)
  if (params.length) stmt.bind(params)
  stmt.step()
  stmt.free()
}

// Save database to file
function saveDb() {
  const data = db.export()
  fs.writeFileSync(DB_PATH, Buffer.from(data))
}

// Generate a simple ID
function generateId() {
  return 'node_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
}

// Parse tags from string or array
function parseTags(tags) {
  if (!tags) return []
  if (Array.isArray(tags)) return tags
  if (typeof tags === 'string') return tags.split(',').map(t => t.trim()).filter(t => t)
  return []
}

// Serialize tags to JSON string
function serializeTags(tags) {
  return tags && tags.length > 0 ? JSON.stringify(tags) : null
}

// Handle initialize request
function handleInitialize() {
  return {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {},
      resources: {}
    },
    serverInfo: {
      name: 'mnemosyne',
      version: '1.0.0'
    }
  }
}

// Handle tools/list request
function handleToolsList() {
  return {
    tools: [
      {
        name: 'query_knowledge',
        description: 'Query knowledge nodes by type (D/I/K/W), project, or tags',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Node type: D, I, K, or W' },
            project: { type: 'string', description: 'Filter by project' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' }
          }
        }
      },
      {
        name: 'get_skill',
        description: 'Get a specific skill/knowledge node by ID',
        inputSchema: {
          type: 'object',
          properties: {
            skillId: { type: 'string', description: 'The node ID' }
          },
          required: ['skillId']
        }
      },
      {
        name: 'record_learning',
        description: 'Record a new learning/insight into the graph',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'The learning content' },
            type: { type: 'string', enum: ['D', 'I', 'K', 'W'], description: 'Node type' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for the node' },
            project: { type: 'string', description: 'Project this belongs to' }
          },
          required: ['content', 'type']
        }
      },
      {
        name: 'recommend_for_project',
        description: 'Get cross-project knowledge recommendations',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'The project ID' },
            limit: { type: 'number', description: 'Maximum results', default: 5 }
          },
          required: ['projectId']
        }
      },
      {
        name: 'search_knowledge',
        description: 'Full-text search across all knowledge',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            type: { type: 'string', description: 'Optional type filter' }
          },
          required: ['query']
        }
      }
    ]
  }
}

// Handle tools/call request
function handleToolsCall(params) {
  const { name, arguments: args } = params

  switch (name) {
    case 'query_knowledge':
      return handleQueryKnowledge(args)
    case 'get_skill':
      return handleGetSkill(args)
    case 'record_learning':
      return handleRecordLearning(args)
    case 'recommend_for_project':
      return handleRecommendForProject(args)
    case 'search_knowledge':
      return handleSearchKnowledge(args)
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

function handleQueryKnowledge(args) {
  let sql = 'SELECT * FROM nodes WHERE 1=1'
  const params = []

  if (args.type) {
    sql += ' AND type = ?'
    params.push(args.type)
  }

  if (args.project) {
    sql += ' AND project_id = ?'
    params.push(args.project)
  }

  const rows = dbAll(sql, params)

  // Filter by tags if provided
  if (args.tags && args.tags.length > 0) {
    return rows.filter(row => {
      if (!row.tags) return false
      const nodeTags = JSON.parse(row.tags)
      return args.tags.some(tag => nodeTags.includes(tag))
    })
  }

  return rows
}

function handleGetSkill(args) {
  const row = dbGet('SELECT * FROM nodes WHERE id = ? AND type = ?', [args.skillId, 'K'])
  if (!row) {
    throw new Error(`Skill not found: ${args.skillId}`)
  }
  return row
}

function handleRecordLearning(args) {
  const id = generateId()
  const tags = serializeTags(args.tags || [])

  dbRun(
    `INSERT INTO nodes (id, content, type, tags, project_id) VALUES (?, ?, ?, ?, ?)`,
    [id, args.content, args.type, tags, args.project || 'mcp-input']
  )
  saveDb()

  return { nodeId: id, success: true }
}

function handleRecommendForProject(args) {
  const limit = args.limit || 5

  // Get all K/W nodes from other projects
  const sql = `
    SELECT * FROM nodes
    WHERE type IN ('K', 'W')
      AND (project_id IS NULL OR project_id != ?)
    LIMIT ?
  `

  return dbAll(sql, [args.projectId, limit])
}

function handleSearchKnowledge(args) {
  let sql = `SELECT * FROM nodes WHERE content LIKE ?`
  const params = [`%${args.query}%`]

  if (args.type) {
    sql += ' AND type = ?'
    params.push(args.type)
  }

  return dbAll(sql, params)
}

// Handle resources/list request
function handleResourcesList() {
  return {
    resources: [
      {
        uri: 'mnemosyne://knowledge',
        name: 'Knowledge Nodes',
        description: 'All Knowledge (K) type nodes',
        mimeType: 'application/json'
      },
      {
        uri: 'mnemosyne://wisdom',
        name: 'Wisdom Nodes',
        description: 'All Wisdom (W) type nodes',
        mimeType: 'application/json'
      },
      {
        uri: 'mnemosyne://graph',
        name: 'Knowledge Graph Summary',
        description: 'Summary of the entire knowledge graph',
        mimeType: 'application/json'
      }
    ]
  }
}

// Handle resources/read request
function handleResourcesRead(params) {
  const { uri } = params

  if (uri === 'mnemosyne://knowledge') {
    const rows = dbAll('SELECT * FROM nodes WHERE type = ?', ['K'])
    return {
      contents: [
        {
          uri: uri,
          mimeType: 'application/json',
          text: JSON.stringify(rows, null, 2)
        }
      ]
    }
  }

  if (uri === 'mnemosyne://wisdom') {
    const rows = dbAll('SELECT * FROM nodes WHERE type = ?', ['W'])
    return {
      contents: [
        {
          uri: uri,
          mimeType: 'application/json',
          text: JSON.stringify(rows, null, 2)
        }
      ]
    }
  }

  if (uri === 'mnemosyne://graph') {
    const stats = {
      totalNodes: dbGet('SELECT COUNT(*) as count FROM nodes')?.count || 0,
      byType: {
        D: dbGet('SELECT COUNT(*) as count FROM nodes WHERE type = ?', ['D'])?.count || 0,
        I: dbGet('SELECT COUNT(*) as count FROM nodes WHERE type = ?', ['I'])?.count || 0,
        K: dbGet('SELECT COUNT(*) as count FROM nodes WHERE type = ?', ['K'])?.count || 0,
        W: dbGet('SELECT COUNT(*) as count FROM nodes WHERE type = ?', ['W'])?.count || 0
      },
      projects: []
    }

    const projects = dbAll('SELECT DISTINCT project_id FROM nodes WHERE project_id IS NOT NULL')
    stats.projects = projects.map(p => p.project_id)

    return {
      contents: [
        {
          uri: uri,
          mimeType: 'application/json',
          text: JSON.stringify(stats, null, 2)
        }
      ]
    }
  }

  throw new Error(`Unknown resource: ${uri}`)
}

// Main message handler
async function handleMessage(message) {
  try {
    const { jsonrpc, method, params, id } = message

    // Handle notifications (no id) - don't send response
    if (!id) {
      if (method === 'notifications/initialized') {
        return null
      }
      return null
    }

    // Handle requests with id - send response
    let result = null

    if (method === 'initialize') {
      result = handleInitialize()
    } else if (method === 'tools/list') {
      result = handleToolsList()
    } else if (method === 'tools/call') {
      result = handleToolsCall(params)
    } else if (method === 'resources/list') {
      result = handleResourcesList()
    } else if (method === 'resources/read') {
      result = handleResourcesRead(params)
    } else {
      return {
        jsonrpc: '2.0',
        id: id,
        error: {
          code: -32601,
          message: `Unknown method: ${method}`
        }
      }
    }

    return {
      jsonrpc: '2.0',
      id: id,
      result: result
    }
  } catch (error) {
    process.stderr.write(`Error handling message: ${error.message}\n`)
    return {
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32603,
        message: error.message
      }
    }
  }
}

// Initialize and start server
async function main() {
  await initDb()

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  })

  rl.on('line', (line) => {
    try {
      const message = JSON.parse(line)
      handleMessage(message).then(response => {
        if (response) {
          process.stdout.write(JSON.stringify(response) + '\n')
        }
      })
    } catch (e) {
      // Silently ignore parse errors as per MCP spec
    }
  })

  rl.on('close', () => {
    process.exit(0)
  })
}

main().catch(err => {
  process.stderr.write(`Fatal error: ${err.message}\n`)
  process.exit(1)
})
