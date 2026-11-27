#!/usr/bin/env node
// E0: which level of memory (D raw turns, I facts, K know-how, W principles, R exact records) answers which kind of
// question, at an equal context budget. See README.md in this folder.
//   node eval/e0/run.mjs --db <copy of mnemosyne.db> --questions <questions.json> [--budget 1500] [--k 10]
//                        [--out eval/e0/results] [--answer] [--embed-url URL --embed-model NAME]
import fs from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import initSqlJs from 'sql.js'
import { Bm25Index, DenseIndex, rrf, chunkText, estimateTokens, QUESTION_TYPES, LEVELS_FOR_TYPE, guessQuestionType } from '../../lib/retrieval.js'
import { embedConfig, createEmbedder, EmbeddingCache, embedAll } from '../../lib/embeddings.js'
import { factInfo } from '../../lib/facts.js'
import { createMemoryIndex } from '../../lib/remoteMcp.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEPTH = 50
const LINEAGE = new Set(['contextualizes', 'synthesizes', 'judges'])

function rows(db, sql) {
  const st = db.prepare(sql), out = []
  while (st.step()) out.push(st.getAsObject())
  st.free()
  return out
}

/** Level of an entry for this experiment: R exact record, M imported project material, otherwise its D/I/K/W type. */
function levelOf(n) {
  if (factInfo(n.tags)?.kind) return 'R'
  if (n.source_platform === 'claude-project' || /^kb(mem|notes)?_/.test(n.project_id)) return 'M'
  return n.type
}

export function loadCorpus(db) {
  const nodes = rows(db, 'SELECT id, type, project_id, source_platform, content, tags, created_at FROM nodes')
  nodes.forEach((n, i) => { n.i = i; n.ts = Date.parse(n.created_at) || 0; n.level = levelOf(n) })
  const byId = new Map(nodes.map(n => [n.id, n]))
  // Entries distilled from an entry (D -> I -> K -> W), so a distillation of the gold evidence counts as evidence too
  const up = new Map()
  for (const e of rows(db, 'SELECT from_node_id AS f, to_node_id AS t, label FROM connections')) {
    if (LINEAGE.has(e.label) && byId.has(e.f) && byId.has(e.t)) (up.get(e.f) || up.set(e.f, []).get(e.f)).push(e.t)
  }
  return { nodes, byId, up }
}

function withLineage(ids, up) {
  const seen = new Set(ids), queue = [...ids]
  while (queue.length) for (const t of up.get(queue.pop()) || []) if (!seen.has(t)) { seen.add(t); queue.push(t) }
  return seen
}

const mean = (xs) => { const v = xs.filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }

/** Paired bootstrap of mean(a - b): [mean difference, 2.5th percentile, 97.5th percentile]. Seeded, so reruns agree. */
export function pairedBootstrap(a, b, { rounds = 2000, seed = 7 } = {}) {
  const d = a.map((x, i) => (x == null || b[i] == null) ? null : x - b[i]).filter(x => x != null)
  if (!d.length) return null
  let s = seed >>> 0
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const means = []
  for (let r = 0; r < rounds; r++) { let sum = 0; for (let j = 0; j < d.length; j++) sum += d[Math.floor(rnd() * d.length)]; means.push(sum / d.length) }
  means.sort((x, y) => x - y)
  return [mean(d), means[Math.floor(rounds * 0.025)], means[Math.floor(rounds * 0.975)]]
}

function nuggetHit(context, nugget) {
  if (nugget.startsWith('re:')) { try { return new RegExp(nugget.slice(3), 'i').test(context) } catch { return false } }
  return context.toLowerCase().includes(nugget.toLowerCase())
}

/** Entries in rank order until the token budget is full; the last one is cut to fit. */
function buildContext(ranked, nodes, budget) {
  const parts = []
  let used = 0
  for (const r of ranked) {
    let text = nodes[r.i].content || '', tok = estimateTokens(text)
    if (used + tok > budget) {
      const remain = budget - used
      if (remain < 40) break
      text = text.slice(0, Math.floor(text.length * remain / tok)); tok = estimateTokens(text)
    }
    parts.push({ i: r.i, text, tokens: tok })
    used += tok
    if (used >= budget) break
  }
  return { parts, tokens: used }
}

