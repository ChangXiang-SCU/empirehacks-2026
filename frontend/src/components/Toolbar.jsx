import React, { useState } from 'react'
import { useGraphStore } from '../stores/graphStore'
import ConnectPanel from './ConnectPanel'
import SharePanel from './SharePanel'
import './Toolbar.css'

export default function Toolbar() {
  const currentTool = useGraphStore((state) => state.currentTool)
  const setCurrentTool = useGraphStore((state) => state.setCurrentTool)
  const [showConnect, setShowConnect] = useState(false)
  const [showShare, setShowShare] = useState(false)

  return (
    <div className="toolbar">
      <div className="tool-group">
        <button
          className={`tool-btn ${currentTool === 'move' ? 'active' : ''}`}
          onClick={() => setCurrentTool('move')}
          title="Move nodes">
          <span className="tool-icon">↕️</span>
          <span className="tool-label">MOVE</span>
        </button>
        <button
          className={`tool-btn ${showConnect ? 'active' : ''}`}
          onClick={() => { setShowConnect(true); setShowShare(false) }}
          title="Manage MCP servers and Skills across platforms">
          <span className="tool-icon">→</span>
          <span className="tool-label">CONNECT</span>
        </button>
        <button
          className={`tool-btn ${showShare ? 'active' : ''}`}
          onClick={() => { setShowShare(true); setShowConnect(false) }}
          title="Manage project rules (CLAUDE.md / AGENTS.md)">
          <span className="tool-icon">⊙</span>
          <span className="tool-label">SHARE</span>
        </button>
      </div>

      <div className="tool-group">
        <button className="tool-btn" title="Auto Layout">
          ⊞
        </button>
        <button className="tool-btn" title="Show All">
          ○
        </button>
      </div>

      {showConnect && <ConnectPanel onClose={() => setShowConnect(false)} />}
      {showShare && <SharePanel onClose={() => setShowShare(false)} />}
    </div>
  )
}
