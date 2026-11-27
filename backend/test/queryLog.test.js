import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import express from 'express'
import { logQuery, queryLogPath, readQueryLog } from '../lib/queryLog.js'
import { fixtureDb, storeFor } from './e0-fixture.js'

const tmp = () => fs.mkdtempSync(join(os.tmpdir(), 'mnemo-log-'))

test('path: next to the database by default, overridable, can be switched off', () => {
  assert.equal(queryLogPath({ MNEMO_DB: '/var/lib/mnemosyne/mnemosyne.db' }), join('/var/lib/mnemosyne', 'query-log.jsonl'))
  assert.equal(queryLogPath({ MNEMO_QUERY_LOG: '/x/q.jsonl' }), '/x/q.jsonl')
  assert.equal(queryLogPath({ MNEMO_QUERY_LOG: 'off' }), null)
})

test('logQuery appends one line per call and never throws', () => {
  const file = join(tmp(), 'q.jsonl')
  assert.equal(logQuery({ tool: 'search_memory', query: '端口' }, { MNEMO_QUERY_LOG: file }), true)
  assert.equal(logQuery({ tool: 'get_node', id: 'd1' }, { MNEMO_QUERY_LOG: file }), true)
  fs.appendFileSync(file, 'not json\n')
  const entries = readQueryLog(file)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].query, '端口')
  assert.ok(Date.parse(entries[0].ts) > 0)
  assert.equal(logQuery({ tool: 'x' }, { MNEMO_QUERY_LOG: 'off' }), false)
  assert.equal(logQuery({ tool: 'x' }, { MNEMO_QUERY_LOG: join(tmp(), 'missing-dir', 'q.jsonl') }), false)
})

test('the MCP endpoint logs searches, context lookups and opened entries, and leaves replies unchanged', async () => {
  const file = join(tmp(), 'q.jsonl')
  process.env.MNEMO_QUERY_LOG = file
  const { createMcpHandler } = await import('../lib/remoteMcp.js')
  const app = express()
  app.use(express.json())
  app.post('/mcp', createMcpHandler(storeFor(await fixtureDb())).handler)
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
  const call = async (name, args) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'test-client/1.0' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
    })
    return (await res.json()).result.content[0].text
  }
  try {
    assert.match(await call('search_memory', { query: '管理后台 端口', limit: 3 }), /matches for "管理后台 端口"/)
    assert.match(await call('search_memory', { query: 'todo' }), /open to-dos/)
    assert.match(await call('search_memory', { query: 'zzzz-nothing' }), /No memory matched/)
    assert.match(await call('get_project_context', { project: 'p_net', task: '部署' }), /# Context: p_net/)
    assert.match(await call('get_node', { id: 'd1' }), /8443/)
    assert.match(await call('get_node', { id: 'nope' }), /No entry with id/)
  } finally { server.close(); delete process.env.MNEMO_QUERY_LOG }
  const log = readQueryLog(file)
  assert.deepEqual(log.map(e => e.tool), ['search_memory', 'search_memory', 'search_memory', 'get_project_context', 'get_node'])
  assert.equal(log[0].mode, 'keyword')
  assert.equal(log[0].client, 'test-client/1.0')
  assert.ok(log[0].results.some(r => r.id === 'd1' && r.rank >= 1))
  assert.equal(log[1].mode, 'list:todo')
  assert.deepEqual(log[2].results, [])
  assert.deepEqual(log[3].shown, { W: 1, K: 1, I: 3 })
  assert.equal(log[4].id, 'd1')
})
