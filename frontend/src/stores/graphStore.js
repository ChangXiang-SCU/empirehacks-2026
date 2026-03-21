import { create } from 'zustand'

export const useGraphStore = create((set, get) => ({
  // Core data
  nodes: [],
  connections: [],
  projects: [],
  mcpSources: [],
  inbox: [],

  // UI state
  activeProjects: new Set(),
  activeDIKW: new Set(['D', 'I', 'K', 'W']),
  currentTool: 'move', // 'move' | 'connect' | 'share'
  zoom: 1,
  panX: 0,
  panY: 0,
  selectedNodeId: null,
  hoveredNodeId: null,

  // Modal states
  showImportWizard: false,
  showInbox: false,

  // Actions
  setNodes: (nodes) => set({ nodes }),
  setConnections: (connections) => set({ connections }),
  setProjects: (projects) => set({ projects }),
  setMcpSources: (mcpSources) => set({ mcpSources }),
  setInbox: (inbox) => set({ inbox }),

  addNode: (node) => set((state) => ({
    nodes: [...state.nodes, node]
  })),

  removeNode: (nodeId) => set((state) => ({
    nodes: state.nodes.filter(n => n.id !== nodeId),
    connections: state.connections.filter(
      c => c.fromNodeId !== nodeId && c.toNodeId !== nodeId
    )
  })),

  addConnection: (connection) => set((state) => ({
    connections: [...state.connections, connection]
  })),

  removeConnection: (connectionId) => set((state) => ({
    connections: state.connections.filter(c => c.id !== connectionId)
  })),

  connectNodes: (fromNodeId, toNodeId, label = 'influences') => set((state) => {
    const id = `conn_${fromNodeId}_${toNodeId}`
    const newConnection = {
      id,
      fromNodeId,
      toNodeId,
      label
    }
    return {
      connections: [...state.connections, newConnection]
    }
  }),

  shareNode: (nodeId, projectId) => set((state) => {
    const updatedNodes = state.nodes.map(n => {
      if (n.id === nodeId) {
        const sharedProjects = new Set(n.sharedProjects || [])
        sharedProjects.add(projectId)
        return { ...n, sharedProjects: Array.from(sharedProjects) }
      }
      return n
    })
    return { nodes: updatedNodes }
  }),

  toggleActiveProject: (projectId) => set((state) => {
    const newSet = new Set(state.activeProjects)
    if (newSet.has(projectId)) {
      newSet.delete(projectId)
    } else {
      newSet.add(projectId)
    }
    return { activeProjects: newSet }
  }),

  toggleActiveDIKW: (type) => set((state) => {
    const newSet = new Set(state.activeDIKW)
    if (newSet.has(type)) {
      newSet.delete(type)
    } else {
      newSet.add(type)
    }
    return { activeDIKW: newSet }
  }),

  setCurrentTool: (tool) => set({ currentTool: tool }),

  setZoom: (zoom) => set({ zoom }),
  setPan: (panX, panY) => set({ panX, panY }),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),
  hoverNode: (nodeId) => set({ hoveredNodeId: nodeId }),

  setShowImportWizard: (show) => set({ showImportWizard: show }),
  setShowInbox: (show) => set({ showInbox: show }),

  classifySession: (sessionId, projectId) => set((state) => {
    const newInbox = state.inbox.filter(s => s.id !== sessionId)
    return { inbox: newInbox }
  }),

  importData: (newNodes, newConnections) => set((state) => ({
    nodes: [...state.nodes, ...newNodes],
    connections: [...state.connections, ...newConnections]
  })),

  // Helper to get visible nodes based on filters
  getVisibleNodes: () => {
    const state = get()
    return state.nodes.filter(node => {
      const projectMatch =
        state.activeProjects.size === 0 || state.activeProjects.has(node.projectId)
      const typeMatch = state.activeDIKW.has(node.type)
      return projectMatch && typeMatch
    })
  },

  // Helper to get visible connections
  getVisibleConnections: () => {
    const state = get()
    const visibleNodeIds = new Set(state.getVisibleNodes().map(n => n.id))
    return state.connections.filter(
      c => visibleNodeIds.has(c.fromNodeId) && visibleNodeIds.has(c.toNodeId)
    )
  }
}))