async function buildDense(corpus, questions, embed, cacheFile, log) {
  const cache = cacheFile ? new EmbeddingCache(cacheFile) : null
  const owners = [], texts = []
  for (const n of corpus.nodes) for (const c of chunkText(n.content)) { owners.push(n.i); texts.push(c) }
  log(`embedding ${texts.length} passages of ${corpus.nodes.length} entries (${embed.model})`)
  const vecs = await embedAll(texts, embed, cache, { kind: 'doc', onProgress: (a, b) => log(`  ${a}/${b}`) })
  const dense = new DenseIndex(corpus.nodes.length)
  vecs.forEach((v, j) => dense.add(owners[j], v))
  const qvecs = await embedAll(questions.map(q => q.query), embed, cache, { kind: 'query' })
  return { dense, qvecs }
}

/**
 * Run every condition on every question.
 * @param {object} o  db (sql.js Database), questions [{ id, query, type, answer?, nuggets?, evidence?, asOf? }],
 *                    embed (optional embedder), budget, k, cacheFile, answerer (optional async (question, context) -> { answer, verdict })
 */
export async function runE0({ db, questions, embed = null, budget = 1500, k = 10, cacheFile = null, answerer = null, log = () => {} }) {
  const corpus = loadCorpus(db)
  const { nodes } = corpus
  const bm25 = new Bm25Index(nodes.map(n => n.content))
  const { dense, qvecs } = embed ? await buildDense(corpus, questions, embed, cacheFile, log) : { dense: null, qvecs: null }
  const fused = dense ? 'hybrid' : 'bm25'
  const prod = createMemoryIndex({ dbAll: (sql) => rows(db, sql), version: () => 1 })

  const conditions = [
    { id: 'prod-keyword', note: 'the scorer search_memory uses today, over everything' },
    { id: 'D-bm25', levels: ['D'], mode: 'bm25' },
    ...(dense ? [{ id: 'D-dense', levels: ['D'], mode: 'dense' }, { id: 'D-hybrid', levels: ['D'], mode: 'hybrid' }] : []),
    ...['I', 'K', 'W', 'R'].map(l => ({ id: `${l}-${fused}`, levels: [l], mode: fused })),
    { id: `IKW-${fused}`, levels: ['I', 'K', 'W'], mode: fused },
    { id: `DIKW-${fused}`, levels: ['D', 'I', 'K', 'W', 'R'], mode: fused },
    { id: `everything-${fused}`, levels: ['D', 'I', 'K', 'W', 'R', 'M'], mode: fused },
    { id: `routed-oracle-${fused}`, route: (q) => LEVELS_FOR_TYPE[q.type], mode: fused },
    { id: `routed-guess-${fused}`, route: (q) => LEVELS_FOR_TYPE[guessQuestionType(q.query)], mode: fused }
  ]
  const baseline = `D-${fused}`

  const rankFor = (q, qi, c) => {
    const asOf = q.asOf ? Date.parse(q.asOf) : Infinity
    if (c.id === 'prod-keyword') {
      return prod.search({ query: q.query, limit: 30 }).results.map(r => ({ i: corpus.byId.get(r.node.id).i })).filter(r => nodes[r.i].ts <= asOf)
    }
    const levels = new Set(c.route ? c.route(q) : c.levels)
    const mask = new Uint8Array(nodes.length)
    for (const n of nodes) if (levels.has(n.level) && n.ts <= asOf) mask[n.i] = 1
    const lex = c.mode === 'dense' ? null : bm25.search(q.query, { mask, limit: DEPTH })
    const den = c.mode === 'bm25' ? null : dense.search(qvecs[qi], { mask, limit: DEPTH })
    return c.mode === 'hybrid' ? rrf([lex, den], { limit: DEPTH }) : (lex || den)
  }

  const per = []
  for (const [qi, q] of questions.entries()) {
    const asOf = q.asOf ? Date.parse(q.asOf) : Date.now()
    const gold = q.evidence?.length ? withLineage(q.evidence.filter(id => corpus.byId.has(id)), corpus.up) : null
    for (const c of conditions) {
      const ranked = rankFor(q, qi, c)
      const ctx = buildContext(ranked, nodes, budget)
      const text = ctx.parts.map(p => p.text).join('\n')
      const first = gold?.size ? ranked.findIndex(r => gold.has(nodes[r.i].id)) : -1
      const row = {
        q: q.id, type: q.type, cond: c.id,
        hit: gold?.size ? (first !== -1 && first < k ? 1 : 0) : null,
        mrr: gold?.size ? (first === -1 ? 0 : 1 / (first + 1)) : null,
        nuggets: q.nuggets?.length ? q.nuggets.filter(g => nuggetHit(text, g)).length / q.nuggets.length : null,
        tokens: ctx.tokens,
        stale: ctx.parts.length ? ctx.parts.filter(p => { const f = factInfo(nodes[p.i].tags, asOf); return f && f.status !== 'active' }).length / ctx.parts.length : 0,
        top: ranked.slice(0, k).map(r => nodes[r.i].id)
      }
      if (answerer && q.answer) Object.assign(row, await answerer(q, ctx.parts.map(p => `[${nodes[p.i].level} ${nodes[p.i].created_at?.slice(0, 10)}] ${p.text}`).join('\n\n'), c.id))
      per.push(row)
    }
    log(`question ${qi + 1}/${questions.length}`)
  }

  const types = ['all', ...QUESTION_TYPES.filter(t => questions.some(q => q.type === t))]
  const pick = (cond, type) => per.filter(r => r.cond === cond && (type === 'all' || r.type === type))
  const summary = []
  for (const c of conditions) for (const type of types) {
    const rs = pick(c.id, type), base = pick(baseline, type)
    const acc = rs.some(r => r.verdict) ? mean(rs.map(r => r.verdict ? (r.verdict === 'CORRECT' ? 1 : 0) : null)) : null
    summary.push({
      cond: c.id, type, n: rs.length, hit: mean(rs.map(r => r.hit)), mrr: mean(rs.map(r => r.mrr)), nuggets: mean(rs.map(r => r.nuggets)),
      tokens: mean(rs.map(r => r.tokens)), stale: mean(rs.map(r => r.stale)), accuracy: acc,
      vsBaseline: c.id === baseline ? null : pairedBootstrap(rs.map(r => r.nuggets), base.map(r => r.nuggets))
    })
  }
  return { meta: { entries: nodes.length, levels: countBy(nodes.map(n => n.level)), questions: questions.length, budget, k, fused, baseline, embedModel: embed?.model || null }, conditions: conditions.map(c => c.id), summary, per }
}

