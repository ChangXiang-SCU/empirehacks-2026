// Session ingest over POST /<secret>/api/ingest: storage, de-duplication and filing under Claude Projects.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { startServer, claudeTranscript } from './helpers.js'

let srv
before(async () => {
  srv = await startServer()
  const r = await srv.postJson('/api/spaces', { spaces: [
    { id: 'sp_thesis', name: 'Thesis', projects: [{ uuid: 'uuid-thesis' }], folders: [{ path: '/Users/chang/thesis' }] },
    { id: 'sp_data', name: 'Thesis data', folders: [{ path: '/Users/chang/thesis/data' }] },
    { id: 'sp_web', name: 'Homepage', folders: ['C:\\Users\\Chang\\homepage'] }
  ] })
  assert.equal(r.status, 200)
  assert.equal(r.body.spaces, 3)
})
after(async () => { await srv?.stop() })

const turns = (topic) => [['user', `let us work on ${topic} today`], ['assistant', `sure, starting on ${topic}`], ['user', `${topic}: next step please`], ['assistant', `${topic} is done`]]
const count = async (projectId) => (await fetch(srv.url(`/api/nodes?project=${projectId}&type=D`)).then(r => r.json())).length

test('a session is stored once as D nodes; re-uploading it replaces them instead of duplicating', async () => {
  const body = claudeTranscript({ sessionId: 'sess-dup', cwd: '/Users/chang/misc', turns: turns('dedup') })
  const first = await srv.ingest(body, { path: '/x/sess-dup.jsonl', size: '100' })
  assert.equal(first.body.projectId, 'project_sess-dup')
  assert.equal(first.body.nodes, 4)
  assert.equal(await count('project_sess-dup'), 4)
  const same = await srv.ingest(body, { path: '/x/sess-dup.jsonl', size: '100' })
  assert.equal(same.body.skipped, 'unchanged')
  const longer = claudeTranscript({ sessionId: 'sess-dup', cwd: '/Users/chang/misc', turns: [...turns('dedup'), ['user', 'one more question about dedup']] })
  const again = await srv.ingest(longer, { path: '/x/sess-dup.jsonl', size: '200' })
  assert.equal(again.body.nodes, 5)
  assert.equal(await count('project_sess-dup'), 5)
})

test('tiny or empty transcripts are skipped', async () => {
  assert.equal((await srv.ingest('{"type":"user"}\n'.padEnd(120, ' '))).body.skipped, 'no messages')
  assert.equal((await srv.ingest('x')).body.skipped, 'too small')
})

test('a session is filed under the Project whose folder contains its working directory; the deepest folder wins', async () => {
  const a = await srv.ingest(claudeTranscript({ sessionId: 'sess-thesis', cwd: '/Users/chang/thesis/ch2', turns: turns('chapter two') }))
  assert.equal(a.body.space, 'Thesis')
  assert.equal(a.body.workspace, 'ch2')
  const b = await srv.ingest(claudeTranscript({ sessionId: 'sess-data', cwd: '/Users/chang/thesis/data', turns: turns('cleaning') }))
  assert.equal(b.body.space, 'Thesis data')
  const c = await srv.ingest(claudeTranscript({ sessionId: 'sess-web', cwd: 'C:\\Users\\Chang\\homepage\\src', turns: turns('css') }))
  assert.equal(c.body.space, 'Homepage')
})

test('a session outside every Project folder that keeps touching one is filed there', async () => {
  const mention = 'please read /users/chang/thesis/notes.md and /users/chang/thesis/plan.md'
  const r = await srv.ingest(claudeTranscript({ sessionId: 'sess-mention', cwd: '/tmp', turns: [['user', mention], ['assistant', 'read /users/chang/thesis/notes.md'], ['user', 'now /users/chang/thesis/plan.md'], ['assistant', 'ok']] }))
  assert.equal(r.body.space, 'Thesis')
})

test('a project folder directly under a macOS / Linux home is recorded as the workspace', async () => {
  const r = await srv.ingest(claudeTranscript({ sessionId: 'sess-mac', cwd: '/Users/chang/mnemo-ui', turns: turns('the sidebar') }))
  assert.equal(r.body.workspace, 'mnemo-ui')
  const ctx = await srv.tool('get_project_context', { project: 'mnemo-ui' })
  assert.match(ctx.text, /project_sess-mac/)
})

test('the app\'s own record of a session (Project, title) wins over the folder rules', async () => {
  const meta = await fetch(srv.secretUrl('/api/sessions-meta'), {  // gzip, as the collector sends it
    method: 'POST', headers: { 'content-type': 'application/gzip' },
    body: zlib.gzipSync(JSON.stringify({ sessions: [{ sid: 'local_abc', spaceId: 'sp_web', appSpace: true, title: 'Fix navbar' }] }))
  })
  assert.equal(meta.status, 200)
  const body = claudeTranscript({ sessionId: 'changes-per-run', cwd: '/sessions/brave-owl/mnt/thesis', turns: turns('navbar') })
  const r = await srv.ingest(body, { platform: 'cowork', path: '/cowork/acct/org/local_abc/audit.jsonl' })
  assert.equal(r.body.projectId, 'project_local_abc')
  assert.equal(r.body.space, 'Homepage')
  assert.equal(r.body.title, 'Fix navbar')
})

test('a Codex thread rebuilt from SQLite never shrinks a stored session', async () => {
  const codex = (n) => [JSON.stringify({ type: 'session_meta', payload: { id: 'cx-keep', cwd: '/home/chang/proj' } }),
    ...Array.from({ length: n }, (_, i) => JSON.stringify({ type: 'response_item', payload: { role: i % 2 ? 'assistant' : 'user', content: [{ type: i % 2 ? 'output_text' : 'input_text', text: `codex turn number ${i}` }] } }))].join('\n')
  const full = await srv.ingest(codex(6), { platform: 'codex', path: '/r/rollout.jsonl', size: '1' })
  assert.equal(full.body.nodes, 6)
  const partial = await srv.ingest(codex(3), { platform: 'codex', path: 'codex-sqlite:cx-keep', size: '2' })
  assert.match(partial.body.skipped, /kept 6 stored turns/)
  assert.equal(await count('project_cx-keep'), 6)
})

test('sessions known before their Project are filed when the Project list arrives', async () => {
  const r = await srv.ingest(claudeTranscript({ sessionId: 'sess-late', cwd: '/home/chang/later-proj', turns: turns('later') }))
  assert.equal(r.body.space, null)
  const sp = await srv.postJson('/api/spaces', { spaces: [{ id: 'sp_late', name: 'Later', folders: [{ path: '/home/chang/later-proj' }] }] })
  assert.ok(sp.body.filed >= 1)
  const list = await srv.tool('list_projects', {})
  assert.match(list.text, /- Later · 1 sessions/)
})
