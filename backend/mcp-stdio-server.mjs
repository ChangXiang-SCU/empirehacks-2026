#!/usr/bin/env node
// Mnemosyne MCP Stdio Server — Proxy Mode
// Instead of loading sql.js/WASM directly (which crashes in Claude Desktop),
// this server proxies all tool calls to the HTTP backend at localhost:3001.
// This avoids WASM loading issues and DB lock conflicts.

import { createInterface } from 'readline'
import http from 'http'

const BACKEND_URL = 'http://127.0.0.1:3001'

process.stderr.write('[mnemosyne-mcp] Starting proxy MCP server...\n')
process.stderr.write(`[mnemosyne-mcp] Backend URL: ${BACKEND_URL}\n`)

// ── HTTP helper: POST JSON to backend ──
function postToBackend(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const url = new URL(path, BACKEND_URL)

    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          resolve({ error: body })
        }
      })
    })
    req.on('error', (e) => {
      reject(new Error(`Backend unreachable: ${e.message}`))
    })
    req.write(data)
    req.end()
  })
}

// ── MCP Protocol Handlers ──

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
        description: 'Record a new learning/insight into the knowledge graph',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'The learning content' },
            type: { type: 'string', enum: ['D', 'I', 'K', 'W'], description: 'Node type' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags' },
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
        description: 'Full-text search across all knowledge nodes',
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

// ── HTTP GET helper ──
function getFromBackend(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BACKEND_URL)
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'GET'
    }, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) }
        catch (e) { resolve({ error: body }) }
      })
    })
    req.on('error', (e) => reject(new Error(`Backend unreachable: ${e.message}`)))
    req.end()
  })
}

// ── Proxy tool calls to HTTP backend's /api/mcp endpoint ──
async function handleToolsCall(params) {
  const { name, arguments: args } = params
  process.stderr.write(`[mnemosyne-mcp] Tool call: ${name}\n`)

  try {
    // For query_knowledge, get_skill, record_learning — use /api/mcp tools/call
    // For recommend_for_project — use GET /api/recommend/:projectId
    // For search_knowledge — use GET /api/nodes with content LIKE search

    if (name === 'recommend_for_project') {
      const limit = args.limit || 5
      const result = await getFromBackend(`/api/recommend/${encodeURIComponent(args.projectId)}?limit=${limit}`)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      }
    }

    if (name === 'search_knowledge') {
      // Use GET /api/nodes with type filter, then filter by query client-side
      let url = '/api/nodes?'
      if (args.type) url += `type=${encodeURIComponent(args.type)}&`
      const allNodes = await getFromBackend(url)
      const query = (args.query || '').toLowerCase()
      const filtered = (allNodes.nodes || allNodes || []).filter(n =>
        n.content && n.content.toLowerCase().includes(query)
      )
      return {
        content: [{ type: 'text', text: JSON.stringify(filtered, null, 2) }]
      }
    }

    // All other tools: proxy via /api/mcp with method: 'tools/call'
    const result = await postToBackend('/api/mcp', {
      method: 'tools/call',
      params: { name, arguments: args }
    })

    // Backend's /api/mcp already returns { content: [...] } format
    if (result.content) return result
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    }
  } catch (error) {
    process.stderr.write(`[mnemosyne-mcp] Tool error: ${error.message}\n`)
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true
    }
  }
}

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

async function handleResourcesRead(params) {
  const { uri } = params
  process.stderr.write(`[mnemosyne-mcp] Resource read: ${uri}\n`)

  try {
    let data
    if (uri === 'mnemosyne://knowledge') {
      data = await getFromBackend('/api/nodes?type=K')
    } else if (uri === 'mnemosyne://wisdom') {
      data = await getFromBackend('/api/nodes?type=W')
    } else if (uri === 'mnemosyne://graph') {
      data = await getFromBackend('/api/stats')
    } else {
      throw new Error(`Unknown resource: ${uri}`)
    }
    return {
      contents: [{
        uri: uri,
        mimeType: 'application/json',
        text: JSON.stringify(data, null, 2)
      }]
    }
  } catch (error) {
    throw new Error(`Resource read failed: ${error.message}`)
  }
}

// ── Main JSON-RPC message handler ──
async function handleMessage(message) {
  try {
    const { method, params, id } = message

    // Notifications (no id) — don't respond
    if (id === undefined || id === null) {
      if (method === 'notifications/initialized') {
        process.stderr.write('[mnemosyne-mcp] Client initialized notification received\n')
      }
      return null
    }

    process.stderr.write(`[mnemosyne-mcp] Request: ${method} (id=${id})\n`)

    let result = null

    switch (method) {
      case 'initialize':
        result = handleInitialize()
        break
      case 'tools/list':
        result = handleToolsList()
        break
      case 'tools/call':
        result = await handleToolsCall(params)
        break
      case 'resources/list':
        result = handleResourcesList()
        break
      case 'resources/read':
        result = await handleResourcesRead(params)
        break
      default:
        process.stderr.write(`[mnemosyne-mcp] Unknown method: ${method}\n`)
        return {
          jsonrpc: '2.0',
          id: id,
          error: { code: -32601, message: `Unknown method: ${method}` }
        }
    }

    const response = { jsonrpc: '2.0', id: id, result: result }
    process.stderr.write(`[mnemosyne-mcp] Sending response for ${method} (id=${id})\n`)
    return response
  } catch (error) {
    process.stderr.write(`[mnemosyne-mcp] Error: ${error.message}\n`)
    return {
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32603, message: error.message }
    }
  }
}

// ── Start stdio transport ──
// Set up readline IMMEDIATELY — no async init needed since we proxy to HTTP backend
process.stderr.write('[mnemosyne-mcp] Setting up readline on stdin...\n')

const rl = createInterface({
  input: process.stdin,
  terminal: false
})

rl.on('line', (line) => {
  if (!line.trim()) return
  process.stderr.write(`[mnemosyne-mcp] Received line: ${line.slice(0, 120)}...\n`)
  try {
    const message = JSON.parse(line)
    handleMessage(message).then(response => {
      if (response) {
        const out = JSON.stringify(response) + '\n'
        process.stderr.write(`[mnemosyne-mcp] Writing response (${out.length} bytes)\n`)
        process.stdout.write(out)
      }
    }).catch(err => {
      process.stderr.write(`[mnemosyne-mcp] Async error: ${err.message}\n`)
    })
  } catch (e) {
    process.stderr.write(`[mnemosyne-mcp] JSON parse error: ${e.message}\n`)
  }
})

rl.on('close', () => {
  process.stderr.write('[mnemosyne-mcp] stdin closed, exiting\n')
  process.exit(0)
})

process.stderr.write('[mnemosyne-mcp] Ready — waiting for JSON-RPC messages on stdin\n')
