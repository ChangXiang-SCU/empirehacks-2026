import React from 'react'
import { useGraphStore } from '../stores/graphStore'
import './Sidebar.css'

export default function Sidebar() {
  const projects = useGraphStore((state) => state.projects)
  const mcpSources = useGraphStore((state) => state.mcpSources)
  const activeProjects = useGraphStore((state) => state.activeProjects)
  const activeDIKW = useGraphStore((state) => state.activeDIKW)
  const nodes = useGraphStore((state) => state.nodes)
  const connections = useGraphStore((state) => state.connections)

  const toggleProject = useGraphStore((state) => state.toggleActiveProject)
  const toggleDIKW = useGraphStore((state) => state.toggleActiveDIKW)
  const setShowImportWizard = useGraphStore((state) => state.setShowImportWizard)
  const setShowInbox = useGraphStore((state) => state.setShowInbox)

  const dikwTypes = [
    { type: 'D', label: 'Data', color: '#3949ab' },
    { type: 'I', label: 'Information', color: '#00897b' },
    { type: 'K', label: 'Knowledge', color: '#f57c00' },
    { type: 'W', label: 'Wisdom', color: '#e53935' }
  ]

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">Mnemosyne</h1>
      </div>

      <div className="sidebar-section">
        <div className="section-title">Projects</div>
        <div className="project-list">
          {projects.length === 0 ? (
            <p className="empty-state">No projects yet</p>
          ) : (
            projects.map(project => (
              <label key={project.id} className="project-item">
                <input
                  type="checkbox"
                  checked={activeProjects.has(project.id)}
                  onChange={() => toggleProject(project.id)}
                />
                <span className="project-color" style={{ backgroundColor: project.color }}></span>
                <span className="project-name">{project.name}</span>
              </label>
            ))
          )}
        </div>
      </div>

      <div className="sidebar-section">
        <div className="section-title">DIKW Layers</div>
        <div className="dikw-toggles">
          {dikwTypes.map(item => (
            <label key={item.type} className="dikw-toggle">
              <input
                type="checkbox"
                checked={activeDIKW.has(item.type)}
                onChange={() => toggleDIKW(item.type)}
              />
              <span className="dikw-dot" style={{ backgroundColor: item.color }}></span>
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="sidebar-section">
        <div className="section-title">MCP Sources</div>
        <div className="mcp-list">
          {mcpSources.length === 0 ? (
            <p className="empty-state">No MCP sources</p>
          ) : (
            mcpSources.map(source => (
              <div key={source.id} className="mcp-item">
                <div className={`mcp-status ${source.status}`}></div>
                <div className="mcp-info">
                  <div className="mcp-name">{source.name}</div>
                  <div className="mcp-count">{source.dataCount} nodes</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="sidebar-actions">
        <button className="action-btn primary" onClick={() => setShowImportWizard(true)}>
          + Import
        </button>
        <button className="action-btn secondary" onClick={() => setShowInbox(true)}>
          Inbox
        </button>
      </div>

      <div className="sidebar-footer">
        <div className="stats">
          <div className="stat-item">
            <span className="stat-label">Nodes</span>
            <span className="stat-value">{nodes.length}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Connections</span>
            <span className="stat-value">{connections.length}</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
