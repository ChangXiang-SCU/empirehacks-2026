import { useEffect, useCallback } from 'react'
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

  useEffect(() => {
    loadGraph()

    // Setup WebSocket for real-time updates
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}`)

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)

        if (message.type === 'graph:updated' || message.type === 'import:completed') {
          // Full graph refresh — server sent complete graph data
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
        }
      } catch (error) {
        console.error('WebSocket message error:', error)
      }
    }

    ws.onclose = () => {
      console.log('WebSocket disconnected, will reload graph on reconnect')
      setTimeout(() => {
        loadGraph()
      }, 3000)
    }

    return () => {
      ws.close()
    }
  }, [loadGraph, addNode, addConnection, setNodes, setConnections, setProjects, setMcpSources])

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
