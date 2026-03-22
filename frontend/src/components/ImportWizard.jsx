import React, { useState } from 'react'
import { useGraphStore } from '../stores/graphStore'
import './ImportWizard.css'

export default function ImportWizard() {
  const showImportWizard = useGraphStore((state) => state.showImportWizard)
  const setShowImportWizard = useGraphStore((state) => state.setShowImportWizard)

  const [dragActive, setDragActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)

  if (!showImportWizard) return null

  const handleDrag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0])
    }
  }

  const handleFile = async (file) => {
    setLoading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/import', {
        method: 'POST',
        body: formData
      })

      if (response.ok) {
        const result = await response.json()
        setPreview(result)
      } else {
        const err = await response.json()
        setError(err.error || 'Import failed')
      }
    } catch (error) {
      console.error('Import error:', error)
      setError('Network error: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDone = () => {
    // Graph is already updated via WebSocket broadcast from server
    setShowImportWizard(false)
    setPreview(null)
    setError(null)
  }

  const handleClose = () => {
    setShowImportWizard(false)
    setPreview(null)
    setError(null)
  }

  return (
    <div className="import-wizard-overlay">
      <div className="import-wizard">
        <div className="wizard-header">
          <h2>Import Data</h2>
          <button className="close-btn" onClick={handleClose}>×</button>
        </div>

        <div className="wizard-content">
          {!preview ? (
            <>
              <p className="wizard-help">
                Import ChatGPT, Claude.ai, or Claude Code sessions.
                Files are auto-parsed and transformed through the DIKW pipeline.
              </p>
              <div
                className={`drop-zone ${dragActive ? 'active' : ''}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <div className="drop-content">
                  <div className="drop-icon">📁</div>
                  <p>Drag and drop files here</p>
                  <p className="drop-hint">.json (ChatGPT / Claude.ai) or .jsonl (Claude Code)</p>
                  <input
                    type="file"
                    accept=".json,.jsonl,.zip"
                    onChange={(e) => e.target.files && handleFile(e.target.files[0])}
                    style={{ display: 'none' }}
                    id="file-input"
                  />
                  <label htmlFor="file-input" className="browse-btn">
                    Browse Files
                  </label>
                </div>
              </div>

              {error && (
                <div className="import-error">
                  <p>{error}</p>
                </div>
              )}
            </>
          ) : (
            <div className="import-success">
              <div className="success-icon">✓</div>
              <h3>Import Complete</h3>
              <div className="preview-info">
                <div className="preview-row">
                  <span className="preview-label">Platform</span>
                  <span className="preview-value">{preview.platform}</span>
                </div>
                <div className="preview-row">
                  <span className="preview-label">Project</span>
                  <span className="preview-value">{preview.projectName}</span>
                </div>
                <div className="preview-row">
                  <span className="preview-label">Data nodes</span>
                  <span className="preview-value">{preview.dataNodesCount}</span>
                </div>
                <div className="preview-row">
                  <span className="preview-label">Auto-transformed</span>
                  <span className="preview-value">+{preview.transformedNodesCount} nodes (I/K/W)</span>
                </div>
                <div className="preview-row">
                  <span className="preview-label">Connections</span>
                  <span className="preview-value">{preview.connectionsCount}</span>
                </div>
              </div>
              <p className="pipeline-note">
                D → I → K → W pipeline ran automatically
              </p>
              <button className="btn confirm-btn" onClick={handleDone}>
                View in Mind Palace
              </button>
            </div>
          )}

          {loading && (
            <div className="loading-overlay">
              <div className="spinner"></div>
              <p>Importing & transforming...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
