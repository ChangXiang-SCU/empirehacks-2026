import React, { useState } from 'react'
import { getLabelByType, getColorByType } from '../utils/dikwColors'
import './NodeCard.css'

const API_BASE = 'http://localhost:3001'

export default function NodeCard({ node, isPreview = false }) {
  const typeLabel = getLabelByType(node.type)
  const typeColor = getColorByType(node.type)
  const [exportStatus, setExportStatus] = useState(null)
  const [isDeploying, setIsDeploying] = useState(false)
  const [deployResult, setDeployResult] = useState(null)

  const canExportSkill = node.type === 'K'
  const canExportClaude = node.type === 'W'

  const handleExportSkill = async (deploy) => {
    try {
      setIsDeploying(true)
      setExportStatus(deploy ? 'Generating skill with AI...' : 'Preparing download...')
      const url = `${API_BASE}/api/export/skill/${node.id}${deploy ? '?deploy=true' : ''}`
      const res = await fetch(url, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      if (deploy) {
        const data = await res.json()
        setDeployResult({ type: 'skill', path: data.path, success: true })
        setExportStatus(null)
      } else {
        const blob = await res.blob()
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `SKILL_${node.id}.md`
        a.click()
        setExportStatus('Downloaded!')
        setTimeout(() => setExportStatus(null), 2000)
      }
    } catch (e) {
      setExportStatus('Export failed: ' + e.message)
      setTimeout(() => setExportStatus(null), 4000)
    } finally {
      setIsDeploying(false)
    }
  }

  const handleExportClaude = async (deploy) => {
    try {
      setIsDeploying(true)
      setExportStatus(deploy ? 'Generating rules with AI...' : 'Preparing download...')
      const url = `${API_BASE}/api/export/claude/${node.projectId}${deploy ? '?deploy=true' : ''}`
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      if (!res.ok) throw new Error(await res.text())
      if (deploy) {
        const data = await res.json()
        setDeployResult({ type: 'rules', path: data.path, success: true })
        setExportStatus(null)
      } else {
        const blob = await res.blob()
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `CLAUDE_${node.projectId}.md`
        a.click()
        setExportStatus('Downloaded!')
        setTimeout(() => setExportStatus(null), 2000)
      }
    } catch (e) {
      setExportStatus('Export failed: ' + e.message)
      setTimeout(() => setExportStatus(null), 4000)
    } finally {
      setIsDeploying(false)
    }
  }

  const copyPath = (p) => {
    navigator.clipboard.writeText(p)
    setExportStatus('Path copied!')
    setTimeout(() => setExportStatus(null), 1500)
  }

  return (
    <div className={`node-card ${isPreview ? 'preview' : ''}`}>
      <div className="node-header" style={{ borderLeftColor: typeColor }}>
        <div className="node-type-badge dikw-badge" style={{ backgroundColor: `${typeColor}22`, color: typeColor }}>
          {typeLabel}
        </div>
        {node.projectBadge && <div className="project-badge">{node.projectBadge}</div>}
        {node.dtype && <div className="dtype-badge">{node.dtype}</div>}
        {canExportSkill && (
          <div className="export-buttons">
            <button className="export-btn deploy" disabled={isDeploying}
              onClick={(e) => { e.stopPropagation(); handleExportSkill(true) }}
              title="Deploy as SKILL.md to Claude Code">
              {isDeploying ? '...' : 'Deploy Skill'}
            </button>
            <button className="export-btn download" disabled={isDeploying}
              onClick={(e) => { e.stopPropagation(); handleExportSkill(false) }}
              title="Download SKILL.md">DL</button>
          </div>
        )}
        {canExportClaude && (
          <div className="export-buttons">
            <button className="export-btn deploy" disabled={isDeploying}
              onClick={(e) => { e.stopPropagation(); handleExportClaude(true) }}
              title="Deploy as CLAUDE.md rules">
              {isDeploying ? '...' : 'Deploy Rules'}
            </button>
            <button className="export-btn download" disabled={isDeploying}
              onClick={(e) => { e.stopPropagation(); handleExportClaude(false) }}
              title="Download CLAUDE.md">DL</button>
          </div>
        )}
      </div>
      <div className="node-body">
        <p className="node-content">{node.content}</p>
        {node.tags && node.tags.length > 0 && (
          <div className="node-tags">
            {node.tags.map((tag, i) => <span key={i} className="tag">{tag}</span>)}
          </div>
        )}
        {exportStatus && (
          <div className={`export-status ${exportStatus.includes('failed') ? 'error' : 'info'}`}>
            {isDeploying && <span className="spinner"></span>}
            {exportStatus}
          </div>
        )}
        {deployResult && deployResult.success && (
          <div className="deploy-result">
            <span className="deploy-success-icon">✓</span>
            <span>Deployed as {deployResult.type === 'skill' ? 'SKILL.md' : 'CLAUDE.md'}</span>
            <button className="copy-path-btn" onClick={(e) => { e.stopPropagation(); copyPath(deployResult.path) }}
              title={deployResult.path}>Copy Path</button>
            <button className="dismiss-btn" onClick={(e) => { e.stopPropagation(); setDeployResult(null) }}>×</button>
          </div>
        )}
      </div>
      <div className="node-footer">
        <small>{new Date(node.createdAt).toLocaleDateString()}</small>
      </div>
    </div>
  )
}
