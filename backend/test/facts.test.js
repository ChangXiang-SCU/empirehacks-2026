// Exact records (to-dos, decisions, facts) and expiry: tag parsing, closing directives, notes extraction,
// and the memory index noticing an expiry with no write in between.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { factInfo, applyDirectives, extractRecords, parseTags, expiryTime } from '../lib/facts.js'
import { createMemoryIndex } from '../lib/remoteMcp.js'

const tags = (...t) => JSON.stringify(t)
const NOW = Date.parse('2026-11-27T12:00:00Z')

test('parseTags tolerates empty, malformed and non-array input', () => {
  assert.deepEqual(parseTags(''), [])
  assert.deepEqual(parseTags(null), [])
  assert.deepEqual(parseTags('not json'), [])
  assert.deepEqual(parseTags('{"a":1}'), [])
  assert.deepEqual(parseTags('["a", 2]'), ['a', '2'])
})

test('factInfo: ordinary entries are not records', () => {
  assert.equal(factInfo(tags('recorded', 'deploy')), null)
  assert.equal(factInfo(tags('artifact', 'factory')), null)   // hint words inside other words
  assert.equal(factInfo(''), null)
})

test('factInfo: kinds in English and Chinese', () => {
  assert.equal(factInfo(tags('todo')).kind, 'todo')
  assert.equal(factInfo(tags('To-Do')).kind, 'todo')
  assert.equal(factInfo(tags('待办')).kind, 'todo')
  assert.equal(factInfo(tags('decision')).kind, 'decision')
  assert.equal(factInfo(tags('决定')).kind, 'decision')
  assert.equal(factInfo(tags('决策')).kind, 'decision')
  assert.equal(factInfo(tags('fact')).kind, 'fact')
  assert.equal(factInfo(tags('事实')).kind, 'fact')
  assert.equal(factInfo(tags('fact', 'decision')).kind, 'fact')   // first kind wins
})

test('factInfo: a bare expiry date lasts to the end of that day (UTC)', () => {
  assert.equal(factInfo(tags('fact', 'expires:2026-11-27'), NOW).status, 'active')
  assert.equal(factInfo(tags('fact', 'expires:2026-11-27'), Date.parse('2026-11-28T00:00:01Z')).status, 'expired')
  assert.equal(factInfo(tags('fact', 'expires:2026-11-26'), NOW).status, 'expired')
  assert.equal(factInfo(tags('fact', 'valid-until:2026-12-01'), NOW).expires, '2026-12-01')
  // An expiry alone makes the entry a record without a kind
  assert.deepEqual(factInfo(tags('expires:2026-12-01'), NOW), { kind: null, status: 'active', expires: '2026-12-01', by: null })
})

test('factInfo: a full timestamp expiry is exact, an unreadable one never expires', () => {
  assert.equal(factInfo(tags('fact', 'expires:2026-11-27T11:59:00Z'), NOW).status, 'expired')
  assert.equal(factInfo(tags('fact', 'expires:2026-11-27T12:01:00Z'), NOW).status, 'active')
  assert.equal(factInfo(tags('fact', 'expires:someday'), NOW).status, 'active')
  assert.equal(expiryTime('someday'), Infinity)
  assert.equal(expiryTime('2026-11-27'), Date.parse('2026-11-27T23:59:59Z'))
})

test('factInfo: closed and replaced records', () => {
  assert.deepEqual(factInfo(tags('todo', 'status:done', 'closed-by:info_2')), { kind: 'todo', status: 'done', expires: null, by: null })
  assert.deepEqual(factInfo(tags('decision', 'superseded-by:info_3')), { kind: 'decision', status: 'superseded', expires: null, by: 'info_3' })
  assert.equal(factInfo(tags('fact', 'status:obsolete')).status, 'superseded')
  // A record that was closed is reported closed, not expired
  assert.equal(factInfo(tags('todo', 'status:done', 'expires:2020-01-01'), NOW).status, 'done')
})

function fakeStore(rows) {
  const byId = new Map(rows.map(r => [r.id, { ...r }]))
  return {
    byId,
    dbGet: (_sql, [id]) => byId.get(id),
    dbRun: (_sql, [tagsJson, id]) => { byId.get(id).tags = tagsJson }
  }
}

