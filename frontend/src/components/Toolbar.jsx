import React from 'react'
import { useGraphStore } from '../stores/graphStore'
import './Toolbar.css'

export default function Toolbar() {
  const currentTool = useGraphStore((state) => state.currentTool)
  const setCurrentTool = useGraphStore((state) => state.setCurrentTool)

  const tools = [
    { id: 'move', label: 'Move', icon: '↕️' },
    { id: 'connect', label: 'Connect', icon: '→' },
    { id: 'share', label: 'Share', icon: '⊙' }
  ]

  return (
    <div className="toolbar">
      <div className="tool-group">
        {tools.map(tool => (
          <button
            key={tool.id}
            className={`tool-btn ${currentTool === tool.id ? 'active' : ''}`}
            onClick={() => setCurrentTool(tool.id)}
            title={tool.label}
          >
            <span className="tool-icon">{tool.icon}</span>
            <span className="tool-label">{tool.label}</span>
          </button>
        ))}
      </div>

      <div className="tool-group">
        <button className="tool-btn" title="Auto Layout">
          ⊞
        </button>
        <button className="tool-btn" title="Show All">
          ○
        </button>
      </div>
    </div>
  )
}