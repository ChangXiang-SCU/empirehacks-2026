import test from 'node:test'
import assert from 'node:assert/strict'
import { runE0, renderSummary, pairedBootstrap, parseArgs, loadCorpus } from '../eval/e0/run.mjs'
import { draftQuestions } from '../eval/e0/draft-questions.mjs'
import { fixtureDb, QUESTIONS, mockEmbed } from './e0-fixture.js'

const row = (res, cond, q) => res.per.find(r => r.cond === cond && r.q === q)

test('levels: records and project material are separated from distilled entries', async () => {
  const { nodes } = loadCorpus(await fixtureDb())
  const level = Object.fromEntries(nodes.map(n => [n.id, n.level]))
  assert.deepEqual([level.d1, level.i1, level.k1, level.w1, level.r1, level.m1], ['D', 'I', 'K', 'W', 'R', 'M'])
})

test('BM25-only run: each level answers the question it holds the answer to', async () => {
  const res = await runE0({ db: await fixtureDb(), questions: QUESTIONS, budget: 300, k: 3 })
  assert.equal(res.meta.fused, 'bm25')
  assert.ok(!res.conditions.includes('D-dense'))
  assert.equal(row(res, 'D-bm25', 'q1').nuggets, 1)          // the port is only in the raw turn
  assert.equal(row(res, 'I-bm25', 'q1').nuggets, 0)          // the distilled fact dropped the number
  assert.equal(row(res, 'W-bm25', 'q3').nuggets, 1)
  assert.equal(row(res, 'D-bm25', 'q3').nuggets, 0)
  assert.equal(row(res, 'R-bm25', 'q4').hit, 1)
  assert.equal(row(res, 'routed-oracle-bm25', 'q4').nuggets, 1)
  assert.equal(row(res, 'prod-keyword', 'q1').hit, 1)
})

test('an entry distilled from the gold evidence counts as evidence, even when it lost the answer', async () => {
  const q = [{ id: 'l1', query: 'admin console port', type: 'fact', nuggets: ['8443'], evidence: ['d1'] }]
  const res = await runE0({ db: await fixtureDb(), questions: q, budget: 300, k: 3 })
  const r = row(res, 'I-bm25', 'l1')
  assert.equal(r.top[0], 'i1')
  assert.equal(r.mrr, 1)
  assert.equal(r.nuggets, 0)
})

test('asOf hides entries written after the question was asked', async () => {
  const res = await runE0({ db: await fixtureDb(), questions: QUESTIONS, budget: 300, k: 3 })
  assert.ok(row(res, 'I-bm25', 'q5').top.includes('i3'))
  assert.ok(!row(res, 'I-bm25', 'q6').top.includes('i3'))
  assert.ok(!row(res, 'D-bm25', 'q6').top.includes('d4'))
  assert.ok(!row(res, 'prod-keyword', 'q6').top.includes('i3'))
})

test('superseded records count toward the stale share', async () => {
  const q = [{ id: 's1', query: '论文主实验用什么数据集', type: 'record', nuggets: ['自己的日志'], evidence: ['r3'] }]
  const res = await runE0({ db: await fixtureDb(), questions: q, budget: 300, k: 3 })
  const r = row(res, 'R-bm25', 's1')
  assert.ok(r.top.includes('r2') && r.top.includes('r3'))
  assert.ok(r.stale > 0 && r.stale < 1)
})

test('hybrid run adds dense conditions, an answerer adds accuracy, and the summary renders', async () => {
  const answerer = async (q, context) => ({ answer: 'x', verdict: context.includes(q.nuggets[0]) ? 'CORRECT' : 'ABSTAIN' })
  const res = await runE0({ db: await fixtureDb(), questions: QUESTIONS, embed: mockEmbed, answerer, budget: 300, k: 3 })
  assert.equal(res.meta.baseline, 'D-hybrid')
  for (const c of ['D-dense', 'D-hybrid', 'W-hybrid', 'everything-hybrid', 'routed-guess-hybrid']) assert.ok(res.conditions.includes(c), c)
  const all = res.summary.find(s => s.cond === 'DIKW-hybrid' && s.type === 'all')
  assert.equal(all.n, QUESTIONS.length)
  assert.ok(all.accuracy > 0 && all.vsBaseline.length === 3)
  const md = renderSummary(res)
  assert.match(md, /## decision \(n = 1\)/)
  assert.match(md, /Does anything beat raw turns\?/)
})

test('paired bootstrap is deterministic and brackets the mean', () => {
  const a = [1, 1, 0, 1, null, 1], b = [0, 1, 0, 0, 1, 0]
  const [m, lo, hi] = pairedBootstrap(a, b)
  assert.equal(m, 0.6)
  assert.ok(lo <= m && m <= hi)
  assert.deepEqual(pairedBootstrap(a, b), [m, lo, hi])
  assert.equal(pairedBootstrap([null], [1]), null)
})

test('parseArgs keeps values with spaces and bare flags', () => {
  assert.deepEqual(parseArgs(['--db', 'C:\\My Data\\m.db', '--answer', '--k', '5']), { db: 'C:\\My Data\\m.db', answer: true, k: '5' })
})

test('draftQuestions: one draft per distinct query, opened entries become candidate evidence', () => {
  const log = [
    { ts: '2026-11-01T10:00:00Z', tool: 'search_memory', mode: 'keyword', query: '管理后台端口', client: 'a', results: [{ id: 'd1', type: 'D', rank: 1 }, { id: 'i1', type: 'I', rank: 2 }] },
    { ts: '2026-11-01T10:00:20Z', tool: 'get_node', id: 'd1', type: 'D', client: 'a' },
    { ts: '2026-11-01T10:00:30Z', tool: 'get_node', id: 'zz', type: 'D', client: 'a' },
    { ts: '2026-11-01T10:01:00Z', tool: 'search_memory', mode: 'keyword', query: '管理后台端口', client: 'a', results: [] },
    { ts: '2026-11-01T10:02:00Z', tool: 'search_memory', mode: 'list:todo', query: 'todo', client: 'a', results: [] },
    { ts: '2026-11-01T10:03:00Z', tool: 'search_memory', mode: 'keyword', query: '怎么部署', client: 'b', results: [] }
  ]
  const d = draftQuestions(log, (id) => 'snippet of ' + id)
  assert.equal(d.length, 2)
  assert.deepEqual(d[0].evidence, ['d1'])
  assert.equal(d[0].asOf, '2026-11-01T10:00:00Z')
  assert.equal(d[0].shown[0].snippet, 'snippet of d1')
  assert.equal(d[1].typeGuess, 'howto')
  assert.equal(d[1].type, '')
})