test('applyDirectives marks the named entries and never deletes them', () => {
  const store = fakeStore([
    { id: 'info_todo', tags: tags('recorded', 'todo') },
    { id: 'info_old', tags: tags('recorded', 'decision') }
  ])
  const notes = applyDirectives(store, 'info_new', ['done:info_todo', 'supersedes: info_old', 'ordinary', 'done:info_missing'])
  assert.deepEqual(notes, ['info_todo marked done', 'info_old marked superseded', 'info_missing not found, nothing marked'])
  assert.deepEqual(parseTags(store.byId.get('info_todo').tags), ['recorded', 'todo', 'status:done', 'closed-by:info_new'])
  assert.deepEqual(parseTags(store.byId.get('info_old').tags), ['recorded', 'decision', 'superseded-by:info_new'])
  assert.equal(factInfo(store.byId.get('info_todo').tags).status, 'done')
  assert.equal(factInfo(store.byId.get('info_old').tags).by, 'info_new')
})

test('applyDirectives accepts the closes/replaces/obsolete spellings and does not repeat tags', () => {
  const store = fakeStore([{ id: 'a', tags: tags('todo') }, { id: 'b', tags: tags('fact') }, { id: 'c', tags: tags('fact') }])
  applyDirectives(store, 'n1', ['closes:a', 'replaces:b', 'obsolete:c'])
  applyDirectives(store, 'n1', ['closes:a'])
  assert.deepEqual(parseTags(store.byId.get('a').tags), ['todo', 'status:done', 'closed-by:n1'])
  assert.equal(factInfo(store.byId.get('b').tags).status, 'superseded')
  assert.equal(factInfo(store.byId.get('c').tags).status, 'superseded')
})

test('extractRecords reads top-level bullets under to-do and decision headings only', () => {
  const md = [
    '# 会议纪要',
    '- 这条不在待办标题下',
    '## 待办',
    '- 导出车机数据',
    '- [ ] 确认 PK3A 是否换 PK1B',
    '- [x] 已经做完的一条',
    '  - 缩进的子项不算',
    '## 已定案',
    '* 标签用 0-2/3/≥4 三档',
    '### Notes',
    '- not a record',
    '## Action items',
    '- send the slides'
  ].join('\n')
  assert.deepEqual(extractRecords(md), [
    { kind: 'todo', text: '导出车机数据' },
    { kind: 'todo', text: '确认 PK3A 是否换 PK1B' },
    { kind: 'decision', text: '标签用 0-2/3/≥4 三档' },
    { kind: 'todo', text: 'send the slides' }
  ])
  assert.deepEqual(extractRecords(''), [])
  assert.deepEqual(extractRecords(null), [])
})

test('the memory index notices an expiry even when nothing is written in between', async () => {
  const soon = new Date(Date.now() + 300).toISOString()
  const nodes = [
    { id: 'info_a', type: 'I', project_id: 'manual_x', source_platform: 'mcp', content: 'Booth is open until the evening', tags: tags('recorded', 'fact', `expires:${soon}`), created_at: '2026-11-27T00:00:00Z', updated_at: '2026-11-27T00:00:00Z' },
    { id: 'know_b', type: 'K', project_id: 'manual_x', source_platform: 'mcp', content: 'An ordinary note', tags: tags('recorded'), created_at: '2026-11-27T00:00:00Z', updated_at: '2026-11-27T00:00:00Z' }
  ]
  const store = {
    version: () => 1,   // no writes at all
    dbAll: (sql) => /FROM nodes/.test(sql) ? nodes.map(n => ({ ...n })) : /FROM projects/.test(sql) ? [{ id: 'manual_x', name: 'Notes · x', created_at: '2026-11-27T00:00:00Z' }] : []
  }
  const index = createMemoryIndex(store)
  const first = index.load()
  assert.equal(first.nodes.find(n => n.id === 'info_a').fact.status, 'active')
  assert.equal(index.load(), first, 'reuses the cache before anything expires')
  await new Promise(r => setTimeout(r, 400))
  const later = index.load()
  assert.notEqual(later, first)
  assert.equal(later.nodes.find(n => n.id === 'info_a').fact.status, 'expired')
  assert.equal(index.load(), later, 'no further rebuilds once nothing is left to expire')
})
