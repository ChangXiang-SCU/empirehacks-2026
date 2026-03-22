# Contributing to Mnemosyne

Thank you for your interest in contributing to Mnemosyne! This guide will help you get started.

## Development Setup

1. Fork and clone the repository
2. Install dependencies:

```bash
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

3. Start development servers:

```bash
npm run backend   # Terminal 1
npm run frontend  # Terminal 2
```

## Project Architecture

Mnemosyne follows a clean separation between frontend and backend:

- **Backend** (`backend/server.js`): Single-file Express server with SQLite, WebSocket, DIKW engine, file watchers, and MCP endpoint. All core logic lives here.
- **Frontend** (`frontend/src/`): React 18 + Vite app with D3.js visualization. Components include MindPalace (graph), ConnectPanel (Platform Hub), and Sidebar (filters).
- **MCP Server** (`backend/mcp-stdio-server.mjs`): Standalone stdio MCP server that connects to the backend API and exposes knowledge/wisdom nodes to Claude Desktop.
- **Hooks** (`hooks/`): Shell scripts that integrate with Claude Code's hook system.

## How to Contribute

### Bug Reports

Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Your environment (OS, Node.js version)

### Feature Requests

Open an issue describing:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

### Pull Requests

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make your changes
3. Test locally (both frontend and backend)
4. Commit with clear messages
5. Push and open a PR

## Code Style

- JavaScript/JSX with ES modules
- Functional React components with hooks
- Descriptive variable names
- Comments for non-obvious logic

## Areas We Need Help

- **Importers**: Add support for more AI platforms (ChatGPT, Gemini, etc.)
- **DIKW Engine**: Improve transformation quality and add custom rules
- **Visualization**: Better graph layouts, clustering, and search
- **Testing**: Unit tests and integration tests
- **Documentation**: Tutorials, guides, and examples

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
