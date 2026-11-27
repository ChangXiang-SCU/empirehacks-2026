// Remote MCP tools: ranking, filing of notes, argument validation.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, claudeTranscript } from './helpers.js'

let srv
before(async () => {
  srv = await startServer()
  await srv.postJson('/api/spaces', { spaces: [
    { id: 'sp_mnemo', name: 'Empirehacks-Mnemosyne', folders: [{ path: '/Users/chang/empirehacks-2026' }] },
    { id: 'sp_ai', name: 'AI', folders: [] }
  ] })
  // An ordinary session whose id happens to contain "db" and whose title mentions "deploy"
  await srv.ingest(claudeTranscript({ sessionId: '4d4afeff-41d0-4732-b643-6992e91ffadb', cwd: '/tmp',
    turns: [['user', 'how do we deploy the homepage'], ['assistant', 'push to the gh-pages branch']] }))
})
after(async () => { await srv?.stop() })

const savedUnder = (text) => (text.match(/under (\S+)\.$/) || [])[1]

test('record_learning files a note under the Claude Project it names', async () => {
  const r = await srv.tool('record_learning', { content: 'Mnemosyne runs on the ARM box behind Caddy', project: 'Empirehacks-Mnemosyne', type: 'I' })
  assert.equal(savedUnder(r.text), 'notes_space_sp_mnemo')
})

test('record_learning does not file a note under a session whose id merely contains the project text', async () => {
  const r = await srv.tool('record_learning', { content: 'Use WAL mode for the sqlite db in production', project: 'db' })
  assert.equal(savedUnder(r.text), 'manual_db')
})

test('record_learning does not file a note under a session whose title merely contains the project text', async () => {
  const r = await srv.tool('record_learning', { content: 'Deploy checklist: build, copy bundle, run deploy.sh', project: 'deploy' })
  assert.equal(savedUnder(r.text), 'manual_deploy')
  const again = await srv.tool('record_learning', { content: 'Second deploy note goes to the same topic', project: 'deploy' })
  assert.equal(savedUnder(again.text), 'manual_deploy')
})

test('a short Claude Project name does not swallow every query that contains it', async () => {
  const r = await srv.tool('record_learning', { content: 'Email automation: use a filter per sender', project: 'email automation' })
  assert.equal(savedUnder(r.text), 'manual_email-automation')
  const exact = await srv.tool('record_learning', { content: 'Notes about the AI Project itself', project: 'AI' })
  assert.equal(savedUnder(exact.text), 'notes_space_sp_ai')
})

test('a note saved under a Project name Mnemosyne does not know yet is filed once that Project appears', async () => {
  const r = await srv.tool('record_learning', { content: 'Reviewer 2 wants more baselines', project: 'Paper Rebuttal' })
  assert.equal(savedUnder(r.text), 'manual_Paper-Rebuttal')
  await srv.postJson('/api/spaces', { spaces: [{ id: 'sp_paper', name: 'Paper rebuttal', folders: [] }] })
  const ctx = await srv.tool('get_project_context', { project: 'Paper rebuttal' })
  assert.match(ctx.text, /Reviewer 2 wants more baselines/)
})

test('search_memory ranks distilled knowledge above raw turns and caps results per session', async () => {
  for (let i = 0; i < 5; i++) {
    await srv.ingest(claudeTranscript({ sessionId: `rank-${i}`, cwd: '/tmp', turns: [['user', `tailscale exit node question ${i}`], ['assistant', `tailscale answer ${i}`], ['user', `tailscale follow up ${i}`], ['assistant', `tailscale done ${i}`]] }))
  }
  await srv.tool('record_learning', { content: 'Tailscale exit nodes need IP forwarding enabled first', project: 'net' })
  const r = await srv.tool('search_memory', { query: 'tailscale', limit: 30 })
  const lines = r.text.split('\n').filter(l => l.startsWith('- ['))
  assert.match(lines[0], /^- \[K\]/)
  const perSession = {}
  for (const l of lines) { const n = (l.match(/question (\d)$/) || [])[1]; if (n) perSession[n] = (perSession[n] || 0) + 1 }
  assert.ok(Object.keys(perSession).length >= 2)
  assert.ok(Object.values(perSession).every(c => c <= 3), JSON.stringify(perSession))
})

test('search_memory filters by type, Project and age, and handles Chinese queries', async () => {
  await srv.tool('record_learning', { content: '甲骨文 ARM 实例抢占要用脚本循环重试', project: 'Empirehacks-Mnemosyne', type: 'K' })
  const zh = await srv.tool('search_memory', { query: '甲骨文 抢占' })
  assert.match(zh.text, /甲骨文 ARM/)
  const onlyK = await srv.tool('search_memory', { query: 'tailscale', type: 'D' })
  assert.ok(!/\[K\]/.test(onlyK.text))
  const scoped = await srv.tool('search_memory', { query: 'tailscale', project: 'Empirehacks-Mnemosyne' })
  assert.match(scoped.text, /No memory matched/)
  // Raw turns count from when they were said (the test transcripts are dated 2026-11-01), not from when they were uploaded
  const recent = await srv.tool('search_memory', { query: 'tailscale', days: 1 })
  assert.match(recent.text, /Tailscale exit nodes need IP forwarding/)
  assert.ok(!/\[D\]/.test(recent.text), recent.text)
})

test('tool arguments are validated', async () => {
  const bad = [
    ['search_memory', { query: 'x', limit: 0 }],
    ['search_memory', { query: 'x', limit: 31 }],
    ['search_memory', { query: 'x', type: 'X' }],
    ['search_memory', { query: 'x', days: -1 }],
    ['search_memory', {}],
    ['recent_activity', { days: 0 }],
    ['list_projects', { view: 'everything' }],
    ['get_project_context', {}],
    ['record_learning', { content: 'too short' }],
    ['record_learning', { content: 'long enough content here', type: 'Z' }],
    ['record_learning', { content: 'long enough content here', tags: 'not-an-array' }],
    ['get_node', {}]
  ]
  for (const [name, args] of bad) {
    const r = await srv.tool(name, args)
    assert.ok(r.isError, `${name} ${JSON.stringify(args)} was accepted`)
    assert.match(r.text, /validation|Invalid/i)
  }
})

test('unknown ids and projects get a helpful message, not an error', async () => {
  assert.match((await srv.tool('get_node', { id: 'nope' })).text, /No entry with id nope/)
  assert.match((await srv.tool('get_project_context', { project: 'zzz-nothing' })).text, /No project matched/)
  assert.match((await srv.tool('export_skill', { id: 'nope' })).text, /No entry/)
})
