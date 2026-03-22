import React, { useState, useEffect, useCallback } from 'react'
import './DeployedPanel.css'

const API_BASE = 'http://localhost:3001'

export default function DeployedPanel() {
  const [deployments, setDeployments] = useState([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [viewingContent, setViewingContent] = useState(null)

  const fetchDeployments = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_BASE}/api/deployments`)
      if (res.ok) {
        const data = await res.json()
        setDeployments(data.deployments || [])
      }
    } catch (e) {
      console.error('Failed to load deployments:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchDeployments() }, [fetchDeployments])

  // Refresh every 15s to pick up new deployments
  useEffect(() => {
    const timer = setInterval(fetchDeployments, 15000)
    return () => clearInterval(timer)
  }, [fetchDeployments])

  const viewContent = async (dep) => {
    try {
      const res = await fetch(`${API_BASE}/api/deployments/${dep.type}/${dep.id}/content`)
      if (res.ok) {
        const data = await res.json()
        setViewingContent({ ...dep, fullContent: data.content })
      }
    } catch (e) {
      console.error('Failed to load content:', e)
    }
  }

  const removeDeploy = async (dep) => {
    if (!window.confirm(`Remove deployed ${dep.type}: ${dep.name}?`)) return
    try {
      const res = await fetch(`${API_BASE}/api/deployments/${dep.type}/${dep.id}`, { method: 'DELETE' })
      if (res.ok) {
        setDeployments(prev => prev.filter(d => d.id !== dep.id || d.type !== dep.type))
        if (viewingContent?.id === dep.id) setViewingContent(null)
      }
    } catch (e) { console.error('Failed to remove:', e) }
  }

  const copyPath = (p) => {
    navigator.clipboard.writeText(p)
  }

  const typeIcons = { skill: '🧠', rules: '📋', agents: '🤖' }
  const typeLabels = { skill: 'Skill', rules: 'Rules', agents: 'Agents' }

  if (viewingContent) {
    return (
      <div className="deployed-panel">
        <div className="deployed-header">
          <button className="back-btn" onClick={() => setViewingContent(null)}>← Back</button>
          <span className="deployed-title">{typeIcons[viewingContent.type]} {viewingContent.name}</span>
        </div>
        <div className="deployed-content-view">
          <pre className="content-preview-full">{viewingContent.fullContent}</pre>
        </div>
        <div className="deployed-actions-bar">
          <button className="action-small" onClick={() => copyPath(viewingContent.path)}>Copy Path</button>
          <button className="action-small danger" onClick={() => removeDeploy(viewingContent)}>Remove</button>
        </div>
      </div>
    )
  }

  return (
    <div className="deployed-panel">
      <div className="deployed-header" onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
        <span className="deployed-title">Deployed Items ({deployments.length})</span>
        <span className="expand-icon">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="deployed-list">
          {loading && deployments.length === 0 && <p className="empty-state">Loading...</p>}
          {!loading && deployments.length === 0 && <p className="empty-state">No deployments yet</p>}
          {deployments.map((dep) => (
            <div key={`${dep.type}-${dep.id}`} className="deployed-item">
              <div className="deployed-item-header">
                <span className="deployed-icon">{typeIcons[dep.type]}</span>
                <span className="deployed-name" title={dep.path}>{dep.name}</span>
                <span className="deployed-type-badge">{typeLabels[dep.type]}</span>
              </div>
              <div className="deployed-item-meta">
                <small>{new Date(dep.updatedAt).toLocaleDateString()}</small>
                <small>{Math.round(dep.size / 1024)}KB</small>
              </div>
              <div className="deployed-item-actions">
                <button className="action-small" onClick={() => viewContent(dep)}>View</button>
                <button className="action-small" onClick={() => copyPath(dep.path)}>Path</button>
                <button className="action-small danger" onClick={() => removeDeploy(dep)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
