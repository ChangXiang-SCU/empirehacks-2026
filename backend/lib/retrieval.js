// Ranking primitives over memory entries: lexical (BM25), dense (embeddings) and their fusion (RRF).
// Pure functions, no dependencies. Used by the evaluation harness (backend/eval); search_memory can adopt them
// once the evaluation shows they beat its current keyword scorer.

const CJK_RUN = /[㐀-鿿豈-﫿]+/g
const CJK_CHAR = /[㐀-鿿豈-﫿]/g

/** Terms for lexical matching: lower-cased words and numbers, plus bigrams of each CJK run (a lone CJK character stays whole). */
export function tokenize(text) {
  const s = String(text || '').toLowerCase()
  const out = []
  for (const w of s.replace(CJK_RUN, ' ').split(/[^\p{L}\p{N}_]+/u)) if (w.length >= 2) out.push(w)
  for (const run of s.match(CJK_RUN) || []) {
    if (run.length === 1) out.push(run)
    else for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2))
  }
  return out
}

/** Rough token count, the same for every condition being compared: one per CJK character, one per four other characters. */
export function estimateTokens(text) {
  const s = String(text || '')
  const cjk = (s.match(CJK_CHAR) || []).length
  return cjk + Math.ceil((s.length - cjk) / 4)
}

/** Split long text into overlapping passages for embedding; at most `max` passages from the start of the text. */
export function chunkText(text, { size = 1200, overlap = 150, max = 4 } = {}) {
  const s = String(text || '').trim()
  if (s.length <= size) return s ? [s] : []
  const out = []
  for (let i = 0; i < s.length && out.length < max; i += size - overlap) out.push(s.slice(i, i + size))
  return out
}

function topK(scores, mask, limit) {
  const out = []
  for (let i = 0; i < scores.length; i++) if (scores[i] > 0 && (!mask || mask[i])) out.push({ i, score: scores[i] })
  out.sort((a, b) => b.score - a.score || a.i - b.i)
  return out.slice(0, limit)
}

/** Okapi BM25 over an array of texts. search() returns [{ i, score }], best first; `mask[i]` falsy excludes entry i. */
export class Bm25Index {
  constructor(texts, { k1 = 1.2, b = 0.75 } = {}) {
    this.k1 = k1; this.b = b; this.n = texts.length
    this.len = new Float64Array(this.n)
    this.postings = new Map()
    let total = 0
    texts.forEach((t, i) => {
      const tf = new Map()
      const toks = tokenize(t)
      for (const w of toks) tf.set(w, (tf.get(w) || 0) + 1)
      this.len[i] = toks.length; total += toks.length
      for (const [w, f] of tf) {
        let p = this.postings.get(w)
        if (!p) this.postings.set(w, p = { d: [], f: [] })
        p.d.push(i); p.f.push(f)
      }
    })
    this.avg = this.n ? total / this.n : 0
  }

  search(query, { mask = null, limit = 50 } = {}) {
    const scores = new Float64Array(this.n)
    for (const w of new Set(tokenize(query))) {
      const p = this.postings.get(w)
      if (!p) continue
      const idf = Math.log(1 + (this.n - p.d.length + 0.5) / (p.d.length + 0.5))
      for (let j = 0; j < p.d.length; j++) {
        const i = p.d[j], f = p.f[j]
        scores[i] += idf * f * (this.k1 + 1) / (f + this.k1 * (1 - this.b + this.b * this.len[i] / (this.avg || 1)))
      }
    }
    return topK(scores, mask, limit)
  }
}

export function normalize(vec) {
  let s = 0
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i]
  s = Math.sqrt(s) || 1
  const out = new Float32Array(vec.length)
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / s
  return out
}

/** Cosine search over unit vectors. An entry may own several passage vectors; its score is the best of them. */
export class DenseIndex {
  constructor(n) { this.n = n; this.vecs = []; this.owner = [] }
  add(i, vec) { this.vecs.push(vec); this.owner.push(i) }
  search(qvec, { mask = null, limit = 50 } = {}) {
    const scores = new Float64Array(this.n)
    for (let j = 0; j < this.vecs.length; j++) {
      const i = this.owner[j]
      if (mask && !mask[i]) continue
      const v = this.vecs[j]
      let dot = 0
      for (let d = 0; d < v.length; d++) dot += v[d] * qvec[d]
      if (dot > scores[i]) scores[i] = dot
    }
    return topK(scores, mask, limit)
  }
}

/** Reciprocal rank fusion of ranked lists of { i }. */
export function rrf(lists, { k = 60, limit = 50 } = {}) {
  const acc = new Map()
  for (const list of lists) list.forEach((r, rank) => acc.set(r.i, (acc.get(r.i) || 0) + 1 / (k + rank + 1)))
  return [...acc].map(([i, score]) => ({ i, score })).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit)
}

// ── Which level answers which kind of question ──
// The mapping is the hypothesis the evaluation tests, not an established fact.
export const QUESTION_TYPES = ['fact', 'update', 'multi', 'howto', 'decision', 'record']
export const LEVELS_FOR_TYPE = {
  fact: ['D', 'I'],        // a detail that was said once
  update: ['I', 'D'],      // the current state of something that changed
  multi: ['I', 'K'],       // a summary across sessions
  howto: ['K', 'D'],       // how something was done
  decision: ['W', 'K'],    // what to do, given past experience
  record: ['R']            // open to-dos and decisions in force (exact records)
}

const GUESS = [
  ['record', /待办|未完成|还没做|todo|to-do|open items|定了什么|现行|in force|decisions? (made|in force)/i],
  ['howto', /怎么|如何|怎样|步骤|命令|配置方法|how (do|to|did)|steps|command/i],
  ['decision', /该不该|要不要|应不应该|应该|建议|取舍|值不值|should (i|we)|recommend|trade-?off|worth/i],
  ['update', /现在|目前|当前|最新|还是|改成|换成|current|latest|now|still|changed/i],
  ['multi', /总结|汇总|所有|哪些|分别|一共|历次|overall|summar|all the|across|list (all|every)/i]
]

/** A keyword guess at the question type; `fact` when nothing matches. A baseline router, deliberately simple. */
export function guessQuestionType(query) {
  for (const [type, re] of GUESS) if (re.test(query || '')) return type
  return 'fact'
}
