// Text embeddings from any OpenAI-compatible /embeddings endpoint (OpenAI, llama.cpp, vLLM, Ollama, TEI ...),
// with an on-disk cache so a corpus is embedded once per model.
//   MNEMO_EMBED_BASE_URL      e.g. http://127.0.0.1:8080/v1 or https://api.openai.com/v1
//   MNEMO_EMBED_MODEL         e.g. bge-m3, text-embedding-3-small
//   MNEMO_EMBED_API_KEY       optional; OPENAI_API_KEY is used for api.openai.com only. Never sent to a local server.
//   MNEMO_EMBED_QUERY_PREFIX  / MNEMO_EMBED_DOC_PREFIX   for models that want them (e5: "query: " / "passage: ")
import fs from 'fs'
import crypto from 'crypto'
import { dirname } from 'path'
import { normalize } from './retrieval.js'

const isLocal = (u) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(u || '')

/** Settings from the environment, or null when no embedding endpoint is configured. */
export function embedConfig(env = process.env, over = {}) {
  const baseUrl = (over.baseUrl || env.MNEMO_EMBED_BASE_URL || '').replace(/\/$/, '')
  const model = over.model || env.MNEMO_EMBED_MODEL || ''
  if (!baseUrl || !model) return null
  const apiKey = isLocal(baseUrl) ? '' : (over.apiKey || env.MNEMO_EMBED_API_KEY || (/api\.openai\.com/.test(baseUrl) ? env.OPENAI_API_KEY : '') || '')
  return {
    baseUrl, model, apiKey,
    queryPrefix: over.queryPrefix ?? env.MNEMO_EMBED_QUERY_PREFIX ?? '',
    docPrefix: over.docPrefix ?? env.MNEMO_EMBED_DOC_PREFIX ?? '',
    batch: Number(over.batch || env.MNEMO_EMBED_BATCH || 32),
    timeoutMs: Number(over.timeoutMs || env.MNEMO_EMBED_TIMEOUT_MS || 120000)
  }
}

/** embed(texts, kind) -> unit Float32Array per text; kind is 'doc' or 'query'. */
export function createEmbedder(cfg, fetchImpl = fetch) {
  async function call(inputs) {
    const res = await fetchImpl(cfg.baseUrl + '/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify({ model: cfg.model, input: inputs }),
      signal: AbortSignal.timeout(cfg.timeoutMs)
    })
    if (!res.ok) throw new Error(`embeddings HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
    const data = (await res.json()).data || []
    if (data.length !== inputs.length) throw new Error(`embeddings: asked for ${inputs.length}, got ${data.length}`)
    return [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(d => normalize(Float32Array.from(d.embedding)))
  }
  const embed = async (texts, kind = 'doc') => {
    const prefix = kind === 'query' ? cfg.queryPrefix : cfg.docPrefix
    const out = []
    for (let i = 0; i < texts.length; i += cfg.batch) out.push(...await call(texts.slice(i, i + cfg.batch).map(t => prefix + t)))
    return out
  }
  embed.model = cfg.model
  return embed
}

/** Vectors on disk, keyed by a hash of the text. One cache file pair per model: <file>.json (keys) and <file>.f32 (data). */
export class EmbeddingCache {
  constructor(file) {
    this.file = file; this.map = new Map(); this.dim = 0; this.dirty = false
    try {
      const meta = JSON.parse(fs.readFileSync(file + '.json', 'utf8'))
      const buf = fs.readFileSync(file + '.f32')
      const all = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
      if (meta.dim > 0 && all.length === meta.keys.length * meta.dim) {
        this.dim = meta.dim
        meta.keys.forEach((k, i) => this.map.set(k, all.slice(i * meta.dim, (i + 1) * meta.dim)))
      }
    } catch {}
  }
  static key(text) { return crypto.createHash('sha1').update(text).digest('hex').slice(0, 24) }
  get(text) { return this.map.get(EmbeddingCache.key(text)) }
  set(text, vec) { this.dim = vec.length; this.map.set(EmbeddingCache.key(text), vec); this.dirty = true }
  save() {
    if (!this.dirty) return
    fs.mkdirSync(dirname(this.file), { recursive: true })
    const keys = [...this.map.keys()]
    const all = new Float32Array(keys.length * this.dim)
    keys.forEach((k, i) => all.set(this.map.get(k), i * this.dim))
    fs.writeFileSync(this.file + '.f32.tmp', Buffer.from(all.buffer, all.byteOffset, all.byteLength))
    fs.renameSync(this.file + '.f32.tmp', this.file + '.f32')
    fs.writeFileSync(this.file + '.json', JSON.stringify({ dim: this.dim, keys }))
    this.dirty = false
  }
}

/** Embed texts, taking what the cache already has. Saves the cache every `saveEvery` new vectors and at the end. */
export async function embedAll(texts, embed, cache, { kind = 'doc', saveEvery = 512, onProgress } = {}) {
  const out = new Array(texts.length)
  const missing = []
  texts.forEach((t, i) => { const v = cache?.get(t); if (v) out[i] = v; else missing.push(i) })
  for (let done = 0; done < missing.length; done += saveEvery) {
    const idx = missing.slice(done, done + saveEvery)
    const vecs = await embed(idx.map(i => texts[i]), kind)
    idx.forEach((i, j) => { out[i] = vecs[j]; cache?.set(texts[i], vecs[j]) })
    cache?.save()
    onProgress?.(Math.min(done + saveEvery, missing.length), missing.length)
  }
  return out
}
