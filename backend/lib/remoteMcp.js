// Mnemosyne remote MCP server (Streamable HTTP, stateless, JSON responses).
// Mounted by server.js at /<MNEMO_SECRET>/mcp so every MCP client
// (claude.ai connectors, Claude Code, Codex, the WeChat bot) reads the same memory.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { queryTerms, snippet, makeTitle } from './text.js'
import { generateSkillMd } from './dikwEngine.js'

const TYPE_WEIGHT = { W: 1.6, K: 1.5, I: 1.2, D: 0.6 }
const TYPE_NAME = { D: 'Data', I: 'Information', K: 'Knowledge', W: 'Wisdom' }
const DAY = 86400000

const INSTRUCTIONS = `Mnemosyne is the user's shared long-term memory across all of their AI tools: Claude Code, Cowork, claude.ai chat, Codex, and a WeChat bot. It stores raw conversation turns (D) and distilled Information/Knowledge/Wisdom (I/K/W).
Use it when:
- the user refers to earlier work, another session/tool/project, or asks "did we / what did we decide / where did I do X" -> search_memory (try both Chinese and English keywords; results include ids for get_node).
- the user asks what they've been working on lately -> recent_activity.
- you need background on a project/repo/folder -> get_project_context (accepts a name, workspace folder, or id).
- at the end of substantial work, or when the user states a durable decision, preference or fact worth reusing in other tools -> record_learning (one self-contained paragraph; type K for reusable know-how, W for judgment/principles, I for facts/status).
Sessions are grouped under the user's Claude Projects (the same Projects as in the Claude app). If this conversation belongs to a Claude Project, pass that Project's name as \`project\` to get_project_context, search_memory and record_learning; list_projects shows all Projects.
Memory may be stale; prefer the newest entries and confirm anything that matters.`

function fmtDate(s) { return (s || '').slice(0, 10) }

