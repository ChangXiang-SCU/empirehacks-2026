import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { useGraphStore } from '../stores/graphStore'
import { getColorByType, getLabelByType } from '../utils/dikwColors'
import './MindPalace.css'

const TYPE_ICONS = { D: '📊', I: '📋', K: '💡', W: '🔮' }
const NODE_WIDTH = 180
const NODE_HEIGHT_EST = 90
const DIKW_COLUMN = { D: 0.12, I: 0.36, K: 0.62, W: 0.88 }

export default function MindPalace() {
  const containerRef = useRef(null)
  const [positions, setPositions] = useState({})
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 })
  const dragRef = useRef(null)
  const [expandedNodes, setExpandedNodes] = useState(new Set())
  // Track node count to only re-layout when actual data changes
  const prevNodeCountRef = useRef(0)

  const toggleExpand = useCallback((nodeId) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }, [])

  const nodes = useGraphStore((state) => state.getVisibleNodes())
  const connections = useGraphStore((state) => state.getVisibleConnections())
  const projects = useGraphStore((state) => state.projects)
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId)
  const selectNode = useGraphStore((state) => state.selectNode)

  // Layout engine: positions nodes in DIKW columns (left→right)
  const computeLayout = useCallback((nodeList, connList) => {
    if (nodeList.length === 0) { setPositions({}); return }

    const cWidth = containerRef.current?.clientWidth || 1200
    const cHeight = containerRef.current?.clientHeight || 800
    const layoutW = Math.max(cWidth, 1600)
    const layoutH = Math.max(cHeight, 1200)

    const simNodes = nodeList.map((n) => ({ ...n }))
    const links = connList.map((c) => ({
      source: c.fromNodeId,
      target: c.toNodeId,
    }))

    const simulation = d3
      .forceSimulation(simNodes)
      .force(
        'link',
        d3.forceLink(links).id((d) => d.id).distance(250).strength(0.12)
      )
      .force('charge', d3.forceManyBody().strength(-800))
      .force('collision', d3.forceCollide().radius(100))
      .force('x', d3.forceX((d) => layoutW * (DIKW_COLUMN[d.type] || 0.5)).strength(0.7))
      .force('y', d3.forceY(layoutH / 2).strength(0.03))
      .stop()

    for (let i = 0; i < 300; i++) simulation.tick()

    const pos = {}
    simNodes.forEach((n) => {
      pos[n.id] = { x: n.x, y: n.y }
    })
    setPositions(pos)

    // Auto-fit: compute bounding box and zoom/pan to fit all nodes
    const xs = simNodes.map((n) => n.x)
    const ys = simNodes.map((n) => n.y)
    const minX = Math.min(...xs) - 40
    const maxX = Math.max(...xs) + NODE_WIDTH + 40
    const minY = Math.min(...ys) - 40
    const maxY = Math.max(...ys) + NODE_HEIGHT_EST + 40
    const bboxW = maxX - minX
    const bboxH = maxY - minY
    const scaleX = cWidth / bboxW
    const scaleY = cHeight / bboxH
    const k = Math.min(scaleX, scaleY, 1) * 0.92
    const fitX = (cWidth - bboxW * k) / 2 - minX * k
    const fitY = (cHeight - bboxH * k) / 2 - minY * k
    setTransform({ x: fitX, y: fitY, k })
  }, [])

  // Only re-layout when the actual number of visible nodes changes
  // (not on every store update like selectedNodeId change)
  useEffect(() => {
    if (nodes.length !== prevNodeCountRef.current) {
      prevNodeCountRef.current = nodes.length
      computeLayout(nodes, connections)
    }
  }, [nodes, connections, computeLayout])

  // Initial layout on mount
  useEffect(() => {
    if (nodes.length > 0 && Object.keys(positions).length === 0) {
      computeLayout(nodes, connections)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length])

  // Wheel zoom (needs non-passive listener for preventDefault)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      setTransform((prev) => {
        const newK = Math.min(4, Math.max(0.15, prev.k * delta))
        const rect = el.getBoundingClientRect()
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        return {
          x: cx - (cx - prev.x) * (newK / prev.k),
          y: cy - (cy - prev.y) * (newK / prev.k),
          k: newK,
        }
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  // Pan start
  const handleMouseDown = useCallback(
    (e) => {
      if (e.target.closest('.mind-node')) return
      isPanningRef.current = true
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        tx: transform.x,
        ty: transform.y,
      }
      if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
    },
    [transform]
  )

  // Mouse move: drag node or pan
  const handleMouseMove = useCallback(
    (e) => {
      if (dragRef.current) {
        const { nodeId, startX, startY, startPos } = dragRef.current
        setPositions((prev) => ({
          ...prev,
          [nodeId]: {
            x: startPos.x + (e.clientX - startX) / transform.k,
            y: startPos.y + (e.clientY - startY) / transform.k,
          },
        }))
        return
      }
      if (!isPanningRef.current) return
      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y
      setTransform((prev) => ({
        ...prev,
        x: panStartRef.current.tx + dx,
        y: panStartRef.current.ty + dy,
      }))
    },
    [transform.k]
  )

  // Mouse up
  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false
    dragRef.current = null
    if (containerRef.current) containerRef.current.style.cursor = 'grab'
  }, [])

  // Node drag start
  const handleNodeMouseDown = useCallback(
    (e, nodeId) => {
      e.stopPropagation()
      selectNode(nodeId)
      dragRef.current = {
        nodeId,
        startX: e.clientX,
        startY: e.clientY,
        startPos: { ...positions[nodeId] },
      }
    },
    [positions, selectNode]
  )

  // Node double-click to toggle expand/collapse
  const handleNodeDoubleClick = useCallback(
    (e, nodeId) => {
      e.stopPropagation()
      toggleExpand(nodeId)
    },
    [toggleExpand]
  )

  // Render bezier connection path
  const renderConnection = (conn) => {
    const fromPos = positions[conn.fromNodeId]
    const toPos = positions[conn.toNodeId]
    if (!fromPos || !toPos) return null

    const fromNode = nodes.find((n) => n.id === conn.fromNodeId)
    const toNode = nodes.find((n) => n.id === conn.toNodeId)

    const fx = fromPos.x + NODE_WIDTH
    const fy = fromPos.y + NODE_HEIGHT_EST / 2
    const tx = toPos.x
    const ty = toPos.y + NODE_HEIGHT_EST / 2
    const midX = (fx + tx) / 2

    let color = '#444'
    if (fromNode?.type === 'K' || toNode?.type === 'K') color = '#f57c00'
    if (fromNode?.type === 'W' || toNode?.type === 'W') color = '#e53935'
    const isCross = fromNode?.projectId !== toNode?.projectId
    if (isCross) color = '#667eea'

    return (
      <path
        key={conn.id}
        d={`M${fx},${fy} C${midX},${fy} ${midX},${ty} ${tx},${ty}`}
        stroke={color}
        strokeWidth={1.5}
        fill="none"
        opacity={0.5}
        className={isCross ? 'cross-project' : ''}
      />
    )
  }

  // Get project for a node
  const getProject = (node) => {
    return (
      projects.find((p) => p.id === node.projectId) || {
        name: 'Unknown',
        color: '#666',
      }
    )
  }

  return (
    <div
      className="mind-palace-container"
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Dot grid background */}
      <div
        className="grid-bg"
        style={{
          transform: `translate(${transform.x % 30}px, ${transform.y % 30}px)`,
        }}
      />

      {/* Pannable / zoomable canvas */}
      <div
        className="canvas"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
          transformOrigin: '0 0',
        }}
      >
        {/* SVG connection lines */}
        <svg className="connections-svg">
          {connections.map((c) => renderConnection(c))}
        </svg>

        {/* Node cards */}
        {nodes.map((node) => {
          const pos = positions[node.id]
          if (!pos) return null
          const project = getProject(node)
          const isSelected = selectedNodeId === node.id
          const typeKey = node.type?.toLowerCase() || 'd'
          const isExpanded = expandedNodes.has(node.id)

          return (
            <div
              key={node.id}
              className={`mind-node ${typeKey}-node ${isSelected ? 'selected' : ''} ${
                node.sharedProjects?.length ? 'shared' : ''
              } ${isExpanded ? 'expanded' : 'collapsed'}`}
              style={{ left: pos.x, top: pos.y }}
              onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
              onDoubleClick={(e) => handleNodeDoubleClick(e, node.id)}
            >
              <div className="mind-node-header">
                <span className="mind-node-type">
                  {TYPE_ICONS[node.type]} {getLabelByType(node.type)}
                </span>
                <span className="mind-node-toggle">
                  {isExpanded ? '▾' : '▸'}
                </span>
              </div>
              {/* Collapsed: show project badge + 2-line preview */}
              {!isExpanded && (
                <div className="mind-node-collapsed-body">
                  <div className="mind-node-preview">
                    {node.content?.slice(0, 80)}{node.content?.length > 80 ? '…' : ''}
                  </div>
                  <span className={`mind-node-project ${typeKey}-project`}>
                    {project.name}
                  </span>
                </div>
              )}
              {/* Expanded: full content + tags */}
              {isExpanded && (
                <div className="mind-node-body">
                  <div className={`mind-node-project-expanded ${typeKey}-project`}>
                    {project.name}
                  </div>
                  <div className="mind-node-content-full">{node.content}</div>
                  {node.tags && node.tags.length > 0 && (
                    <div className="mind-node-tags">
                      {node.tags.map((tag, i) => (
                        <span key={i} className="mind-node-tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Zoom controls */}
      <div className="zoom-controls">
        <button className="zoom-btn auto-layout-btn" onClick={() => computeLayout(nodes, connections)}>
          ⚡ Auto Layout
        </button>
        <button
          className="zoom-btn"
          onClick={() =>
            setTransform((t) => ({ ...t, k: Math.min(4, t.k * 1.2) }))
          }
        >
          +
        </button>
        <span className="zoom-level">{Math.round(transform.k * 100)}%</span>
        <button
          className="zoom-btn"
          onClick={() =>
            setTransform((t) => ({ ...t, k: Math.max(0.15, t.k / 1.2) }))
          }
        >
          −
        </button>
        <button
          className="zoom-btn reset-btn"
          onClick={() => setTransform({ x: 0, y: 0, k: 1 })}
        >
          Reset
        </button>
      </div>
    </div>
  )
}
