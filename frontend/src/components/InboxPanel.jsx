import React from 'react'
import { useGraphStore } from '../stores/graphStore'
import NodeCard from './NodeCard'
import './InboxPanel.css'

export default function InboxPanel() {
  const showInbox = useGraphStore((state) => state.showInbox)
  const inbox = useGraphStore((state) => state.inbox)
  const setShowInbox = useGraphStore((state) => state.setShowInbox)
  const classifySession = useGraphStore((state) => state.classifySession)
  const projects = useGraphStore((state) => state.projects)

  if (!showInbox) return null

  return (
    <div className="inbox-panel">
      <div className="inbox-header">
        <h2>Unclassified Sessions</h2>
        <button className="close-btn" onClick={() => setShowInbox(false)}>×</button>
      </div>

      <div className="inbox-content">
        {inbox.length === 0 ? (
          <div className="inbox-empty">
            <p>No unclassified sessions</p>
          </div>
        ) : (
          <div className="inbox-list">
            {inbox.map(session => (
              <div key={session.id} className="inbox-item">
                <NodeCard node={session} isPreview={false} />
                <div className="inbox-actions">
                  <select
                    className="classify-select"
                    onChange={(e) => {
                      if (e.target.value) {
                        classifySession(session.id, e.target.value)
                      }
                    }}
                  >
                    <option value="">Classify to...</option>
                    {projects.map(proj => (
                      <option key={proj.id} value={proj.id}>
                        {proj.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}