export function createMemoryIndex(store) {
  let cache = null
  function load() {
    const v = store.version()
    if (cache && cache.v === v) return cache
    const spaces = new Map()
    try { for (const sp of store.dbAll('SELECT * FROM spaces')) spaces.set(sp.id, { ...sp, uuids: JSON.parse(sp.project_uuids || '[]') }) } catch {}
    const projects = new Map()
    for (const p of store.dbAll('SELECT * FROM projects')) {
      projects.set(p.id, { ...p, spaceName: spaces.get(p.space_id)?.name || null, counts: { D: 0, I: 0, K: 0, W: 0 }, last: '' })
    }
    const nodes = store.dbAll('SELECT id, type, project_id, source_platform, content, tags, created_at, updated_at FROM nodes')
    for (const n of nodes) {
      n.low = (n.content || '').toLowerCase()
      n.ts = Date.parse(n.updated_at || n.created_at) || 0
      let p = projects.get(n.project_id)
      if (!p) { p = { id: n.project_id, name: n.project_id, counts: { D: 0, I: 0, K: 0, W: 0 }, last: '' }; projects.set(n.project_id, p) }
      p.counts[n.type] = (p.counts[n.type] || 0) + 1
      const d = n.created_at || ''
      if (n.type === 'D') { if (d > (p.lastD || '')) p.lastD = d }
      else if (d > (p.lastX || '')) p.lastX = d
      if (!p.platform && n.type === 'D' && n.source_platform) p.platform = n.source_platform
    }
    // Activity date = newest conversation turn (D); distilled-only/manual projects use their newest entry
    for (const p of projects.values()) p.last = p.lastD || p.lastX || p.updated_at || p.created_at || ''
    cache = { v, projects, nodes, spaces }
    return cache
  }

  function projectLabel(p) {
    if (!p) return ''
    return (p.spaceName ? `[${p.spaceName}] ` : '') + [p.platform, p.workspace, p.name].filter(Boolean).join(' · ')
  }

  /** Claude Projects (spaces) whose name or claude.ai uuid matches q; exact name wins */
  function resolveSpaces(q) {
    const { spaces } = load()
    if (!q) return []
    const low = q.toLowerCase().trim()
    const all = [...spaces.values()]
    const exact = all.filter(sp => sp.name.toLowerCase() === low || sp.id === q || sp.uuids.includes(q))
    return exact.length ? exact : all.filter(sp => sp.name.toLowerCase().includes(low) || (low.length >= 4 && low.includes(sp.name.toLowerCase())))
  }

  function resolveProjects(q) {
    const { projects } = load()
    if (!q) return []
    if (projects.has(q)) return [projects.get(q)]
    const low = q.toLowerCase()
    const spaceIds = new Set(resolveSpaces(q).map(sp => sp.id))
    return [...projects.values()]
      .filter(p => spaceIds.has(p.space_id) || p.id.toLowerCase().includes(low) || (p.name || '').toLowerCase().includes(low) || (p.workspace || '').toLowerCase() === low || (p.workspace || '').toLowerCase().includes(low))
      .sort((a, b) => (b.last || '').localeCompare(a.last || ''))
  }

  function search({ query, type, project, platform, days, limit = 8 }) {
    const { nodes, projects } = load()
    const terms = queryTerms(query)
    const phrase = (query || '').toLowerCase().trim()
    if (!terms.length && !phrase) return { terms, results: [] }
    const allowedProjects = project ? new Set(resolveProjects(project).map(p => p.id)) : null
    const since = days ? Date.now() - days * DAY : 0
    const now = Date.now()
    const scoreAll = (minCov) => {
      const out = []
      for (const n of nodes) {
        if (type && n.type !== type) continue
        if (allowedProjects && !allowedProjects.has(n.project_id)) continue
        if (platform) {
          const p = projects.get(n.project_id)
          if (n.source_platform !== platform && p?.platform !== platform) continue
        }
        if (since && n.ts < since) continue
        let hits = 0, freq = 0
        for (const t of terms) {
          let i = n.low.indexOf(t), c = 0
          while (i !== -1 && c < 5) { c++; i = n.low.indexOf(t, i + t.length) }
          if (c) { hits++; freq += c }
        }
        const phraseHit = phrase.length >= 2 && n.low.includes(phrase)
        const cov = terms.length ? hits / terms.length : (phraseHit ? 1 : 0)
        if (cov < minCov && !phraseHit) continue
        const ageDays = Math.max(0, (now - n.ts) / DAY)
        const score = cov * 10 + Math.log1p(freq) + (TYPE_WEIGHT[n.type] || 1) + (phraseHit ? 3 : 0) + Math.max(0, 1 - ageDays / 180)
        out.push({ n, score })
      }
      return out
    }
    const strict = terms.length <= 2 ? 1 : 0.5
    let scored = scoreAll(strict)
    if (!scored.length && strict > 0.34) scored = scoreAll(0.34)
    scored.sort((a, b) => b.score - a.score)
    // Diversify: at most 3 results per project
    const perProject = new Map(), results = [], seen = new Set()
    for (const s of scored) {
      const c = perProject.get(s.n.project_id) || 0
      if (c >= 3) continue
      const key = s.n.low.replace(/^from \d+ patterns:\s*/, '').replace(/\s+/g, ' ').slice(0, 120)
      if (seen.has(key)) continue
      seen.add(key)
      perProject.set(s.n.project_id, c + 1)
      results.push(s)
      if (results.length >= limit) break
    }
    return { terms, results: results.map(({ n, score }) => ({ node: n, project: projects.get(n.project_id), score })), total: scored.length }
  }

  return { load, search, resolveProjects, resolveSpaces, projectLabel }
}

const text = (t) => ({ content: [{ type: 'text', text: t }] })

