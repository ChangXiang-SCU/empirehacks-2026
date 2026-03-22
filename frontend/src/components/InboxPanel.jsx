import React, { useState, useEffect } from 'react'
import { useGraphStore } from '../stores/graphStore'
import './InboxPanel.css'

const API_BASE = 'http://localhost:3001'

export default function InboxPanel() {
  const showInbox = useGraphStore((state) => state.showInbox)
  const setShowInbox = useGraphStore((state) => state.setShowInbox)
  const projects = useGraphStore((state) => state.projects)

  const [sessions, setSessions] = useState([])
  const [totalUnclassified, setTotalUnclassified] = useState(0)
  const [loading, setLoading] = useState(false)
  const [classifyStatus, setClassifyStatus] = useState({})
  const [activeTab, setActiveTab] = useState('inbox')
  const [recommendations, setRecommendations] = useState([])
  const [selectedProject, setSelectedProject] = useState('')

  useEffect(() => {
    if (showInbox) fetchInbox()
  }, [showInbox])

  const fetchInbox = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/inbox`)
      const data = await res.json()
      setSessions(data.sessions || [])
      setTotalUnclassified(data.totalUnclassified || 0)
    } catch (e) {
      console.error('Fetch inbox failed:', e)
    }
  }

  const handleAutoClassify = async (sessionId, nodeIds) => {
    setClassifyStatus(prev => ({ ...prev, [sessionId]: 'classifying...' }))
    try {
      const res = await fetch(`${API_BASE}/api/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeIds })
      })
      const data = await res.json()
      if (data.classified > 0) {
        setClassifyStatus(prev => ({ ...prev, [sessionId]: `Classified to ${data.projectName || data.projectId} (${Math.round((data.confidence || 0) * 100)}%)` }))
        setTimeout(() => {
          fetchInbox()
          setClassifyStatus(prev => { const n = { ...prev }; delete n[sessionId]; return n })
        }, 3000)
      } else {
        setClassifyStatus(prev => ({ ...prev, [sessionId]: data.error || 'No classification' }))
      }
    } catch (e) {
      setClassifyStatus(prev => ({ ...prev, [sessionId]: 'Failed: ' + e.message }))
    }
  }

  const handleManualClassify = async (sessionId, nodeIds, projectId) => {
    if (!projectId) return
    setClassifyStatus(prev => ({ ...prev, [sessionId]: 'moving...' }))
    try {
      await fetch(`${API_BASE}/api/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeIds, projectId })
      })
      setClassifyStatus(prev => ({ ...prev, [sessionId]: 'Done!' }))
      setTimeout(() => {
        fetchInbox()
        setClassifyStatus(prev => { const n = { ...prev }; delete n[sessionId]; return n })
      }, 1500)
    } catch (e) {
      setClassifyStatus(prev => ({ ...prev, [sessionId]: 'Failed' }))
    }
  }

  const fetchRecommendations = async (projectId) => {
    if (!projectId) { setRecommendations([]); return }
    setSelectedProject(projectId)
    try {
      const res = await fetch(`${API_BASE}/api/recommendations/${projectId}?limit=10`)
      const data = await res.json()
      setRecommendations(data)
    } catch (e) {
      console.error('Fetch recommendations failed:', e)
    }
  }

  if (!showInbox) return null

  return (
    <div className="inbox-panel-overlay">
      <div className="inbox-panel">
        <div className="inbox-header">
          <div className="inbox-tabs">
            <button className={`tab ${activeTab === 'inbox' ? 'active' : ''}`} onClick={() => setActiveTab('inbox')}>
              Inbox {totalUnclassified > 0 && <span className="badge">{totalUnclassified}</span>}
            </button>
            <button className={`tab ${activeTab === 'recommend' ? 'active' : ''}`} onClick={() => setActiveTab('recommend')}>
              Recommendations
            </button>
          </div>
          <button className="close-btn" onClick={() => setShowInbox(false)}>x</button>
        </div>

        <div className="inbox-content">
          {activeTab === 'inbox' && (
            <>
              {sessions.length === 0 ? (
                <div className="inbox-empty">
                  <p>No unclassified sessions. All data is organized!</p>
                </div>
              ) : (
                <div className="inbox-list">
                  {sessions.map(session => (
                    <div key={session.id} className="inbox-item">
                      <div className="inbox-item-header">
                        <span className="platform-badge">{session.platform}</span>
                        <span className="date-badge">{session.date}</span>
                        <span className="count-badge">{session.nodeCount} nodes</span>
                      </div>
                      <p className="inbox-preview">{session.preview}</p>
                      <div className="inbox-actions">
                        <button
                          className="classify-btn auto"
                          onClick={() => handleAutoClassify(session.id, session.nodes.map(n => n.id))}
                          disabled={classifyStatus[session.id] === 'classifying...'}
                        >
                          Auto Classify
                        </button>
                        <select
                          className="classify-select"
                          onChange={(e) => handleManualClassify(session.id, session.nodes.map(n => n.id), e.target.value)}
                          defaultValue=""
                        >
                          <option value="" disabled>Move to...</option>
                          {projects.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        {classifyStatus[session.id] && (
                          <span className="classify-status">{classifyStatus[session.id]}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'recommend' && (
            <>
              <div className="recommend-selector">
                <label>Select project:</label>
                <select value={selectedProject} onChange={(e) => fetchRecommendations(e.target.value)}>
                  <option value="">Choose a project...</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              {recommendations.length > 0 ? (
                <div className="recommend-list">
                  {recommendations.map((rec, i) => (
                    <div key={i} className="recommend-item">
                      <div className="recommend-header">
                        <span className={`type-badge ${rec.node.type.toLowerCase()}`}>{rec.node.type === 'K' ? 'Knowledge' : 'Wisdom'}</span>
                        <span className="score-badge">{Math.round(rec.score * 100)}% match</span>
                        <span className="from-badge">from {rec.node.project_id}</span>
                      </div>
                      <p className="recommend-content">{rec.node.content.slice(0, 200)}</p>
                      <p className="recommend-reason">{rec.reason}</p>
                      {rec.node.tags && rec.node.tags.length > 0 && (
                        <div className="recommend-tags">
                          {rec.node.tags.slice(0, 5).map((tag, j) => (
                            <span key={j} className="tag">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : selectedProject ? (
                <div className="inbox-empty"><p>No cross-project recommendations found for this project.</p></div>
              ) : (
                <div className="inbox-empty"><p>Select a project to see knowledge recommendations from other projects.</p></div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
