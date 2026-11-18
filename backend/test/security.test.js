// Local API hardening: path traversal in the Platform Hub endpoints and cross-origin access.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { startServer } from './helpers.js'

// fetch() normalises "%2E%2E" segments away; send the path exactly as an attacker would
function rawRequest(method, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, method, path: rawPath }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    req.on('error', reject)
    req.end()
  })
}

let srv
before(async () => { srv = await startServer() })
after(async () => { await srv?.stop() })

const victim = () => path.join(srv.home, 'victim.txt')

test('DELETE skill with an encoded ../ id does not delete outside the skills folder', async () => {
  fs.writeFileSync(victim(), 'keep me')
  fs.mkdirSync(path.join(srv.home, '.claude', 'skills'), { recursive: true })
  const r = await fetch(srv.url('/api/platform/skills/claude-code/..%2F..'), { method: 'DELETE' })
  assert.equal(r.status, 400)
  assert.ok(fs.existsSync(victim()), 'HOME was deleted')
  assert.ok(fs.existsSync(path.join(srv.home, '.claude')), '~/.claude was deleted')
})

test('DELETE rules and deployments with ../ ids are rejected', async () => {
  fs.mkdirSync(path.join(srv.home, '.claude', 'projects'), { recursive: true })
  fs.writeFileSync(path.join(srv.home, '.claude', 'CLAUDE.md'), 'global rules')
  for (const u of ['/api/platform/rules/claude-code/%2E%2E', '/api/deployments/rules/%2E%2E']) {
    assert.equal(await rawRequest('DELETE', u), 400, u)
  }
  assert.ok(fs.existsSync(path.join(srv.home, '.claude', 'CLAUDE.md')), '~/.claude/CLAUDE.md was deleted')
})

test('reading a skill or deployment with ../ ids is rejected', async () => {
  fs.mkdirSync(path.join(srv.home, 'secret'), { recursive: true })
  fs.writeFileSync(path.join(srv.home, 'secret', 'SKILL.md'), 'private')
  for (const u of ['/api/platform/skills/claude-code/..%2F..%2Fsecret/content', '/api/deployments/skill/..%2F..%2Fsecret/content']) {
    const r = await fetch(srv.url(u))
    assert.equal(r.status, 400, u)
  }
})

test('skill sync rejects ids that leave the skills folder', async () => {
  fs.mkdirSync(path.join(srv.home, '.ssh'), { recursive: true })
  fs.writeFileSync(path.join(srv.home, '.ssh', 'id_test'), 'private key')
  const r = await fetch(srv.url('/api/platform/skills/sync'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: '../../.ssh', fromPlatform: 'claude-code' })
  })
  assert.equal(r.status, 400)
})

test('normal skill ids still work', async () => {
  const dir = path.join(srv.home, '.claude', 'skills', 'mnemosyne-demo')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '# Demo')
  const read = await fetch(srv.url('/api/platform/skills/claude-code/mnemosyne-demo/content'))
  assert.equal(read.status, 200)
  assert.equal((await read.json()).content, '# Demo')
  const sync = await fetch(srv.url('/api/platform/skills/sync'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'mnemosyne-demo', fromPlatform: 'claude-code' })
  })
  assert.equal(sync.status, 200)
  assert.ok(fs.existsSync(path.join(srv.home, '.codex', 'skills', 'mnemosyne-demo', 'SKILL.md')))
  const del = await fetch(srv.url('/api/platform/skills/codex/mnemosyne-demo'), { method: 'DELETE' })
  assert.equal(del.status, 200)
  assert.ok(!fs.existsSync(path.join(srv.home, '.codex', 'skills', 'mnemosyne-demo')))
})

test('other websites cannot call the local API from a browser (no wildcard CORS)', async () => {
  const pre = await fetch(srv.url('/api/platform/skills/claude-code/x'), {
    method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'DELETE' }
  })
  assert.equal(pre.headers.get('access-control-allow-origin'), null)
  const get = await fetch(srv.url('/api/graph'), { headers: { origin: 'https://evil.example' } })
  assert.equal(get.headers.get('access-control-allow-origin'), null)
})

test('cross-site requests that change state are refused; same-origin and the vite dev origin are not', async () => {
  const post = (origin) => fetch(srv.url('/api/platform/skills/sync'), {
    method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify({ id: 'missing-skill', fromPlatform: 'claude-code' })
  })
  assert.equal((await post('https://evil.example')).status, 403)
  assert.equal((await post(srv.base)).status, 404)                    // same origin: reaches the handler
  const dev = await post('http://localhost:5173')
  assert.equal(dev.status, 404)
  assert.equal(dev.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  assert.equal((await post(null)).status, 404)                        // hooks and scripts send no Origin
})

test('the graph WebSocket only accepts this server\'s own pages', async () => {
  const { WebSocket } = await import('ws')
  const open = (origin) => new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`, { origin })
    ws.on('open', () => { ws.close(); resolve('open') })
    ws.on('error', () => resolve('refused'))
  })
  assert.equal(await open('https://evil.example'), 'refused')
  assert.equal(await open(srv.base), 'open')
  assert.equal(await open('http://localhost:5173'), 'open')
})

test('the secret routes are not affected by the origin check', async () => {
  const r = await fetch(srv.secretUrl('/api/spaces'), {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://claude.ai' }, body: JSON.stringify({ spaces: [] })
  })
  assert.equal(r.status, 200)
})
