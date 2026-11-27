// A small synthetic memory (no real data) covering every level, for the tests.
import fs from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import initSqlJs from 'sql.js'
import { normalize } from '../lib/retrieval.js'

const HERE = dirname(fileURLToPath(import.meta.url))

const NODES = [
  // id, type, project, platform, created, tags, content
  ['d1', 'D', 'p_net', 'claude-code', '2026-05-01T10:00:00Z', [], '[user] 演示环境的管理后台怎么进？\n[assistant] 管理后台监听 8443 端口，证书放在 /etc/ssl/demo 目录。'],
  ['d2', 'D', 'p_net', 'claude-code', '2026-05-01T10:05:00Z', [], '[user] deploy the demo service\n[assistant] Ran rsync -az build/ demo:/srv/app and restarted the unit; health check passed.'],
  ['d3', 'D', 'p_paper', 'codex', '2026-05-03T09:00:00Z', [], '[user] 论文的评测用哪个数据集？\n[assistant] 先用公开的长对话数据集做对照，再用自己的日志做主实验。'],
  ['d4', 'D', 'p_net', 'cowork', '2026-07-10T08:00:00Z', [], '[user] 提炼换个模型\n[assistant] 已把提炼模型从 alpha 改成 beta，并重启了服务。'],
  ['i1', 'I', 'p_net', 'synthesis', '2026-05-01T10:10:00Z', ['auto-transformed'], 'The demo admin console listens on a non-default TLS port and its certificate lives under the system ssl directory.'],
  ['i2', 'I', 'p_net', 'synthesis', '2026-05-02T10:00:00Z', ['auto-transformed'], '提炼使用 alpha 模型。'],
  ['i3', 'I', 'p_net', 'synthesis', '2026-07-10T08:10:00Z', ['auto-transformed'], '提炼模型现在是 beta，之前的 alpha 已停用。'],
  ['k1', 'K', 'p_net', 'synthesis', '2026-05-01T10:20:00Z', ['auto-transformed', 'skill'], 'Deploying the demo service: build, copy the build directory to the host with rsync, restart the unit, then check health before announcing.'],
  ['w1', 'W', 'p_net', 'meta-analysis', '2026-05-01T10:30:00Z', ['auto-transformed'], '改任何配置之前先备份；能回滚的改动才值得在生产上直接做。'],
  ['r1', 'I', 'p_paper', 'mcp', '2026-05-04T09:00:00Z', ['recorded', 'todo'], '待办：给论文实验标注两百道题目。'],
  ['r2', 'I', 'p_paper', 'mcp', '2026-05-04T09:10:00Z', ['recorded', 'decision', 'superseded-by:r3'], '决定：论文主实验只用公开数据集。'],
  ['r3', 'I', 'p_paper', 'mcp', '2026-06-01T09:00:00Z', ['recorded', 'decision'], '决定：论文主实验改用自己的日志，公开数据集只做对照。'],
  ['m1', 'K', 'kb_demo', 'claude-project', '2026-04-01T00:00:00Z', ['project-knowledge', 'file:notes.md'], '[Project doc · Demo · notes.md]\nThe demo project tracks deployment notes and the paper outline.']
]
const EDGES = [['d1', 'i1', 'contextualizes'], ['d2', 'k1', 'contextualizes'], ['i1', 'k1', 'synthesizes'], ['k1', 'w1', 'judges']]

export const QUESTIONS = [
  { id: 'q1', query: '管理后台的端口是多少', type: 'fact', answer: '8443', nuggets: ['8443'], evidence: ['d1'] },
  { id: 'q2', query: 'how do I deploy the demo service', type: 'howto', answer: 'rsync the build and restart', nuggets: ['rsync'], evidence: ['k1'] },
  { id: 'q3', query: '改配置之前应该注意什么', type: 'decision', answer: '先备份', nuggets: ['备份'], evidence: ['w1'] },
  { id: 'q4', query: '论文还有哪些待办', type: 'record', answer: '标注两百道题目', nuggets: ['两百道'], evidence: ['r1'] },
  { id: 'q5', query: '现在用哪个模型做提炼', type: 'update', answer: 'beta', nuggets: ['beta'], evidence: ['i3'] },
  { id: 'q6', query: '提炼用哪个模型', type: 'update', answer: 'alpha', nuggets: ['alpha'], evidence: ['i2'], asOf: '2026-06-01T00:00:00Z' }
]

export async function fixtureDb() {
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  db.exec(fs.readFileSync(join(HERE, '..', 'db', 'schema.sql'), 'utf8'))
  db.run(`CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, project_uuids TEXT, folders TEXT, updated_at TEXT)`)
  for (const c of ['workspace', 'platform', 'space_id']) db.run(`ALTER TABLE projects ADD COLUMN ${c} TEXT`)
  for (const [id, platform] of [['p_net', 'claude-code'], ['p_paper', 'codex'], ['kb_demo', 'claude-project']]) {
    db.run('INSERT INTO projects (id, name, color, created_at, updated_at, platform) VALUES (?, ?, ?, ?, ?, ?)', [id, id, '#000', '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z', platform])
  }
  for (const [id, type, project, platform, created, tags, content] of NODES) {
    db.run('INSERT INTO nodes (id, type, project_id, source_platform, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, type, project, platform, content, JSON.stringify(tags), created, created])
  }
  for (const [f, t, label] of EDGES) db.run('INSERT INTO connections (id, from_node_id, to_node_id, label, created_at) VALUES (?, ?, ?, ?, ?)', [`c_${f}_${t}`, f, t, label, '2026-05-01T00:00:00Z'])
  return db
}

export function storeFor(db) {
  const dbAll = (sql, params = []) => { const st = db.prepare(sql); if (params.length) st.bind(params); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out }
  return { dbAll, dbGet: (s, p) => dbAll(s, p)[0] || null, dbRun: (s, p = []) => db.run(s, p), save() {}, broadcast() {}, version: () => 1 }
}

/** Deterministic stand-in for an embedding model: hashed character bigrams. */
export const mockEmbed = Object.assign(async (texts) => texts.map(t => {
  const v = new Float32Array(64), s = String(t).toLowerCase()
  for (let i = 0; i < s.length - 1; i++) v[(s.charCodeAt(i) * 31 + s.charCodeAt(i + 1)) % 64] += 1
  return normalize(v)
}), { model: 'mock' })
