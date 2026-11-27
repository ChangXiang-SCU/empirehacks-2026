#!/usr/bin/env node
// Turn the query log into a question file to label by hand.
//   node eval/e0/draft-questions.mjs --log <query-log.jsonl> [--db <mnemosyne.db copy>] [--out eval/e0/questions.json]
// Each real search_memory query becomes one draft: its time (asOf, so the run only sees memory that existed then),
// a guessed type, and the entries opened with get_node right after it as candidate evidence.
// You then fill in: type, answer, nuggets (short strings a correct context must contain), and fix evidence.
import fs from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import initSqlJs from 'sql.js'
import { readQueryLog } from '../../lib/queryLog.js'
import { guessQuestionType } from '../../lib/retrieval.js'
import { parseArgs } from './run.mjs'

const OPENED_WITHIN_MS = 10 * 60 * 1000

export function draftQuestions(entries, snippetOf = () => '') {
  const out = [], seen = new Set()
  entries.forEach((e, idx) => {
    if (e.tool !== 'search_memory' || e.mode !== 'keyword') return
    const query = (e.query || '').trim()
    const key = query.toLowerCase()
    if (query.length < 2 || seen.has(key)) return
    seen.add(key)
    const t = Date.parse(e.ts)
    const shown = new Set((e.results || []).map(r => r.id))
    // Entries from this result list that were opened before the next search from the same client
    const opened = []
    for (let j = idx + 1; j < entries.length; j++) {
      const n = entries[j]
      if (Date.parse(n.ts) - t > OPENED_WITHIN_MS || (n.tool === 'search_memory' && n.client === e.client)) break
      if (n.tool === 'get_node' && shown.has(n.id) && !opened.includes(n.id)) opened.push(n.id)
    }
    out.push({
      id: 'q' + String(out.length + 1).padStart(3, '0'), query, asOf: e.ts, client: e.client || '', project: e.args?.project || '',
      type: '', typeGuess: guessQuestionType(query), answer: '', nuggets: [], evidence: opened,
      shown: (e.results || []).slice(0, 8).map(r => ({ id: r.id, type: r.type, snippet: snippetOf(r.id) }))
    })
  })
  return out
}

async function main() {
  const a = parseArgs(process.argv.slice(2))
  if (!a.log) { console.error('usage: node eval/e0/draft-questions.mjs --log <query-log.jsonl> [--db <mnemosyne.db copy>] [--out questions.json]'); process.exit(2) }
  let snippetOf = () => ''
  if (a.db) {
    const db = new (await initSqlJs()).Database(fs.readFileSync(a.db))
    snippetOf = (id) => {
      const st = db.prepare('SELECT substr(content, 1, 200) AS s FROM nodes WHERE id = ?')
      st.bind([id])
      const s = st.step() ? st.getAsObject().s : ''
      st.free()
      return String(s).replace(/\s+/g, ' ')
    }
  }
  const questions = draftQuestions(readQueryLog(a.log), snippetOf)
  const out = resolve(a.out || 'eval/e0/questions.json')
  if (fs.existsSync(out) && !a.force) { console.error(`${out} exists; pass --force to overwrite`); process.exit(1) }
  fs.writeFileSync(out, JSON.stringify({ types: 'fact | update | multi | howto | decision | record', questions }, null, 2))
  console.error(`${questions.length} drafts written to ${out}. Fill in type, answer and nuggets; drafts without a type are skipped by run.mjs.`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1) })
