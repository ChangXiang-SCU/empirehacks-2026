// Transcript importers: what becomes a D node.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importClaudeCode } from '../lib/importers/claudeCode.js'
import { importCodex } from '../lib/importers/codex.js'

const jsonl = (...events) => events.map(e => JSON.stringify(e)).join('\n') + '\n'

test('Claude Code: keeps user/assistant text, drops tools, thinking, sidechains and meta events', () => {
  const r = importClaudeCode(jsonl(
    { type: 'user', sessionId: 's1', cwd: '/Users/chang/proj', timestamp: '2026-11-01T10:00:00Z', message: { role: 'user', content: 'how do I add a test' } },
    { type: 'assistant', timestamp: '2026-11-01T10:01:00Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'use node --test' }, { type: 'tool_use', name: 'Bash', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'subagent chatter' }] } },
    { type: 'user', isMeta: true, message: { role: 'user', content: 'meta event' } },
    'not json'
  ).replace('"not json"', 'not json'))
  assert.equal(r.sessionId, 's1')
  assert.equal(r.workspace, 'proj')
  assert.deepEqual(r.nodes.map(n => n.content), ['[user] how do I add a test', '[assistant] use node --test'])
  assert.equal(r.nodes[0].createdAt, '2026-11-01T10:00:00.000Z')
  assert.equal(r.title, 'how do I add a test')
})

test('Claude Code: consecutive repeats of the same turn are stored once', () => {
  const u = { type: 'user', sessionId: 's2', message: { role: 'user', content: 'please deploy the server now' } }
  const r = importClaudeCode(jsonl(u, u, { type: 'assistant', message: { role: 'assistant', content: 'deploying' } }, u))
  assert.deepEqual(r.nodes.map(n => n.dtype), ['user', 'assistant', 'user'])
})

test('Claude Code: custom title wins; missing session id falls back to the file name', () => {
  const r = importClaudeCode(jsonl(
    { type: 'custom-title', customTitle: 'Oracle ARM setup' },
    { type: 'user', message: { role: 'user', content: 'grab an ARM instance' } }
  ), { fallbackId: 'file-id' })
  assert.equal(r.title, 'Oracle ARM setup')
  assert.equal(r.sessionId, 'file-id')
})

test('Codex: session_meta gives id and cwd; boilerplate user messages are dropped', () => {
  const r = importCodex(jsonl(
    { type: 'session_meta', payload: { id: 'cx1', cwd: 'C:\\Users\\Chang\\empirehacks-2026', model_provider: 'openai' } },
    { type: 'response_item', timestamp: '2026-11-01T10:00:00Z', payload: { role: 'user', content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }] } },
    { type: 'response_item', timestamp: '2026-11-01T10:00:05Z', payload: { role: 'user', content: [{ type: 'input_text', text: 'explain the DIKW pyramid' }] } },
    { type: 'response_item', timestamp: '2026-11-01T10:00:09Z', payload: { role: 'assistant', content: [{ type: 'output_text', text: 'Data, Information, Knowledge, Wisdom' }] } },
    { type: 'response_item', payload: { type: 'function_call', name: 'shell' } }
  ))
  assert.equal(r.sessionId, 'cx1')
  assert.equal(r.workspace, 'empirehacks-2026')
  assert.deepEqual(r.nodes.map(n => n.dtype), ['user', 'assistant'])
  assert.equal(r.title, 'explain the DIKW pyramid')
  assert.ok(r.nodes[0].tags.includes('openai'))
})
