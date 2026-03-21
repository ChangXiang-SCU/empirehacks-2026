import React, { useState } from 'react'
import { useGraphStore } from '../stores/graphStore'
import './ImportWizard.css'

export default function ImportWizard() {
  const showImportWizard = useGraphStore((state) => state.showImportWizard)
  const setShowImportWizard = useGraphStore((state) => state.setShowImportWizard)
  const importData = useGraphStore((state) => state.importData)

  const [dragActive, setDragActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState(null)

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
      }
    } catch (error) {
      console.error('Import error:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = () => {
    if (preview && preview.nodes && preview.connections) {
      importData(preview.nodes, preview.connections)
      setShowImportWizard(false)
      setPreview(null)
    }
  }

  return (
    <div className="import-wizard-overlay">
      <div className="import-wizard">
        <div className="wizard-header">
          <h2>Import Data</h2>
          <button className="close-btn" onClick={() => setShowImportWizard(false)}>×</button>
        </div>

        <div className="wizard-content">
          {!preview ? (
            <>
              <p className="wizard-help">Import ChatGPT, Claude.ai, or Claude Code sessions</p>
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
                  <p className="drop-hint">or click to browse</p>
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
            </>
          ) : (
            <>
              <div className="preview-info">
                <p>Detected platform: <strong>{preview.platform}</strong></p>
                <p>Sessions found: <strong>{preview.sessions}</strong></p>
                <p>Nodes to import: <strong>{preview.nodes?.length || 0}</strong></p>
              </div>
              <div className="preview-actions">
                <button
                  className="btn cancel-btn"
                  onClick={() => setPreview(null)}
                >
                  Back
                </button>
                <button
                  className="btn confirm-btn"
                  onClick={handleConfirm}
                >
                  Confirm Import
                </button>
              </div>
            </>
          )}

          {loading && (
            <div className="loading-overlay">
              <div className="spinner"></div>
              <p>Processing...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}