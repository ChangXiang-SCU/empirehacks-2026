import { useEffect } from 'react'
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

  useEffect(() => {
    // Load initial graph data from backend
    const loadGraph = async () => {
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
    }

    loadGraph()

    // Setup WebSocket for real-time updates
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}`)

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'node:added') {
          // Handle new node
        } else if (data.type === 'connection:added') {
          // Handle new connection
        }
      } catch (error) {
        console.error('WebSocket message error:', error)
      }
    }

    return () => {
      ws.close()
    }
  }, [setNodes, setConnections, setProjects, setMcpSources])

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
