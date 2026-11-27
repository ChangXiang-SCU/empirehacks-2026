import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { tokenize, estimateTokens, chunkText, Bm25Index, DenseIndex, rrf, guessQuestionType } from '../lib/retrieval.js'
import { embedConfig, createEmbedder, EmbeddingCache, embedAll } from '../lib/embeddings.js'
import { mockEmbed } from './e0-fixture.js'

test('tokenize: words, numbers and CJK bigrams', () => {
  assert.deepEqual(tokenize('管理后台 port 8443, us-arm!'), ['port', '8443', 'us', 'arm', '管理', '理后', '后台'])
  assert.deepEqual(tokenize('改 A'), ['改'])
})

test('estimateTokens counts CJK per character', () => {
  assert.equal(estimateTokens('备份'), 2)
  assert.equal(estimateTokens('abcdefgh'), 2)
})

test('chunkText overlaps and caps', () => {
  assert.deepEqual(chunkText('short'), ['short'])
  const c = chunkText('x'.repeat(5000), { size: 1000, overlap: 100, max: 3 })
  assert.equal(c.length, 3)
  assert.equal(c[0].length, 1000)
})

test('BM25 ranks the matching entry first in both languages and honours the mask', () => {
  const texts = ['管理后台监听 8443 端口', 'rsync the build directory and restart the unit', '论文评测用公开数据集', 'the unit of work']
  const idx = new Bm25Index(texts)
  assert.equal(idx.search('管理后台的端口')[0].i, 0)
  assert.equal(idx.search('how to rsync the build')[0].i, 1)
  assert.equal(idx.search('rsync', { mask: Uint8Array.from([1, 0, 1, 1]) }).length, 0)
  assert.deepEqual(idx.search('没有出现的词'), [])
})

test('dense search takes the best passage per entry; RRF merges lists', async () => {
  const [a, b, q] = await mockEmbed(['提炼模型现在是 beta', 'rsync the build', '提炼模型'])
  const d = new DenseIndex(2)
  d.add(0, b); d.add(0, a); d.add(1, b)
  assert.equal(d.search(q)[0].i, 0)
  const fused = rrf([[{ i: 5 }, { i: 7 }], [{ i: 7 }, { i: 9 }]])
  assert.equal(fused[0].i, 7)
  assert.deepEqual(fused.map(r => r.i).sort(), [5, 7, 9])
})

test('question type guess', () => {
  assert.equal(guessQuestionType('怎么部署'), 'howto')
  assert.equal(guessQuestionType('还有哪些待办'), 'record')
  assert.equal(guessQuestionType('现在用哪个模型'), 'update')
  assert.equal(guessQuestionType('端口是多少'), 'fact')
})

test('embedder: batches, keeps order, never sends a key to a local server', async () => {
  assert.equal(embedConfig({}), null)
  const calls = []
  const fake = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, auth: init.headers.Authorization, n: body.input.length, first: body.input[0] })
    return { ok: true, json: async () => ({ data: body.input.map((t, i) => ({ index: i, embedding: [t.length, 1] })).reverse() }) }
  }
  const local = createEmbedder(embedConfig({ MNEMO_EMBED_BASE_URL: 'http://127.0.0.1:8080/v1/', MNEMO_EMBED_MODEL: 'm', MNEMO_EMBED_API_KEY: 'secret', MNEMO_EMBED_BATCH: '2', MNEMO_EMBED_QUERY_PREFIX: 'query: ' }), fake)
  const out = await local(['a', 'bbb', 'cc'], 'query')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, 'http://127.0.0.1:8080/v1/embeddings')
  assert.equal(calls[0].auth, undefined)
  assert.equal(calls[0].first, 'query: a')
  assert.ok(out[1][0] > out[0][0], 'order follows the input, not the response')
  const remote = createEmbedder(embedConfig({ MNEMO_EMBED_BASE_URL: 'https://api.openai.com/v1', MNEMO_EMBED_MODEL: 'm', OPENAI_API_KEY: 'k' }), fake)
  await remote(['x'])
  assert.equal(calls.at(-1).auth, 'Bearer k')
})

test('embedding cache survives a reload and skips cached texts', async () => {
  const file = join(fs.mkdtempSync(join(os.tmpdir(), 'mnemo-emb-')), 'emb')
  let asked = 0
  const embed = async (texts) => { asked += texts.length; return mockEmbed(texts) }
  const first = await embedAll(['一', '二'], embed, new EmbeddingCache(file))
  const again = await embedAll(['二', '三'], embed, new EmbeddingCache(file))
  assert.equal(asked, 3)
  assert.deepEqual([...again[0]], [...first[1]])
})
