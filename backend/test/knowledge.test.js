// Claude Project material helpers: masking and chunking.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redactIds, chunkText } from '../lib/projectKnowledge.js'

test('redactIds masks Chinese ID numbers and 16+ digit account numbers only', () => {
  assert.equal(redactIds('身份证 11010519491231002X 号'), '身份证 [ID number removed] 号')
  assert.equal(redactIds('card 6222 0212 3456 7890'), 'card [account number removed]')
  assert.equal(redactIds('phone 13800138000'), 'phone 13800138000')
  assert.equal(redactIds('ts 1730000000000'), 'ts 1730000000000')
  assert.equal(redactIds('pi 3.141592653589793238'), 'pi 3.141592653589793238')
})

test('chunkText keeps chunks under the limit and loses no text', () => {
  const text = Array.from({ length: 40 }, (_, i) => `## Section ${i}\n` + 'word '.repeat(30)).join('\n')
  const parts = chunkText(text, 500)
  assert.ok(parts.length > 1)
  assert.ok(parts.every(p => p.length <= 500))
  assert.equal(parts.join(' ').replace(/\s+/g, ''), text.replace(/\s+/g, ''))
  assert.deepEqual(chunkText('  '), [])
  assert.deepEqual(chunkText('short'), ['short'])
})
