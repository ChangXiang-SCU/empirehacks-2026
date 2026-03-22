import { useEffect, useCallback, useRef } from 'react'
import { useGraphStore } from './stores/graphStore'
import MindPalace from './components/MindPalace'
import Sidebar from './components/Sidebar'
import Toolbar from './components/Toolbar'
import InboxPanel from './components/InboxPanel'
import ImportWizard from './components/ImportWizard'
import './App.css'

function App() {
  const setNodes = useGraphStore((state) => state.setNodes)
  const setConnections = useGraphStore((state) => state.setConnections)
  const setProjects = useGraphStore((state) => state.setProjects)
  const setMcpSources = useGraphStore((state) => state.setMcpSources)
  const addNode = useGraphStore((state) => state.addNode)
  const addConnection = useGraphStore((state) => state.addConnection)
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const retryCount = useRef(0)

  const loadGraph = useCallback(async () => {
    try {
      const response = await fetch('/api/graph')
      if (response.ok) {
        const data = await response.json()
        setNodes(data.nodes || [])
        setConnections(data.connections || [])
        setProjects(data.projects || [])
        setMcpSources(data.mcpSources || [])
      }
    } catch (error) {
      console.error('Failed to load graph:', error)
    }
  }, [setNodes, setConnections, setProjects, setMcpSources])

  const connectWebSocket = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return

    const wsHost = window.location.hostname || 'localhost'
    const ws = new WebSocket(`ws://${wsHost}:3001`)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('WebSocket connected')
      retryCount.current = 0
      // Refresh graph data on reconnect to catch anything missed
      loadGraph()
    }

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'graph:updated' || message.type === 'import:completed') {
          const data = message.data
          if (data) {
            setNodes(data.nodes || [])
            setConnections(data.connections || [])
            setProjects(data.projects || [])
            setMcpSources(data.mcpSources || [])
          }
        } else if (message.type === 'node:added' && message.data) {
          addNode(message.data)
        } else if (message.type === 'connection:added' && message.data) {
          addConnection(message.data)
        } else if (message.type === 'nodes:updated') {
          // Generic update signal — reload full graph
          loadGraph()
        }
      } catch (error) {
        console.error('WebSocket message error:', error)
      }
    }

    ws.onclose = () => {
      console.log('WebSocket disconnected, scheduling reconnect...')
      wsRef.current = null
      const delay = Math.min(1000 * Math.pow(2, retryCount.current), 10000)
      retryCount.current++
      reconnectTimer.current = setTimeout(() => {
        console.log(`WebSocket reconnecting (attempt ${retryCount.current})...`)
        connectWebSocket()
      }, delay)
    }

    ws.onerror = (err) => {
      console.error('WebSocket error:', err)
      ws.close()
    }
  }, [loadGraph, addNode, addConnection, setNodes, setConnections, setProjects, setMcpSources])

  useEffect(() => {
    loadGraph()
    connectWebSocket()

    // Heartbeat: poll graph every 30s as fallback
    const heartbeat = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        loadGraph()
      }
    }, 30000)

    return () => {
      clearInterval(heartbeat)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      if (wsRef.current) wsRef.current.close()
    }
  }, [loadGraph, connectWebSocket])

  return (
    <div className="app-container">
      <Sidebar />
      <div className="main-content">
        <Toolbar />
        <MindPalace />
      </div>
      <InboxPanel />
      <ImportWizard />
    </div>
  )
}

export default App
