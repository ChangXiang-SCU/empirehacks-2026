# Mnemosyne: Agent-Agnostic Knowledge Management Layer

**[中文版本见下文](#中文版本)**

## Overview

Mnemosyne is an intelligent knowledge management system built on the **DIKW (Data-Information-Knowledge-Wisdom) model**. It automatically captures, classifies, and transforms interactions across multiple AI platforms (Claude Code, ChatGPT, Claude.ai) into a unified, searchable knowledge graph.

### What is DIKW?

The DIKW pyramid represents the transformation of raw inputs into actionable wisdom:

- **Data (D)**: Raw facts, tool calls, file excerpts, timestamps. Uncontextualized observations.
- **Information (I)**: Data + context. Understanding *what* happened in a session, patterns in behavior, extracted insights.
- **Knowledge (K)**: Cross-session patterns. "When I encounter problem X, solution Y works." Reusable skills and techniques.
- **Wisdom (W)**: Meta-level judgment. When and why to apply knowledge. Constraints, trade-offs, and long-term strategy.

Mnemosyne automates this transformation pipeline and visualizes it as an interactive **Mind Palace** graph.

## Key Features

- **Multi-Platform Import**: Parse exports from ChatGPT, Claude.ai, and Claude Code
- **Automatic Classification**: AI-driven session categorization into projects
- **DIKW Pipeline**: Real-time transformation of raw data → actionable wisdom
- **Interactive Visualization**: D3.js force-directed graph with infinite pan/zoom
- **Real-Time Sync**: WebSocket-driven live updates
- **MCP Integration**: Monitor and ingest from Model Context Protocol sources
- **Export Skills**: Automatically generate SKILL.md files from Knowledge nodes
- **Hackathon Track**: Perfect for learning systems, research tools, productivity augmentation

## Tech Stack

- **Frontend**: React 18 + Vite, D3.js, Zustand, TailwindCSS
- **Backend**: Node.js + Express, SQLite, WebSockets, File Watchers
- **Data Processing**: Better-SQLite3, Multer, Chokidar
- **Deployment**: Docker-ready, works locally or cloud

## Quick Start

### Prerequisites
- Node.js 18+ and npm
- Git

### Installation

```bash
git clone https://github.com/ChangXiang-SCU/empirehacks-2026.git
cd empirehacks-2026
npm install
```

### Development

Run frontend and backend in parallel:

```bash
# Terminal 1: Start backend on port 3001
npm run backend

# Terminal 2: Start frontend on port 5173
npm run frontend
```

Then open http://localhost:5173 in your browser.

### Production Build

```bash
npm run build
npm start
```

## Project Structure

```
empirehacks-2026/
├── frontend/                    # React + Vite UI
│   ├── src/
│   │   ├── components/
│   │   │   ├── MindPalace.jsx   # D3 force-directed graph
│   │   │   ├── NodeCard.jsx     # DIKW node rendering
│   │   │   ├── Sidebar.jsx      # Project/filter panel
│   │   │   ├── Toolbar.jsx      # Tools: move, connect, share
│   │   │   ├── InboxPanel.jsx   # Unclassified sessions
│   │   │   └── ImportWizard.jsx # Import dialog
│   │   ├── stores/
│   │   │   └── graphStore.js    # Zustand state
│   │   └── utils/
│   │       └── dikwColors.js    # Color constants
│   └── vite.config.js
├── backend/                     # Node.js daemon
│   ├── lib/
│   │   ├── dikwEngine.js        # D→I→K→W pipeline
│   │   ├── sessionClassifier.js # Auto-classification
│   │   ├── fileWatcher.js       # Monitor .claude/, .openclaw/
│   │   ├── importers/           # ChatGPT, Claude.ai, Claude Code parsers
│   │   ├── exporters/           # SKILL.md, CLAUDE.md generators
│   │   └── mcpServer.js         # MCP protocol implementation
│   ├── db/
│   │   └── schema.sql           # SQLite schema
│   └── server.js                # Express + WebSocket
├── hooks/                       # Claude Code integrations
│   ├── post-tool-use.sh         # Log tool calls
│   ├── stop.sh                  # Trigger reflection
│   └── session-start.sh         # Load context
├── demo/
│   └── seed-data.json           # Pre-seeded DIKW nodes
└── README.md
```

## API Reference

### REST Endpoints

- `GET /api/graph` — Fetch full DIKW graph
- `POST /api/import` — Upload ChatGPT/Claude export (multipart)
- `POST /api/classify` — Classify session into project
- `POST /api/hook/tool-use` — Claude Code hook for tool call logging
- `GET /api/nodes?type=K&project=cs2110` — Filter nodes
- `POST /api/export/skill/:nodeId` — Generate SKILL.md

### WebSocket Events

- `node:added` — New node created
- `connection:added` — New edge created
- `node:shared` — Node shared across projects
- `classification:updated` — Session classified

## License

MIT
