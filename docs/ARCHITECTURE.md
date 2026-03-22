# Mnemosyne Architecture

## System Overview

Mnemosyne operates as a middleware layer between AI coding assistants (Claude Code, Codex) and the user. It captures, transforms, and redistributes knowledge automatically.

## Core Components

### 1. Auto-Capture Layer

**File Watchers** (powered by `chokidar`):
- Monitor `~/.claude/projects/` for Claude Code session files
- Monitor `~/.codex/sessions/` for Codex session files
- Detect new or modified `.jsonl` files in real-time
- Parse tool calls, responses, and metadata into Data nodes

**Claude Code Hooks:**
- `post-tool-use.sh`: Logs each tool call to the Mnemosyne API
- `stop.sh`: Triggers DIKW reflection when a session ends
- `session-start.sh`: Pre-loads relevant knowledge context

### 2. DIKW Transform Engine

The core intelligence of Mnemosyne. Processes raw Data through three transformation stages:

```
Data (D)
  │  Raw tool calls, file contents, timestamps
  ▼
Information (I)
  │  Contextual summaries: what happened and why it matters
  ▼
Knowledge (K)
  │  Reusable patterns: techniques that work across sessions
  ▼
Wisdom (W)
     Meta-judgment: when and why to apply specific knowledge
```

Each transformation uses LLM-powered reflection to extract higher-level insights.

### 3. Storage Layer

**SQLite** database with tables:
- `nodes`: DIKW nodes with type, content, metadata, timestamps
- `connections`: Directed edges between nodes with labels
- `projects`: Organizational grouping for sessions

In-memory via `sql.js` for fast access, with periodic disk persistence.

### 4. API Layer

**Express REST API** for CRUD operations on nodes, connections, and projects.

**WebSocket** for real-time updates — the knowledge graph updates live as new sessions are captured and transformed.

### 5. MCP Server

Standalone `mcp-stdio-server.mjs` that:
- Connects to the Mnemosyne backend API
- Exposes three MCP resources: knowledge nodes, wisdom nodes, graph summary
- Enables Claude Desktop (or any MCP client) to access accumulated knowledge

This creates a **feedback loop**: AI sessions generate knowledge → Mnemosyne captures it → feeds it back into AI sessions.

### 6. Platform Hub

Frontend component that:
- Lists skills and MCP servers from both Claude Code and Codex
- Enables one-click sync of configurations between platforms
- Right-click context menu for quick actions (Sync, Copy Name, Copy Config)

## Data Flow

```
Claude Code Session
        │
        ▼
   File Watcher ──────────▶ Parse JSONL
        │                        │
        │                        ▼
        │                 Create D Nodes
        │                        │
        │                        ▼
        │               DIKW Transform
        │              D → I → K → W
        │                        │
        │                        ▼
        │                Store in SQLite
        │                        │
        │              ┌─────────┴──────────┐
        │              ▼                    ▼
        │      WebSocket Push         MCP Resources
        │      (live graph)       (knowledge context)
        │              │                    │
        │              ▼                    ▼
        │       Browser UI          Claude Desktop
        │      (Knowledge Graph)   (Persistent Memory)
        │
   Codex Session ───▶ (same pipeline)
```

## Technology Choices

| Component | Technology | Rationale |
|-----------|-----------|----------|
| Backend | Node.js + Express | Fast I/O, rich npm ecosystem |
| Database | SQLite (sql.js) | Zero-config, portable, sufficient for single-user |
| Real-time | WebSocket (ws) | Low-latency graph updates |
| Frontend | React 18 + Vite | Fast HMR, modern component model |
| Graph Viz | D3.js force layout | Flexible, performant for 100s of nodes |
| File Watch | Chokidar | Cross-platform, reliable file monitoring |
| AI Integration | MCP (stdio) | Standard protocol, works with Claude ecosystem |
