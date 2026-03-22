import React, { useState, useEffect, useCallback } from 'react'
import './SharePanel.css'

const API_BASE = 'http://localhost:3001'

export default function SharePanel({ onClose }) {
  const [rules, setRules] = useState([])
  const [grouped, setGrouped] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [viewContent, setViewContent] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)

  const fetchRules = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/platform/rules`)
      if (res.ok) {
        const d = await res.json()
        setRules(d.rules || [])
        setGrouped(d.grouped || [])
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchRules() }, [fetchRules])
  useEffect(() => {
    const h = () => setContextMenu(null)
    window.addEventListener('click', h)
    return () => window.removeEventListener('click', h)
  }, [])

  const viewRule = async (rule) => {
    try {
      const res = await fetch(`${API_BASE}/api/platform/rules/${rule.platform}/${rule.id}/content`)
      if (res.ok) { const d = await res.json(); setViewContent({ ...rule, fullContent: d.content }) }
    } catch (e) { console.error(e) }
  }

  const removeRule = async (rule) => {
    try {
      await fetch(`${API_BASE}/api/platform/rules/${rule.platform}/${rule.id}`, { method: 'DELETE' })
      await fetchRules()
      if (viewContent?.id === rule.id && viewContent?.platform === rule.platform) setViewContent(null)
    } catch (e) { console.error(e) }
  }

  const toggleSelect = (key, e) => {
    const next = new Set(selected)
    if (e?.ctrlKey || e?.metaKey) { next.has(key) ? next.delete(key) : next.add(key) }
    else { next.clear(); next.add(key) }
    setSelected(next)
  }

  const handleContextMenu = (e, rule) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, rule })
  }

  const batchRemove = async () => {
    if (!window.confirm(`Remove ${selected.size} selected rules?`)) return
    for (const key of selected) {
      const [platform, id] = key.split(':')
      const rule = rules.find(r => r.platform === platform && r.id === id)
      if (rule) await removeRule(rule)
    }
    setSelected(new Set())
  }

  const claudeRules = rules.filter(r => r.platform === 'claude-code')
  const codexRules = rules.filter(r => r.platform === 'codex')

  const renderRule = (rule) => {
    const key = `${rule.platform}:${rule.id}`
    const isSelected = selected.has(key)
    // Check if this project exists on the other platform
    const otherPlatform = rule.platform === 'claude-code' ? 'codex' : 'claude-code'
    const hasOther = rules.some(r => r.id === rule.id && r.platform === otherPlatform)

    return (
      <div key={key}
        className={`sp-card ${isSelected ? 'selected' : ''} ${hasOther ? 'synced' : ''}`}
        onClick={(e) => toggleSelect(key, e)}
        onDoubleClick={() => viewRule(rule)}
        onContextMenu={(e) => handleContextMenu(e, rule)}
      >
        <div className="sp-card-name" title={rule.name}>{rule.name}</div>
        <div className="sp-card-meta">
          {rule.type} · {Math.round(rule.size / 1024)}KB · {new Date(rule.updatedAt).toLocaleDateString()}
        </div>
        {hasOther && <div className="sp-synced-dot" title="Has counterpart on other platform" />}
      </div>
    )
  }

  if (viewContent) {
    return (
      <div className="sp-overlay" onClick={onClose}>
        <div className="sp-panel" onClick={e => e.stopPropagation()}>
          <div className="sp-viewer-header">
            <button className="sp-back" onClick={() => setViewContent(null)}>← Back</button>
            <span className="sp-viewer-title">
              {viewContent.platform === 'claude-code' ? '🟣' : '🟢'} {viewContent.type} — {viewContent.name}
            </span>
            <button className="sp-close" onClick={onClose}>×</button>
          </div>
          <pre className="sp-viewer-body">{viewContent.fullContent}</pre>
          <div className="sp-viewer-footer">
            <button onClick={() => navigator.clipboard.writeText(viewContent.path)}>Copy Path</button>
            <button onClick={() => navigator.clipboard.writeText(viewContent.fullContent)}>Copy Content</button>
            <button className="danger" onClick={() => { removeRule(viewContent); setViewContent(null) }}>Delete</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="sp-overlay" onClick={onClose}>
      <div className="sp-panel wide" onClick={e => e.stopPropagation()}>
        <div className="sp-header">
          <h2>Project Rules</h2>
          <span className="sp-subtitle">CLAUDE.md ↔ AGENTS.md</span>
          <button className="sp-close" onClick={onClose}>×</button>
        </div>

        {selected.size > 0 && (
          <div className="sp-toolbar">
            <span>{selected.size} selected</span>
            <button className="danger" onClick={batchRemove}>Delete</button>
            <button onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}

        <div className="sp-dual">
          {/* Left: Claude Code — CLAUDE.md */}
          <div className="sp-pane">
            <div className="sp-pane-header">
              <span className="sp-pane-icon">🟣</span>
              <span>CLAUDE.md</span>
              <span className="sp-pane-sub">Claude Code</span>
              <span className="sp-pane-count">{claudeRules.length}</span>
            </div>
            <div className="sp-pane-body">
              {loading && <div className="sp-empty">Loading...</div>}
              {!loading && claudeRules.length === 0 && <div className="sp-empty">No CLAUDE.md rules</div>}
              {claudeRules.map(r => renderRule(r))}
            </div>
          </div>

          <div className="sp-center">
            <div className="sp-center-icon">⇄</div>
          </div>

          {/* Right: Codex — AGENTS.md */}
          <div className="sp-pane">
            <div className="sp-pane-header">
              <span className="sp-pane-icon">🟢</span>
              <span>AGENTS.md</span>
              <span className="sp-pane-sub">Codex</span>
              <span className="sp-pane-count">{codexRules.length}</span>
            </div>
            <div className="sp-pane-body">
              {loading && <div className="sp-empty">Loading...</div>}
              {!loading && codexRules.length === 0 && <div className="sp-empty">No AGENTS.md rules</div>}
              {codexRules.map(r => renderRule(r))}
            </div>
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div className="sp-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}>
          <div className="ctx-item" onClick={() => { viewRule(contextMenu.rule); setContextMenu(null) }}>
            View Content
          </div>
          <div className="ctx-item" onClick={() => { navigator.clipboard.writeText(contextMenu.rule.path); setContextMenu(null) }}>
            Copy Path
          </div>
          <div className="ctx-divider" />
          <div className="ctx-item danger" onClick={() => {
            if (window.confirm(`Remove ${contextMenu.rule.type} for "${contextMenu.rule.name}"?`)) {
              removeRule(contextMenu.rule); setContextMenu(null)
            }
          }}>
            Delete
          </div>
        </div>
      )}
    </div>
  )
}
