import React, { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { useGraphStore } from '../stores/graphStore'
import { getColorByType, getLabelByType } from '../utils/dikwColors'
import NodeCard from './NodeCard'
import './MindPalace.css'

const TYPE_RADIUS = { D: 20, I: 24, K: 28, W: 32 }

export default function MindPalace() {
  const svgRef = useRef(null)
  const containerRef = useRef(null)
  const simulationRef = useRef(null)
  const [hoveredNode, setHoveredNode] = useState(null)

  const nodes = useGraphStore((state) => state.getVisibleNodes())
  const connections = useGraphStore((state) => state.getVisibleConnections())
  const zoom = useGraphStore((state) => state.zoom)
  const panX = useGraphStore((state) => state.panX)
  const panY = useGraphStore((state) => state.panY)
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId)

  const setPan = useGraphStore((state) => state.setPan)
  const setZoom = useGraphStore((state) => state.setZoom)
  const selectNode = useGraphStore((state) => state.selectNode)
  const hoverNode = useGraphStore((state) => state.hoverNode)

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return

    const width = containerRef.current?.clientWidth || 1200
    const height = containerRef.current?.clientHeight || 800

    const svg = d3.select(svgRef.current)
    svg.attr('width', width).attr('height', height)

    // Defs: arrowhead + glow filter
    const defs = svg.append('defs')
    defs.append('marker')
      .attr('id', 'arrowhead')
      .attr('markerWidth', 10).attr('markerHeight', 10)
      .attr('refX', 30).attr('refY', 3).attr('orient', 'auto')
      .append('polygon').attr('points', '0 0, 10 3, 0 6').attr('fill', '#666')

    const filter = defs.append('filter').attr('id', 'glow')
    filter.append('feGaussianBlur').attr('stdDeviation', '3.5').attr('result', 'coloredBlur')
    const feMerge = filter.append('feMerge')
    feMerge.append('feMergeNode').attr('in', 'coloredBlur')
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic')

    // Zoom
    const gGroup = svg.append('g')
    const zoomBehavior = d3.zoom()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        gGroup.attr('transform', event.transform)
        setPan(event.transform.x, event.transform.y)
        setZoom(event.transform.k)
      })
    svg.call(zoomBehavior)

    // Map connections to D3 link format
    const links = connections.map(c => ({
      ...c,
      source: c.fromNodeId,
      target: c.toNodeId
    }))

    // Force simulation
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(120).strength(0.4))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => (TYPE_RADIUS[d.type] || 20) + 10))
      .force('x', d3.forceX(width / 2).strength(0.05))
      .force('y', d3.forceY(height / 2).strength(0.05))
    simulationRef.current = simulation

    // Draw links
    const linkSelection = gGroup.selectAll('.link')
      .data(links, d => d.id).join('line')
      .attr('class', 'link')
      .attr('stroke', '#555').attr('stroke-width', 1.5)
      .attr('marker-end', 'url(#arrowhead)')
      .attr('stroke-dasharray', d => {
        const from = nodes.find(n => n.id === d.fromNodeId)
        const to = nodes.find(n => n.id === d.toNodeId)
        return from && to && from.projectId !== to.projectId ? '5,5' : '0'
      })

    // Draw link labels
    const labelSelection = gGroup.selectAll('.link-label')
      .data(links, d => `label_${d.id}`).join('text')
      .attr('class', 'link-label')
      .text(d => d.label)
      .attr('font-size', 10).attr('fill', '#777')
      .attr('text-anchor', 'middle').attr('dy', -6)

    // Draw node groups (circle + type label + content preview)
    const nodeGroup = gGroup.selectAll('.node-g')
      .data(nodes, d => d.id).join('g')
      .attr('class', 'node-g')
      .style('cursor', 'pointer')

    // Circle
    nodeGroup.append('circle')
      .attr('class', 'node-circle')
      .attr('r', d => TYPE_RADIUS[d.type] || 20)
      .attr('fill', d => getColorByType(d.type))
      .attr('opacity', 0.85)
      .attr('stroke', d => selectedNodeId === d.id ? '#fff' : 'none')
      .attr('stroke-width', 2)

    // Type letter inside circle
    nodeGroup.append('text')
      .attr('class', 'node-type-label')
      .text(d => d.type)
      .attr('fill', 'white')
      .attr('font-size', d => (TYPE_RADIUS[d.type] || 20) * 0.75)
      .attr('font-weight', '700')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .style('pointer-events', 'none')

    // Content preview below circle
    nodeGroup.append('text')
      .attr('class', 'node-sub-label')
      .attr('dy', d => (TYPE_RADIUS[d.type] || 20) + 14)
      .attr('fill', '#aaa')
      .attr('font-size', 10)
      .attr('text-anchor', 'middle')
      .style('pointer-events', 'none')
      .text(d => {
        const txt = d.content || ''
        return txt.length > 22 ? txt.substring(0, 22) + '...' : txt
      })

    // Interactions
    nodeGroup
      .on('click', (event, d) => {
        event.stopPropagation()
        selectNode(d.id)
        nodeGroup.selectAll('.node-circle').attr('stroke', 'none')
        d3.select(event.currentTarget).select('.node-circle').attr('stroke', '#fff')
      })
      .on('mouseover', (event, d) => {
        d3.select(event.currentTarget).select('.node-circle')
          .attr('filter', 'url(#glow)').attr('opacity', 1)
        setHoveredNode(d)
        hoverNode(d.id)
      })
      .on('mouseout', (event) => {
        d3.select(event.currentTarget).select('.node-circle')
          .attr('filter', null).attr('opacity', 0.85)
        setHoveredNode(null)
        hoverNode(null)
      })

    // Drag
    nodeGroup.call(d3.drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart()
        d.fx = d.x; d.fy = d.y
      })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0)
        d.fx = null; d.fy = null
      })
    )

    // Tick
    simulation.on('tick', () => {
      linkSelection
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
      labelSelection
        .attr('x', d => (d.source.x + d.target.x) / 2)
        .attr('y', d => (d.source.y + d.target.y) / 2)
      nodeGroup.attr('transform', d => `translate(${d.x},${d.y})`)
    })

    return () => { simulation.stop(); svg.selectAll('*').remove() }
  }, [nodes, connections, panX, panY, zoom, selectedNodeId])

  return (
    <div className="mind-palace-container" ref={containerRef}>
      <svg ref={svgRef} className="mind-palace-svg"></svg>
      {hoveredNode && (
        <div className="node-preview">
          <NodeCard node={hoveredNode} isPreview={true} />
        </div>
      )}
    </div>
  )
}
