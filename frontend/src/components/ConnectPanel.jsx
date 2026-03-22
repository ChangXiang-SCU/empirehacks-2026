import React, { useState, useEffect, useCallback, useRef } from 'react'
import './ConnectPanel.css'

const API_BASE = 'http://localhost:3001'

export default function ConnectPanel({ onClose }) {
  const [tab, setTab] = useState('skills') // 'mcps' | 'skills'
  const [mcps, setMcps] = useState([])
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [dragItem, setDragItem] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [viewContent, setViewContent] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [mcpRes, skillRes] = await Promise.all([
        fetch(`${API_BASE}/api/platform/mcps`),
        fetch(`${API_BASE}/api/platform/skills`)
      ])
      if (mcpRes.ok) setMcps((await mcpRes.json()).mcps || [])
      if (skillRes.ok) setSkills((await skillRes.json()).skills || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])
  const contextMenuRef = useRef(null)
  useEffect(() => {
    const handler = (e) => {
      // Don't close if clicking inside the context menu itself
      if (contextMenuRef.current && contextMenuRef.current.contains(e.target)) return
      setContextMenu(null)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [])

  // --- Actions ---
  const syncSkill = async (id, fromPlatform) => {
    setSyncing(true)
    try {
      await fetch(`${API_BASE}/api/platform/skills/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, fromPlatform })
      })
      await fetchAll()
    } catch (e) { console.error(e) }
    finally { setSyncing(false); setSelected(new Set()) }
  }

  const removeSkill = async (platform, id) => {
    try {
      await fetch(`${API_BASE}/api/platform/skills/${platform}/${id}`, { method: 'DELETE' })
      await fetchAll()
    } catch (e) { console.error(e) }
  }

  const syncMcp = async (name, fromPlatform) => {
    setSyncing(true)
    try {
      await fetch(`${API_BASE}/api/platform/mcps/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, fromPlatform })
      })
      await fetchAll()
    } catch (e) { console.error(e) }
    finally { setSyncing(false) }
  }

  const viewSkill = async (platform, id, name) => {
    try {
      const res = await fetch(`${API_BASE}/api/platform/skills/${platform}/${id}/content`)
      if (res.ok) { const d = await res.json(); setViewContent({ platform, id, name, content: d.content, path: d.path }) }
    } catch (e) { console.error(e) }
  }

  const batchSync = async (fromPlatform) => {
    setSyncing(true)
    const items = [...selected].filter(key => key.startsWith(fromPlatform + ':'))
    for (const key of items) {
      const id = key.split(':')[1]
      await syncSkill(id, fromPlatform)
    }
    setSyncing(false)
    setSelected(new Set())
  }

  const batchRemove = async () => {
    if (!window.confirm(`Remove ${selected.size} selected items?`)) return
    for (const key of selected) {
      const [platform, id] = key.split(':')
      await removeSkill(platform, id)
    }
    setSelected(new Set())
    await fetchAll()
  }

  // --- Selection ---
  const toggleSelect = (key, e) => {
    const next = new Set(selected)
    if (e?.ctrlKey || e?.metaKey) {
      next.has(key) ? next.delete(key) : next.add(key)
    } else {
      next.clear(); next.add(key)
    }
    setSelected(next)
  }

  // --- Drag & Drop ---
  const handleDragStart = (e, item) => {
    setDragItem(item)
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('text/plain', item.id)
  }

  const handleDragOver = (e, platform) => {
    e.preventDefault()
    if (dragItem && dragItem.platform !== platform) {
      setDropTarget(platform)
      e.dataTransfer.dropEffect = 'copy'
    }
  }
  const handleDragLeave = () => setDropTarget(null)
  const handleDrop = async (e, targetPlatform) => {
    e.preventDefault()
    setDropTarget(null)
    if (!dragItem || dragItem.platform === targetPlatform) return
    if (tab === 'skills') {
      await syncSkill(dragItem.id, dragItem.platform)
    }
    setDragItem(null)
  }
  const handleDragEnd = () => { setDragItem(null); setDropTarget(null) }

  // --- Context Menu ---
  const handleContextMenu = (e, item) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, item })
  }

  // --- Data for panes ---
  const claudeItems = tab === 'skills'
    ? skills.filter(s => s.platform === 'claude-code')
    : mcps.filter(m => m.platform === 'claude-code')
  const codexItems = tab === 'skills'
    ? skills.filter(s => s.platform === 'codex')
    : mcps.filter(m => m.platform === 'codex')

  const renderItem = (item, platform) => {
    const key = `${platform}:${item.id}`
    const isSelected = selected.has(key)
    const isDragging = dragItem?.id === item.id && dragItem?.platform === platform
    const isSkill = tab === 'skills'
    return (
      <div key={key}
        className={`cp-card ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${item.shared ? 'shared' : ''}`}
        draggable={isSkill}
        onClick={(e) => toggleSelect(key, e)}
        onDragStart={(e) => handleDragStart(e, { ...item, platform })}
        onDragEnd={handleDragEnd}
        onContextMenu={(e) => handleContextMenu(e, { ...item, platform })}
        onDoubleClick={() => isSkill && viewSkill(platform, item.id, item.name)}
      >
        <div className="cp-card-name" title={item.name}>{item.name}</div>
        <div className="cp-card-meta">
          {isSkill ? (
            <>{Math.round(item.size / 1024)}KB · {new Date(item.updatedAt).toLocaleDateString()}</>
          ) : (
            <>{item.url ? item.url : `${item.command} ${(item.args || []).slice(0,2).join(' ')}...`}</>
          )}
        </div>
        {item.shared && <div className="cp-shared-dot" title="Exists on both platforms" />}
        {item.isMnemosyne && <span className="cp-mnemosyne-tag">M</span>}
      </div>
    )
  }

  // --- Content Viewer ---
  if (viewContent) {
    return (
      <div className="cp-overlay" onClick={onClose}>
        <div className="cp-panel" onClick={e => e.stopPropagation()}>
          <div className="cp-viewer-header">
            <button className="cp-back" onClick={() => setViewContent(null)}>← Back</button>
            <span className="cp-viewer-title">{viewContent.name}</span>
            <button className="cp-close" onClick={onClose}>×</button>
          </div>
          <pre className="cp-viewer-body">{viewContent.content}</pre>
          <div className="cp-viewer-footer">
            <button onClick={() => navigator.clipboard.writeText(viewContent.path)}>Copy Path</button>
            <button onClick={() => navigator.clipboard.writeText(viewContent.content)}>Copy Content</button>
          </div>
        </div>
      </div>
    )
  }

  // --- Main Panel ---
  return (
    <div className="cp-overlay" onClick={onClose}>
      <div className="cp-panel wide" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="cp-header">
          <h2>Platform Hub</h2>
          <div className="cp-tabs">
            <button className={tab === 'skills' ? 'active' : ''} onClick={() => { setTab('skills'); setSelected(new Set()) }}>Skills</button>
            <button className={tab === 'mcps' ? 'active' : ''} onClick={() => { setTab('mcps'); setSelected(new Set()) }}>MCP Servers</button>
          </div>
          <button className="cp-close" onClick={onClose}>×</button>
        </div>

        {/* Toolbar */}
        {selected.size > 0 && tab === 'skills' && (
          <div className="cp-toolbar">
            <span>{selected.size} selected</span>
            <button disabled={syncing} onClick={() => batchSync('claude-code')}>
              {syncing ? 'Syncing...' : 'Sync selected → Codex'}
            </button>
            <button disabled={syncing} onClick={() => batchSync('codex')}>
              {syncing ? 'Syncing...' : 'Sync selected → Claude'}
            </button>
            <button className="danger" onClick={batchRemove}>Delete</button>
            <button onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}

        {/* Dual Pane */}
        <div className="cp-dual">
          {/* Left: Claude Code */}
          <div className={`cp-pane ${dropTarget === 'claude-code' ? 'drop-active' : ''}`}
            onDragOver={(e) => handleDragOver(e, 'claude-code')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, 'claude-code')}
          >
            <div className="cp-pane-header">
              <span className="cp-pane-icon">🟣</span>
              <span>Claude Code</span>
              <span className="cp-pane-count">{claudeItems.length}</span>
            </div>
            <div className="cp-pane-body">
              {loading && <div className="cp-empty">Loading...</div>}
              {!loading && claudeItems.length === 0 && <div className="cp-empty">No {tab} here</div>}
              {claudeItems.map(item => renderItem(item, 'claude-code'))}
            </div>
            {tab === 'skills' && <div className="cp-pane-hint">Drag skills here to sync from Codex</div>}
          </div>

          {/* Center: Sync arrow */}
          <div className="cp-center-arrow">
            <div className="cp-arrow">⇄</div>
            <div className="cp-arrow-label">Drag to sync</div>
          </div>

          {/* Right: Codex */}
          <div className={`cp-pane ${dropTarget === 'codex' ? 'drop-active' : ''}`}
            onDragOver={(e) => handleDragOver(e, 'codex')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, 'codex')}
          >
            <div className="cp-pane-header">
              <span className="cp-pane-icon">🟢</span>
              <span>Codex</span>
              <span className="cp-pane-count">{codexItems.length}</span>
            </div>
            <div className="cp-pane-body">
              {loading && <div className="cp-empty">Loading...</div>}
              {!loading && codexItems.length === 0 && <div className="cp-empty">No {tab} here</div>}
              {codexItems.map(item => renderItem(item, 'codex'))}
            </div>
            {tab === 'skills' && <div className="cp-pane-hint">Drag skills here to sync from Claude</div>}
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div className="cp-context-menu" ref={contextMenuRef} style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}>
          {tab === 'skills' && (
            <>
              <div className="ctx-item" onMouseUp={() => { viewSkill(contextMenu.item.platform, contextMenu.item.id, contextMenu.item.name); setContextMenu(null) }}>
                View Content
              </div>
              <div className="ctx-item" onMouseUp={() => { syncSkill(contextMenu.item.id, contextMenu.item.platform); setContextMenu(null) }}>
                Sync → {contextMenu.item.platform === 'claude-code' ? 'Codex' : 'Claude Code'}
              </div>
              <div className="ctx-item" onMouseUp={() => { navigator.clipboard.writeText(contextMenu.item.path); setContextMenu(null) }}>
                Copy Path
              </div>
              <div className="ctx-divider" />
              <div className="ctx-item danger" onMouseUp={() => { removeSkill(contextMenu.item.platform, contextMenu.item.id); setContextMenu(null) }}>
                Delete
              </div>
            </>
          )}
          {tab === 'mcps' && (
            <>
              <div className="ctx-item" onMouseUp={() => { syncMcp(contextMenu.item.name, contextMenu.item.platform); setContextMenu(null) }}>
                Sync → {contextMenu.item.platform === 'claude-code' ? 'Codex' : 'Claude Code'}
              </div>
              <div className="ctx-item" onMouseUp={() => { navigator.clipboard.writeText(contextMenu.item.name); setContextMenu(null) }}>
                Copy Name
              </div>
              <div className="ctx-item" onMouseUp={() => { navigator.clipboard.writeText(contextMenu.item.url || `${contextMenu.item.command} ${(contextMenu.item.args||[]).join(' ')}`); setContextMenu(null) }}>
                Copy Config
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
