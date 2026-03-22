#!/usr/bin/env node
// mcp-stdio-server.mjs — Stdio-based MCP server for Claude Code
// Proxies MCP protocol (JSON-RPC over stdin/stdout) to the Mnemosyne HTTP backend
import http from 'http'

const BACKEND = 'http://127.0.0.1:3001'
const DEBUG = process.env.MCP_DEBUG === '1'

function log(...args) {
  if (DEBUG) process.stderr.write('[mnemosyne-mcp] ' + args.join(' ') + '\n')
}

function postToBackend(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request(`${BACKEND}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let chunks = ''
      res.on('data', c => chunks += c)
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)) }
        catch (e) { reject(new Error('Invalid JSON: ' + chunks.slice(0, 200))) }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function sendResponse(id, result) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'
  process.stdout.write(msg)
  log('-> response id=' + id)
}

function sendError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n'
  process.stdout.write(msg)
  log('-> error id=' + id + ' ' + message)
}

async function handleMessage(msg) {
  const { id, method, params } = msg
  log('<- ' + method + ' id=' + id)

  if (method === 'initialize') {
    return sendResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'mnemosyne', version: '1.0.0' }
    })
  }

  if (method === 'notifications/initialized') {
    return // no response needed for notifications
  }

  if (method === 'tools/list') {
    try {
      const result = await postToBackend({ method: 'tools/list' })
      return sendResponse(id, result)
    } catch (e) {
      return sendError(id, -32603, 'Backend unreachable: ' + e.message)
    }
  }

  if (method === 'tools/call') {
    try {
      const result = await postToBackend({ method: 'tools/call', params })
      return sendResponse(id, result)
    } catch (e) {
      return sendError(id, -32603, 'Backend error: ' + e.message)
    }
  }

  // Unknown method
  sendError(id, -32601, 'Method not found: ' + method)
}

// Read JSON-RPC messages from stdin (newline-delimited JSON)
let buffer = ''
process.stdin.setEncoding('utf-8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  // Process complete lines
  let newlineIdx
  while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim()
    buffer = buffer.slice(newlineIdx + 1)
    if (!line) continue
    try {
      const msg = JSON.parse(line)
      handleMessage(msg).catch(e => {
        log('Handler error: ' + e.message)
        if (msg.id) sendError(msg.id, -32603, 'Internal error: ' + e.message)
      })
    } catch (e) {
      log('Parse error: ' + e.message + ' line: ' + line.slice(0, 100))
    }
  }
})

process.stdin.on('end', () => {
  log('stdin closed, exiting')
  process.exit(0)
})

log('Mnemosyne MCP stdio server started')
