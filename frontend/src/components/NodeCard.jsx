import React from 'react'
import { getLabelByType, getColorByType } from '../utils/dikwColors'
import './NodeCard.css'

export default function NodeCard({ node, isPreview = false }) {
  const typeLabel = getLabelByType(node.type)
  const typeColor = getColorByType(node.type)

  return (
    <div className={`node-card ${isPreview ? 'preview' : ''}`}>
      <div className="node-header" style={{ borderLeftColor: typeColor }}>
        <div className="node-type-badge dikw-badge" style={{ backgroundColor: `${typeColor}22`, color: typeColor }}>
          {typeLabel}
        </div>
        {node.projectBadge && (
          <div className="project-badge">
            {node.projectBadge}
          </div>
        )}
        {node.dtype && (
          <div className="dtype-badge">
            {node.dtype}
          </div>
        )}
      </div>
      <div className="node-body">
        <p className="node-content">{node.content}</p>
        {node.tags && node.tags.length > 0 && (
          <div className="node-tags">
            {node.tags.map((tag, i) => (
              <span key={i} className="tag">{tag}</span>
            ))}
          </div>
        )}
      </div>
      <div className="node-footer">
        <small>{new Date(node.createdAt).toLocaleDateString()}</small>
      </div>
    </div>
  )
}