function buildServer(store, index) {
  const server = new McpServer(
    { name: 'mnemosyne', title: 'Mnemosyne memory', version: '2.0.0' },
    { instructions: INSTRUCTIONS }
  )

  server.registerTool('search_memory', {
    title: 'Search memory',
    description: 'Keyword search across all remembered conversations and distilled knowledge from every tool (Claude Code, Cowork, Codex, claude.ai, WeChat bot). Chinese and English both work. Returns ranked snippets with node ids; call get_node for full text.',
    inputSchema: {
      query: z.string().describe('Keywords, e.g. "甲骨文 ARM 抢占" or "FlClash tailscale"'),
      type: z.enum(['D', 'I', 'K', 'W']).optional().describe('Only this level: D raw turns, I facts, K know-how, W principles'),
      project: z.string().optional().describe('Restrict to a project/session name, workspace folder or id'),
      platform: z.string().optional().describe('claude-code | cowork | codex | claude-ai | wxbot | mcp'),
      days: z.number().int().positive().optional().describe('Only entries from the last N days'),
      limit: z.number().int().min(1).max(30).optional().describe('Default 8')
    },
    annotations: { readOnlyHint: true }
  }, async (args) => {
    const { terms, results, total } = index.search(args)
    if (!results.length) return text(`No memory matched "${args.query}". Try other keywords (synonyms, English/Chinese), or recent_activity.`)
    const lines = results.map(({ node: n, project: p }) =>
      `- [${n.type}] ${n.id} · ${fmtDate(n.created_at)} · ${index.projectLabel(p) || n.project_id}\n  ${snippet(n.content, terms)}`)
    return text(`${results.length} of ${total} matches for "${args.query}":\n${lines.join('\n')}`)
  })

  server.registerTool('recent_activity', {
    title: 'Recent activity',
    description: 'What the user has been doing recently across all tools: sessions with their title, tool, workspace, date, and the main takeaway when one was distilled.',
    inputSchema: {
      days: z.number().int().min(1).max(3650).optional().describe('Look-back window, default 7'),
      platform: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional().describe('Default 20')
    },
    annotations: { readOnlyHint: true }
  }, async ({ days = 7, platform, limit = 20 }) => {
    const { projects, nodes } = index.load()
    const since = new Date(Date.now() - days * DAY).toISOString()
    const seenSched = new Set()
    const recent = [...projects.values()]
      .filter(p => (p.last || '') >= since && (!platform || p.platform === platform))
      .sort((a, b) => (b.last || '').localeCompare(a.last || ''))
      .filter(p => {  // one line per scheduled task, however many runs
        if (!(p.name || '').startsWith('定时任务')) return true
        if (seenSched.has(p.name)) return false
        seenSched.add(p.name); return true
      })
      .slice(0, limit)
    if (!recent.length) return text(`No activity recorded in the last ${days} days.`)
    const best = new Map()
    for (const n of nodes) {
      if (n.type !== 'I' && n.type !== 'K') continue
      const cur = best.get(n.project_id)
      if (!cur || (n.type === 'K' && cur.type !== 'K') || (n.type === cur.type && n.ts > cur.ts)) best.set(n.project_id, n)
    }
    const lines = recent.map(p => {
      const b = best.get(p.id)
      const c = p.counts
      return `- ${fmtDate(p.last)} · ${index.projectLabel(p)} (${p.id}; D${c.D} I${c.I} K${c.K} W${c.W})` + (b ? `\n  ${snippet(b.content, [], 220)}` : '')
    })
    return text(`Activity in the last ${days} days:\n${lines.join('\n')}`)
  })

  server.registerTool('list_projects', {
    title: 'List projects',
    description: 'Without arguments: the user\'s Claude Projects (same as in the Claude app) with how many sessions from each tool are filed under them. With query, or view="sessions": individual sessions newest first. Pass a Project name or session id to get_project_context.',
    inputSchema: {
      query: z.string().optional().describe('Filter by Claude Project name, session title or workspace folder'),
      view: z.enum(['claude_projects', 'sessions']).optional().describe('Default: claude_projects when no query, else sessions'),
      platform: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional().describe('Default 30')
    },
    annotations: { readOnlyHint: true }
  }, async ({ query, view, platform, limit = 30 }) => {
    const { projects, spaces } = index.load()
    const nonEmpty = p => p.counts.D + p.counts.I + p.counts.K + p.counts.W > 0
    if ((view || (query ? 'sessions' : 'claude_projects')) === 'claude_projects') {
      const rows = new Map([...spaces.values()].map(sp => [sp.id, { sp, n: 0, by: {}, last: '' }]))
      let unfiled = 0
      for (const p of projects.values()) {
        if (!nonEmpty(p) || (platform && p.platform !== platform)) continue
        const r = rows.get(p.space_id)
        if (!r) { unfiled++; continue }
        r.n++; r.by[p.platform || 'other'] = (r.by[p.platform || 'other'] || 0) + 1
        if ((p.last || '') > r.last) r.last = p.last
      }
      const list = [...rows.values()].sort((a, b) => (b.last || '').localeCompare(a.last || ''))
      const lines = list.map(r => `- ${r.sp.name} · ${r.n} sessions${r.n ? ` (${Object.entries(r.by).map(([k, v]) => `${k} ${v}`).join(', ')}) · last ${fmtDate(r.last)}` : ''}`)
      return text(`${list.length} Claude Projects:\n${lines.join('\n')}\n(${unfiled} sessions not filed under any Project; list_projects with view="sessions" to see them)`)
    }
    let list = query ? index.resolveProjects(query) : [...projects.values()]
    if (platform) list = list.filter(p => p.platform === platform)
    list = list.filter(nonEmpty).sort((a, b) => (b.last || '').localeCompare(a.last || ''))
    const total = list.length
    const lines = list.slice(0, limit).map(p => `- ${p.id} · ${fmtDate(p.last)} · ${index.projectLabel(p)} · D${p.counts.D} I${p.counts.I} K${p.counts.K} W${p.counts.W}`)
    return text(lines.length ? `${total} sessions${total > limit ? ` (showing ${limit})` : ''}:\n${lines.join('\n')}` : 'No sessions matched.')
  })

  server.registerTool('get_project_context', {
    title: 'Project context',
    description: 'Distilled context for a project: Wisdom, Knowledge and Information (and the latest raw turns if nothing was distilled). Accepts a project id, a name fragment, or a workspace folder name (aggregates all sessions in that folder).',
    inputSchema: {
      project: z.string().describe('Project id, name fragment, or workspace folder (e.g. "empirehacks-2026")'),
      task: z.string().optional().describe('Current task; used to rank the most relevant entries first')
    },
    annotations: { readOnlyHint: true }
  }, async ({ project, task }) => {
    const sps = index.resolveSpaces(project)
    const matches = index.resolveProjects(project).slice(0, sps.length ? 40 : 12)
    if (!matches.length) return text(`No project matched "${project}". Use list_projects or search_memory.`)
    const ids = new Set(matches.map(p => p.id))
    const { nodes } = index.load()
    const taskTerms = task ? queryTerms(task) : []
    const rel = (n) => taskTerms.reduce((s, t) => s + (n.low.includes(t) ? 1 : 0), 0)
    const pick = (type, max, chars) => nodes.filter(n => n.type === type && ids.has(n.project_id))
      .sort((a, b) => (rel(b) - rel(a)) || (b.ts - a.ts)).slice(0, max)
      .map(n => `- (${n.id}, ${fmtDate(n.created_at)}) ${n.content.replace(/\s+/g, ' ').slice(0, chars)}`)
    let out = `# Context: ${sps.length ? sps.map(sp => sp.name).join(', ') + ' (Claude Project)' : project}\nSessions (${matches.length}): ${matches.slice(0, 15).map(p => `${index.projectLabel(p)} [${p.id}]`).join('; ')}${matches.length > 15 ? ' …' : ''}\n`
    const w = pick('W', 6, 500), k = pick('K', 10, 700), i = pick('I', 10, 400)
    if (w.length) out += `\n## Wisdom\n${w.join('\n')}\n`
    if (k.length) out += `\n## Knowledge\n${k.join('\n')}\n`
    if (i.length) out += `\n## Information\n${i.join('\n')}\n`
    if (!w.length && !k.length && !i.length) {
      const d = nodes.filter(n => n.type === 'D' && ids.has(n.project_id)).sort((a, b) => b.ts - a.ts).slice(0, 12).reverse()
        .map(n => `- ${fmtDate(n.created_at)} ${n.content.replace(/\s+/g, ' ').slice(0, 400)}`)
      out += `\n(Nothing distilled yet; latest raw turns)\n${d.join('\n')}\n`
    }
    return text(out)
  })

  server.registerTool('get_node', {
    title: 'Get memory entry',
    description: 'Full text of one memory entry by id, with its project and the entries it is linked to.',
    inputSchema: { id: z.string() },
    annotations: { readOnlyHint: true }
  }, async ({ id }) => {
    const n = store.dbGet('SELECT * FROM nodes WHERE id = ?', [id])
    if (!n) return text(`No entry with id ${id}.`)
    const { projects } = index.load()
    const p = projects.get(n.project_id)
    const links = store.dbAll(
      `SELECT c.label, c.from_node_id AS f, c.to_node_id AS t, n2.type, substr(n2.content, 1, 160) AS s
       FROM connections c JOIN nodes n2 ON n2.id = CASE WHEN c.from_node_id = ? THEN c.to_node_id ELSE c.from_node_id END
       WHERE c.from_node_id = ? OR c.to_node_id = ? LIMIT 15`, [id, id, id])
    let out = `[${n.type} · ${TYPE_NAME[n.type]}] ${n.id}\nProject: ${index.projectLabel(p) || n.project_id} (${n.project_id})\nSource: ${n.source_platform || '-'} · created ${n.created_at}${n.updated_at && n.updated_at !== n.created_at ? ` · updated ${n.updated_at}` : ''}\nTags: ${n.tags || '[]'}\n\n${(n.content || '').slice(0, 20000)}`
    if (links.length) out += `\n\nLinked:\n` + links.map(l => `- ${l.label} ${l.f === id ? '->' : '<-'} [${l.type}] ${l.f === id ? l.t : l.f}: ${l.s.replace(/\s+/g, ' ')}`).join('\n')
    return text(out)
  })

  server.registerTool('record_learning', {
    title: 'Record to memory',
    description: 'Save a durable insight, decision, fact or how-to so every other tool can find it later. Write one self-contained paragraph (what, why, key specifics). Defaults to type K.',
    inputSchema: {
      content: z.string().min(10),
      type: z.enum(['D', 'I', 'K', 'W']).optional().describe('K know-how (default), W principle/judgment, I fact/status, D raw note'),
      project: z.string().optional().describe('Existing project id/name, or a workspace/topic name to file under'),
      tags: z.array(z.string()).optional(),
      source: z.string().optional().describe('Which tool is writing, e.g. claude-ai, cowork, claude-code, codex, wxbot')
    }
  }, async ({ content, type = 'K', project, tags = [], source }) => {
    const now = new Date().toISOString()
    let projectId
    const sps = project ? index.resolveSpaces(project) : []
    const found = project && !sps.length ? index.resolveProjects(project) : []
    if (sps.length) {
      const sp = sps[0]
      projectId = 'notes_space_' + sp.id
      store.dbRun(`INSERT OR IGNORE INTO projects (id, name, color, created_at, updated_at, workspace, platform, space_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [projectId, `Notes · ${sp.name}`, '#8e24aa', now, now, null, 'mcp', sp.id])
    } else if (found.length) projectId = found[0].id
    else {
      const ws = (project || 'general').trim()
      projectId = 'manual_' + ws.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60)
      store.dbRun(`INSERT OR IGNORE INTO projects (id, name, color, created_at, updated_at, workspace, platform)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [projectId, `Notes · ${ws}`, '#8e24aa', now, now, ws, 'mcp'])
    }
    const id = `${type === 'K' ? 'know' : type === 'W' ? 'wisdom' : type === 'I' ? 'info' : 'node'}_${uuidv4()}`
    store.dbRun(`INSERT INTO nodes (id, type, project_id, source_platform, content, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, type, projectId, source || 'mcp', content, JSON.stringify(['recorded', ...tags]), now, now])
    store.dbRun('UPDATE projects SET updated_at = ? WHERE id = ?', [now, projectId])
    store.save()
    store.broadcast({ type: 'node:added', data: { id, type, projectId, content, sourcePlatform: source || 'mcp', tags, createdAt: now } })
    return text(`Saved ${type} ${id} under ${projectId}.`)
  })

  server.registerTool('export_skill', {
    title: 'Export as SKILL.md',
    description: 'Render a Knowledge entry as a SKILL.md document (returned as text, not written anywhere).',
    inputSchema: { id: z.string().describe('Knowledge node id (know_…)') },
    annotations: { readOnlyHint: true }
  }, async ({ id }) => {
    const n = store.dbGet('SELECT * FROM nodes WHERE id = ?', [id])
    if (!n) return text(`No entry with id ${id}.`)
    return text(generateSkillMd({ id: n.id, content: n.content, tags: JSON.parse(n.tags || '[]') }, []))
  })

  return server
}

/** Express handler for POST /<secret>/mcp (stateless Streamable HTTP). */
export function createMcpHandler(store) {
  const index = createMemoryIndex(store)
  const handler = async (req, res) => {
    const server = buildServer(store, index)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => { transport.close(); server.close() })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (e) {
      console.error('MCP error:', e)
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null })
    }
  }
  return { handler, index }
}
