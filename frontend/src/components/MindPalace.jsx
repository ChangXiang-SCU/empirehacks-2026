import React, { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { useGraphStore } from '../stores/graphStore'
import { getColorByType, getLabelByType } from '../utils/dikwColors'
import NodeCard from './NodeCard'
import './MindPalace.css'

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
  const currentTool = useGraphStore((state) => state.currentTool)

  const setPan = useGraphStore((state) => state.setPan)
  const setZoom = useGraphStore((state) => state.setZoom)
  const selectNode = useGraphStore((state) => state.selectNode)
  const hoverNode = useGraphStore((state) => state.hoverNode)

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return

    const width = containerRef.current?.clientWidth || 1200
    const height = containerRef.current?.clientHeight || 800

    // Setup SVG
    const svg = d3.select(svgRef.current)
    svg.attr('width', width).attr('height', height)

    // Create defs for arrowheads
    const defs = svg.append('defs')
    defs.append('marker')
      .attr('id', 'arrowhead')
      .attr('markerWidth', 10)
      .attr('markerHeight', 10)
      .attr('refX', 24)
      .attr('refY', 3)
      .attr('orient', 'auto')
      .append('polygon')
      .attr('points', '0 0, 10 3, 0 6')
      .attr('fill', '#666')

    // Setup zoom behavior
    const zoomBehavior = d3.zoom()
      .on('zoom', (event) => {
        const transform = event.transform
        setPan(transform.x, transform.y)
        setZoom(transform.k)
        gGroup.attr('transform', transform)
      })

    svg.call(zoomBehavior)

    // Create group for panning
    const gGroup = svg.append('g')
      .attr('transform', `translate(${panX},${panY})scale(${zoom})`)

    // Map connections to D3 format (source/target instead of fromNodeId/toNodeId)
    const links = connections.map(c => ({
      ...c,
      source: c.fromNodeId,
      target: c.toNodeId
    }))

    // Create force simulation
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links)
        .id(d => d.id)
        .distance(100)
        .strength(0.5)
      )
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(40))

    simulationRef.current = simulation

    // Draw links
    const linkSelection = gGroup.selectAll('.link')
      .data(links, d => d.id)
      .join('line')
      .attr('class', 'link')
      .attr('stroke', '#555')
      .attr('stroke-width', 2)
      .attr('marker-end', 'url(#arrowhead)')
      .attr('stroke-dasharray', d => {
        const fromNode = nodes.find(n => n.id === d.fromNodeId)
        const toNode = nodes.find(n => n.id === d.toNodeId)
        if (fromNode && toNode && fromNode.projectId !== toNode.projectId) {
          return '5,5'
        }
        return '0'
      })

    // Draw link labels
    const labelSelection = gGroup.selectAll('.link-label')
      .data(links, d => `label_${d.id}`)
      .join('text')
      .attr('class', 'link-label')
      .text(d => d.label)
      .attr('font-size', 12)
      .attr('fill', '#999')
      .attr('text-anchor', 'middle')
      .attr('dy', -5)

    // Draw nodes
    const nodeSelection = gGroup.selectAll('.node')
      .data(nodes, d => d.id)
      .join('circle')
      .attr('class', 'node')
      .attr('r', 24)
      .attr('fill', d => getColorByType(d.type))
      .attr('opacity', d => selectedNodeId === d.id ? 1 : 0.8)
      .attr('stroke', d => selectedNodeId === d.id ? '#fff' : 'none')
      .attr('stroke-width', d => selectedNodeId === d.id ? 2 : 0)
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation()
        selectNode(d.id)
      })
      .on('mouseover', (event, d) => {
        setHoveredNode(d)
        hoverNode(d.id)
      })
      .on('mouseout', () => {
        setHoveredNode(null)
        hoverNode(null)
      })
      .call(d3.drag()
        .on('start', dragStarted)
        .on('drag', dragged)
        .on('end', dragEnded)
      )

    // Update simulation on each tick
    simulation.on('tick', () => {
      linkSelection
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y)

      labelSelection
        .attr('x', d => (d.source.x + d.target.x) / 2)
        .attr('y', d => (d.source.y + d.target.y) / 2)

      nodeSelection
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
    })

    // Drag functions
    function dragStarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart()
      d.fx = d.x
      d.fy = d.y
    }

    function dragged(event, d) {
      d.fx = event.x
      d.fy = event.y
    }

    function dragEnded(event, d) {
      if (!event.active) simulation.alphaTarget(0)
      d.fx = null
      d.fy = null
    }

    // Cleanup
    return () => {
      simulation.stop()
      svg.selectAll('*').remove()
    }
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