const countBy = (xs) => xs.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {})
const f2 = (x) => x == null ? '-' : x.toFixed(2)

/** Markdown tables: one per question type, plus the conditions whose nugget recall beats the D-only baseline. */
export function renderSummary(res) {
  const { meta, summary } = res
  let out = `# E0 results\n\n${meta.questions} questions, ${meta.entries} entries (${Object.entries(meta.levels).map(([l, c]) => `${l} ${c}`).join(', ')}). Context budget ${meta.budget} tokens, k = ${meta.k}, ${meta.fused === 'hybrid' ? `BM25 + ${meta.embedModel} fused by RRF` : 'BM25 only (no embedding endpoint configured)'}.\n`
  out += `\nColumns: hit@${meta.k} and MRR against gold evidence (and entries distilled from it); nuggets = share of answer nuggets present in the context; diff = nuggets minus ${meta.baseline}, with a 95% bootstrap interval.\n`
  for (const type of [...new Set(summary.map(s => s.type))]) {
    const rs = summary.filter(s => s.type === type)
    out += `\n## ${type} (n = ${rs[0].n})\n\n| condition | hit@${meta.k} | MRR | nuggets | diff vs ${meta.baseline} | tokens | stale share |${rs.some(r => r.accuracy != null) ? ' accuracy |' : ''}\n|---|---|---|---|---|---|---|${rs.some(r => r.accuracy != null) ? '---|' : ''}\n`
    for (const r of rs) out += `| ${r.cond} | ${f2(r.hit)} | ${f2(r.mrr)} | ${f2(r.nuggets)} | ${r.vsBaseline ? `${r.vsBaseline[0] >= 0 ? '+' : ''}${f2(r.vsBaseline[0])} [${f2(r.vsBaseline[1])}, ${f2(r.vsBaseline[2])}]` : '-'} | ${r.tokens == null ? '-' : Math.round(r.tokens)} | ${f2(r.stale)} |${rs.some(x => x.accuracy != null) ? ` ${f2(r.accuracy)} |` : ''}\n`
  }
  const wins = summary.filter(s => s.vsBaseline && s.vsBaseline[1] > 0 && !/^(D-|prod-)/.test(s.cond))
  out += `\n## Does anything beat raw turns?\n\n` + (wins.length
    ? wins.map(w => `- ${w.type}: ${w.cond} is above ${meta.baseline} by ${f2(w.vsBaseline[0])} (interval ${f2(w.vsBaseline[1])} to ${f2(w.vsBaseline[2])})`).join('\n')
    : `No condition is reliably above ${meta.baseline} on nugget recall for any question type.`) + '\n'
  return out
}

