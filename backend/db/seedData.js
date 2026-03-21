import { v4 as uuidv4 } from 'uuid'

export function seedData() {
  const now = new Date()
  const projects = [
    { id: 'proj_cs2110', name: 'CS 2110 Debug', color: '#3949ab' },
    { id: 'proj_govt', name: 'GOVT Essay', color: '#f57c00' },
    { id: 'proj_hack', name: 'Hackathon Project', color: '#e53935' }
  ]

  const mcpSources = [
    { id: 'mcp_github', name: 'GitHub API', status: 'connected', icon: '🔗', dataCount: 5 },
    { id: 'mcp_scholar', name: 'Google Scholar', status: 'idle', icon: '📚', dataCount: 3 },
    { id: 'mcp_slack', name: 'Slack', status: 'connected', icon: '💬', dataCount: 7 }
  ]

  const nodes = [
    // CS 2110 - Data nodes
    {
      id: 'node_d1',
      type: 'D',
      projectId: 'proj_cs2110',
      sourcePlatform: 'claude-code',
      content: 'fibonacci.java: Recursive implementation, exponential time complexity O(2^n)',
      tags: ['algorithm', 'performance', 'file:fibonacci.java'],
      dtype: 'code-analysis',
      mcpSource: 'github',
      sharedProjects: [],
      createdAt: new Date(now - 86400000 * 7).toISOString()
    },
    {
      id: 'node_d2',
      type: 'D',
      projectId: 'proj_cs2110',
      sourcePlatform: 'claude-code',
      content: 'Session log: debugged recursive calls, identified cache misses with 15M+ recomputations',
      tags: ['debugging', 'session-log', 'performance-analysis'],
      dtype: 'session-note',
      mcpSource: null,
      sharedProjects: [],
      createdAt: new Date(now - 86400000 * 6).toISOString()
    },
    {
      id: 'node_d3',
      type: 'D',
      projectId: 'proj_cs2110',
      sourcePlatform: 'claude-code',
      content: 'GitHub MCP: Fetched commit history showing 3 optimization attempts over 2 weeks',
      tags: ['git-history', 'mcp-source:github', 'timeline'],
      dtype: 'mcp-data',
      mcpSource: 'github',
      sharedProjects: [],
      createdAt: new Date(now - 86400000 * 5).toISOString()
    },

    // CS 2110 - Information nodes
    {
      id: 'node_i1',
      type: 'I',
      projectId: 'proj_cs2110',
      sourcePlatform: 'claude-code',
      content: 'Fibonacci recursion causes exponential recomputation of subproblems. Memoization needed for n > 20.',
      tags: ['dynamic-programming', 'optimization-hint'],
      dtype: null,
      mcpSource: null,
      sharedProjects: [],
      createdAt: new Date(now - 86400000 * 4).toISOString()
    },
    {
      id: 'node_i2',
      type: 'I',
      projectId: 'proj_cs2110',
      sourcePlatform: 'claude-code',
      content: 'Pattern: Student iterates multiple times before optimizing. Shows learning curve in structural thinking.',
      tags: ['learning-pattern', 'pedagogy'],
      dtype: null,
      mcpSource: null,
      sharedProjects: [],
      createdAt: new Date(now - 86400000 * 3).toISOString()
    },

    // CS 2110 - Knowledge nodes
    {
      id: 'node_k1',
      type: 'K',
      projectId: 'proj_cs2110',
      sourcePlatform: 'claude-code',
      content: 'Skill: Use structure-first approach. For algorithm problems: clarify data structure → identify patterns → then optimize. Avoids premature optimization.',
      tags: ['skill', 'methodology', 'algorithm-design'],
      dtype: null,
      mcpSource: null,
      sharedProjects: ['proj_hack'],
      createdAt: new Date(now - 86400000 * 2).toISOString()
    },

    // CS 2110 - Wisdom nodes
    {
      id: 'node_w1',
      type: 'W',
      projectId: 'proj_cs2110',
      sourcePlatform: 'claude-code',
      content: 'Wisdom: Structure-first approach works only for problems where fundamental algorithmic improvement is possible. For I/O-bound problems, structure matters less than caching strategy.',
      tags: ['meta-judgment', 'constraint-aware', 'trade-off'],
      dtype: null,
      mcpSource: null,
      sharedProjects: [],
      createdAt: new Date(now - 86400000 * 1).toISOString()
    },

    // GOVT Essay - Data nodes
    {
      id: 'node_d4',
      type: 'D',
      projectId: 'proj_govt',
      sourcePlatform: 'claude-web',
      content: 'carbon_tax_draft.docx: Initial thesis arguing for progressive taxation model',
      tags: ['essay', 'file:carbon_tax_draft.docx', 'policy'],
      dtype: 'document',
      mcpSource: null,
      sharedProjects: [],
      createdAt: new Date(now - 86400000 * 7).toISOString()
    },
    {
      id: 'node_d5',
      type: 'D',
      projectId: 'proj_govt',
      sourcePlatform: 'claude-web',
      content: 'Session: Revised intro 5 times, analyzed counterarguments, added 8 academic citations',
      tags: ['writing-process', 'session-log'],
      dtype: 'session-note',
      mcpSource: null,
      sharedProjects: [],
      createdAt: new Date(now - 86400000 * 5).toISOString()
    },
    {
      id: 'node_d6',
      type: 'D',
      projectId: 'proj_govt',
      sourcePlatform: 'claude-web',
      content: 'Google Scholar MCP: Found 12 papers on carbon tax efficacy, 3 critiques of progressive models',
      tags: ['research', 'mcp-source:scholar', 'citations'],
      dtype: 'mcp-data',
      mcpSource: 'scholar',
      sharedProjects: [],
      createdAt: new Date(now - 86400000 * 4).toISOString()
    },

    // GOVT Essay - Information nodes
    {
      id: 'node_i3',
      type: 'I',
      projectId: 'proj_govt',
      sourcePlatform: 'claude-web',
      content: 'Writer revises intro repeatedly to clarify policy position. Each revision strengthens counterargument resistance.',
      tags: ['writing-strategy', 'argumentation'],
      dtype: null,
      mcpSource: null,
      sharedProjects: [],
      createdAt: new Date(now - 86400000 * 3).toISOString()
    },

    // GOVT Essay - Knowledge nodes
    {
      id: 'node_k2',
      type: 'K',
      projectId: 'proj_govt',
      sourcePlatform: 'claude-web',
      content: 'Skill: Incremental-over-rewrite approach for policy essays. Revise opening multiple times to build argument strength. Works better than structural rewrites for policy papers.',
      tags: ['skill', 'writing', 'policy-writing'],
      dtype: null,
      mcpSource: null,
      sharedProjects: ['proj_hack'],
      createdAt: new Date(now - 86400000 * 2).toISOString()
    },

    // GOVT Essay - Wisdom nodes
    {
      id: 'node_w2',
      type: 'W',
      projectId: 'proj_govt',
      sourcePlatform: 'claude-web',
      content: 'Wisdom: Incremental approach effective only when audience is receptive to policy nuance. For advocacy essays, rewrite structure instead. Progressive taxation essays work incrementally because complexity demands repeated exposure.',
      tags: ['meta-judgment', 'context-dependent', 'audience-analysis'],
      dtype: null,
      mcpSource: null,
      sharedProjects: [],
      createdAt: new Date(now - 86400000 * 1).toISOString()
    },

    // Hackathon - Data nodes
    {
      id: 'node_d7',
      type: 'D',
      projectId: 'proj_hack',
      sourcePlatform: 'claude-code',
      content: 'hackathon-brief.md: 48-hour constraint, 3-person team, MVP required by hour 36',
      tags: ['project-brief', 'constraints', 'timeline'],
      dtype: 'specification',
      mcpSource: null,
      sharedProjects: [],
      createdAt: new Date(now - 86400000 * 3).toISOString()
    },
    {
      id: 'node_d8',
      type: 'D',
      projectId: 'proj_hack',
      sourcePlatform: 'claude-code',
      content: 'Slack MCP: Team decided: API-first architecture, skip frontend polish, focus on demo quality',
      tags: ['team-decision', 'mcp-source:slack', 'architecture'],
      dtype: 'mcp-data',
      mcpSource: 'slack',
      sharedProjects: [],
      createdAt: new Date(now - 86400000 * 2).toISOString()
    },

    // Hackathon - Information nodes
    {
      id: 'node_i4',
      type: 'I',
      projectId: 'proj_hack',
      sourcePlatform: 'claude-code',
      content: 'Time pressure forced architectural decisions: API design took priority over implementation polish. Team sacrificed UX completeness for backend robustness.',
      tags: ['decision-analysis', 'time-constraint'],
      dtype: null,
      mcpSource: null,
      sharedProjects: [],
      createdAt: new Date(now - 86400000 * 1).toISOString()
    },

    // Hackathon - Knowledge nodes
    {
      id: 'node_k3',
      type: 'K',
      projectId: 'proj_hack',
      sourcePlatform: 'claude-code',
      content: 'Skill: Hackathon-scoping. Identify critical demo elements (48h). Use API-first design. Polish late, validate core functionality early.',
      tags: ['skill', 'project-management', 'hackathon'],
      dtype: null,
      mcpSource: null,
      sharedProjects: [],
      createdAt: new Date(now - 86400000 * 1).toISOString()
    },

    // Hackathon - Wisdom nodes
    {
      id: 'node_w3',
      type: 'W',
      projectId: 'proj_hack',
      sourcePlatform: 'claude-code',
      content: 'Wisdom: Time constraint is most limiting factor in hackathons. Prioritize: demo-readiness > feature-completeness > code-quality. Trade-off only works when judges value innovation over polish.',
      tags: ['meta-judgment', 'constraint-aware', 'judging-criteria'],
      dtype: null,
      mcpSource: null,
      sharedProjects: [],
      createdAt: new Date(now).toISOString()
    }
  ]

  const connections = [
    // CS 2110 flow
    { id: 'conn_1', fromNodeId: 'node_d1', toNodeId: 'node_d2', label: 'informs' },
    { id: 'conn_2', fromNodeId: 'node_d2', toNodeId: 'node_d3', label: 'documented-in' },
    { id: 'conn_3', fromNodeId: 'node_d1', toNodeId: 'node_i1', label: 'reveals' },
    { id: 'conn_4', fromNodeId: 'node_d2', toNodeId: 'node_i2', label: 'demonstrates' },
    { id: 'conn_5', fromNodeId: 'node_i1', toNodeId: 'node_k1', label: 'becomes' },
    { id: 'conn_6', fromNodeId: 'node_i2', toNodeId: 'node_k1', label: 'generalizes' },
    { id: 'conn_7', fromNodeId: 'node_k1', toNodeId: 'node_w1', label: 'contextualized-by' },

    // GOVT flow
    { id: 'conn_8', fromNodeId: 'node_d4', toNodeId: 'node_d5', label: 'evolved-through' },
    { id: 'conn_9', fromNodeId: 'node_d5', toNodeId: 'node_d6', label: 'supported-by' },
    { id: 'conn_10', fromNodeId: 'node_d4', toNodeId: 'node_i3', label: 'demonstrates' },
    { id: 'conn_11', fromNodeId: 'node_d5', toNodeId: 'node_i3', label: 'shows' },
    { id: 'conn_12', fromNodeId: 'node_i3', toNodeId: 'node_k2', label: 'becomes' },
    { id: 'conn_13', fromNodeId: 'node_k2', toNodeId: 'node_w2', label: 'contextualized-by' },

    // Hackathon flow
    { id: 'conn_14', fromNodeId: 'node_d7', toNodeId: 'node_d8', label: 'constrains' },
    { id: 'conn_15', fromNodeId: 'node_d7', toNodeId: 'node_i4', label: 'reveals' },
    { id: 'conn_16', fromNodeId: 'node_d8', toNodeId: 'node_i4', label: 'shows' },
    { id: 'conn_17', fromNodeId: 'node_i4', toNodeId: 'node_k3', label: 'becomes' },
    { id: 'conn_18', fromNodeId: 'node_k3', toNodeId: 'node_w3', label: 'contextualized-by' },

    // Cross-project connections
    { id: 'conn_19', fromNodeId: 'node_k1', toNodeId: 'node_k2', label: 'related-to' },
    { id: 'conn_20', fromNodeId: 'node_k2', toNodeId: 'node_k3', label: 'complements' }
  ]

  return { projects, nodes, connections, mcpSources }
}
