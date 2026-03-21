CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('D', 'I', 'K', 'W')),
  project_id TEXT NOT NULL,
  source_platform TEXT,
  content TEXT NOT NULL,
  tags TEXT,
  dtype TEXT,
  mcp_source TEXT,
  shared_projects TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  label TEXT DEFAULT 'influences',
  created_at TEXT NOT NULL,
  FOREIGN KEY(from_node_id) REFERENCES nodes(id),
  FOREIGN KEY(to_node_id) REFERENCES nodes(id)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'disconnected',
  icon TEXT,
  data_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  source_platform TEXT,
  classified_at TEXT,
  confidence REAL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_connections_from ON connections(from_node_id);
CREATE INDEX IF NOT EXISTS idx_connections_to ON connections(to_node_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