/** Reads a context, answers, and has the answer judged against the reference. Results are cached on disk per condition and question. */
async function makeAnswerer(outDir) {
  const { callLLM, llmConfigured, llmDescription } = await import('../../lib/dikwEngine.js')
  if (!llmConfigured()) throw new Error('--answer needs an LLM: set MNEMO_LLM_* or ANTHROPIC_API_KEY (see lib/dikwEngine.js)')
  const file = join(outDir, 'answers.jsonl'), cache = new Map()
  if (fs.existsSync(file)) for (const l of fs.readFileSync(file, 'utf8').split('\n')) { try { const r = JSON.parse(l); cache.set(r.key, r) } catch {} }
  console.error(`answering with ${llmDescription()}`)
  return async (q, context, cond) => {
    const key = `${cond}|${q.id}`
    if (cache.has(key)) return { answer: cache.get(key).answer, verdict: cache.get(key).verdict }
    const answer = await callLLM('Answer the question using only the memory excerpts given. If they do not contain the answer, reply exactly: I don\'t know. Answer briefly, in the language of the question.',
      `Memory excerpts:\n${context || '(none)'}\n\nQuestion: ${q.query}`) || ''
    const judged = await callLLM('You grade an answer against a reference. Reply with one word only: CORRECT if the answer states the same fact(s) as the reference, ABSTAIN if it says it does not know, WRONG otherwise.',
      `Question: ${q.query}\nReference answer: ${q.answer}\nAnswer to grade: ${answer}`) || ''
    const verdict = /CORRECT/i.test(judged) ? 'CORRECT' : /ABSTAIN/i.test(judged) ? 'ABSTAIN' : 'WRONG'
    const r = { key, answer, verdict }
    cache.set(key, r); fs.appendFileSync(file, JSON.stringify(r) + '\n')
    return { answer, verdict }
  }
}

export function parseArgs(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    a[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true
  }
  return a
}

async function main() {
  const a = parseArgs(process.argv.slice(2))
  if (!a.db || !a.questions) { console.error('usage: node eval/e0/run.mjs --db <mnemosyne.db copy> --questions <questions.json> [--budget 1500] [--k 10] [--out dir] [--answer]'); process.exit(2) }
  const out = resolve(a.out || join(HERE, 'results'))
  fs.mkdirSync(out, { recursive: true })
  const SQL = await initSqlJs()
  const db = new SQL.Database(fs.readFileSync(a.db))
  const parsed = JSON.parse(fs.readFileSync(a.questions, 'utf8'))
  const questions = (parsed.questions || parsed).filter(q => q.query && QUESTION_TYPES.includes(q.type))
  const cfg = embedConfig(process.env, { baseUrl: a['embed-url'], model: a['embed-model'] })
  if (!cfg) console.error('no embedding endpoint (MNEMO_EMBED_BASE_URL + MNEMO_EMBED_MODEL): running BM25-only conditions')
  const res = await runE0({
    db, questions, embed: cfg ? createEmbedder(cfg) : null, budget: Number(a.budget || 1500), k: Number(a.k || 10),
    cacheFile: cfg ? join(HERE, '.cache', 'emb-' + cfg.model.replace(/[^\w.-]+/g, '_')) : null,
    answerer: a.answer ? await makeAnswerer(out) : null, log: (m) => console.error(m)
  })
  fs.writeFileSync(join(out, 'results.json'), JSON.stringify(res, null, 1))
  fs.writeFileSync(join(out, 'summary.md'), renderSummary(res))
  console.log(renderSummary(res))
  console.error(`written: ${join(out, 'summary.md')}, ${join(out, 'results.json')}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1) })
