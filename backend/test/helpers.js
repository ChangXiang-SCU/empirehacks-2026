// Test helpers: start a real server.js on a free port with a throwaway HOME and database.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
  })
}

export async function startServer(extraEnv = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemo-test-'))
  const port = await freePort()
  const secret = 'test-secret-' + Math.random().toString(16).slice(2)
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (/^(ANTHROPIC_|OPENAI_|MNEMO_|BIND_HOSTS|PORT|BACKEND_PORT|USERPROFILE)/.test(k)) delete env[k]
  Object.assign(env, {
    HOME: home, PORT: String(port), BIND_HOSTS: '127.0.0.1', MNEMO_SECRET: secret, MNEMO_WATCH: '0',
    MNEMO_DB: path.join(home, 'mnemosyne.db'), NODE_NO_WARNINGS: '1', ...extraEnv
  })
  const child = spawn(process.execPath, ['server.js'], { cwd: BACKEND, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { out += d })
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 15000
  for (;;) {
    try { const r = await fetch(`${base}/${secret}/api/health`); if (r.ok) break } catch {}
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('server did not start:\n' + out)
    await new Promise(r => setTimeout(r, 100))
  }
  let rpcId = 0
  const srv = {
    home, base, secret, port, logs: () => out,
    url: (p) => base + p,
    secretUrl: (p) => `${base}/${secret}${p}`,
    async stop() {
      child.kill('SIGTERM')
      await new Promise(r => child.exitCode !== null ? r() : child.once('exit', r))
      fs.rmSync(home, { recursive: true, force: true })
    },
    async ingest(content, query = {}) {
      const q = new URLSearchParams({ platform: 'claude-code', ...query })
      const r = await fetch(`${base}/${secret}/api/ingest?${q}`, { method: 'POST', body: content, headers: { 'content-type': 'application/octet-stream' } })
      return { status: r.status, body: await r.json() }
    },
    async postJson(p, body) {
      const r = await fetch(`${base}/${secret}${p}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
      return { status: r.status, body: await r.json().catch(() => null) }
    },
    /** Call one MCP tool; returns { text, isError, error } */
    async tool(name, args = {}) {
      const r = await fetch(`${base}/${secret}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } })
      })
      const j = await r.json()
      if (j.error) return { error: j.error, isError: true, text: j.error.message }
      return { text: (j.result?.content || []).map(c => c.text).join('\n'), isError: !!j.result?.isError }
    }
  }
  return srv
}

/** A Claude Code transcript (JSONL) with the given user/assistant turns. */
export function claudeTranscript({ sessionId, cwd = '/home/alice/proj', turns, start = '2026-11-01T10:00:00.000Z' }) {
  const t0 = Date.parse(start)
  return turns.map(([role, text], i) => JSON.stringify({
    type: role, sessionId, cwd, timestamp: new Date(t0 + i * 60000).toISOString(),
    message: { role, content: role === 'user' ? text : [{ type: 'text', text }] }
  })).join('\n') + '\n'
}
