// Shared text helpers: strip agent boilerplate, derive titles, tokenize for search.

const BLOCK_TAGS = [
  'recommended_plugins', 'environment_context', 'user_instructions', 'INSTRUCTIONS',
  'system-reminder', 'command-name', 'command-message', 'command-args',
  'local-command-stdout', 'local-command-stderr', 'local-command-caveat',
  'permissions', 'app-context', 'collaboration_mode', 'skills_instructions',
  'turn_aborted', 'user_memory_snapshot', 'ide_opened_file', 'ide_selection'
]
const BLOCK_RE = new RegExp(`<(${BLOCK_TAGS.join('|')})[^>]*>[\\s\\S]*?</\\1>`, 'g')

const SKIP_PREFIXES = [
  '<permissions', '<app-context', '<collaboration_mode', '<skills_instructions',
  '<environment_context', '<tool_', '<system', 'You are ', '<?xml', '<turn_aborted',
  '<cwd>', '# AGENTS.md instructions', 'Caveat: The messages below', '[Request interrupted',
  'This session is being continued from a previous conversation'
]

/** Remove injected context blocks; return '' if what remains is boilerplate. */
export function cleanMessage(text) {
  if (!text) return ''
  let t = String(text)
  const sched = t.match(/^\s*<scheduled-task name="([^"]+)"/)
  if (sched) return `定时任务: ${sched[1]}`
  const req = t.indexOf('## My request for Codex:')
  if (req !== -1) t = t.slice(req + '## My request for Codex:'.length)
  t = t.replace(/^# Files (pasted|mentioned) by the user:\s*/, '').replace(/^##\s+"?/, '')
  t = t.replace(BLOCK_RE, '')
  t = t.replace(/<\/?(recommended_plugins|environment_context|system-reminder)[^>]*>/g, '')
  t = t.trim()
  if (SKIP_PREFIXES.some(p => t.startsWith(p))) return ''
  return t
}

/** A short one-line title from the first meaningful user message. */
export function makeTitle(text, max = 60) {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.length > max ? t.slice(0, max) + '…' : t
}

export function workspaceFromCwd(cwd) {
  if (!cwd) return null
  const parts = String(cwd).replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean)
  if (!parts.length) return null
  // Cowork VM paths look like /sessions/<adjective-name>/mnt/<folder>/...
  const mnt = parts.indexOf('mnt')
  if (parts[0] === 'sessions') {
    const f = mnt !== -1 ? parts[mnt + 1] : null
    return f && !['outputs', 'uploads', 'uploads-tmp', '.claude'].includes(f) ? f : null
  }
  const last = parts[parts.length - 1]
  if (/^[A-Za-z]:$/.test(last) || ['Users', 'home', 'root', 'outputs', 'uploads', 'uploads-tmp'].includes(last)) return null
  if (parts.length === 3 && (parts[0] === 'Users' || parts[0] === 'home' || /^[A-Za-z]:$/.test(parts[0]))) return null
  return last
}

const CJK = /[㐀-鿿豈-﫿]/
const CJK_RUN = /[㐀-鿿豈-﫿]+/g

/** Query terms: latin words + CJK runs (short runs whole, long runs as bigrams). */
export function queryTerms(query) {
  const q = (query || '').toLowerCase()
  const terms = new Set()
  q.replace(CJK_RUN, ' ').split(/[^\p{L}\p{N}_.\-+#]+/u).forEach(w => { if (w.length >= 2) terms.add(w) })
  for (const run of q.match(CJK_RUN) || []) {
    if (run.length <= 3) terms.add(run)
    else for (let i = 0; i < run.length - 1; i++) terms.add(run.slice(i, i + 2))
  }
  return [...terms]
}

export function hasCjk(s) { return CJK.test(s || '') }

/** Snippet of `len` chars around the first hit of any term. */
export function snippet(content, terms, len = 260) {
  const text = (content || '').replace(/\s+/g, ' ')
  const low = text.toLowerCase()
  let pos = -1
  for (const t of terms) { const i = low.indexOf(t); if (i !== -1 && (pos === -1 || i < pos)) pos = i }
  if (pos === -1 || text.length <= len) return text.slice(0, len)
  const start = Math.max(0, pos - Math.floor(len / 3))
  return (start > 0 ? '…' : '') + text.slice(start, start + len) + (start + len < text.length ? '…' : '')
}
