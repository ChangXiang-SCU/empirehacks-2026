#!/bin/bash
# Claude Code PostToolUse hook
# Logs tool call data to Mnemosyne backend for Data node creation

TOOL_NAME="$1"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SESSION_ID="${CLAUDE_SESSION_ID:-unknown}"

# Send to Mnemosyne backend
curl -s -X POST http://localhost:3001/api/hook/tool-use \
  -H "Content-Type: application/json" \
  -d "{\"tool\": \"$TOOL_NAME\", \"session\": \"$SESSION_ID\", \"timestamp\": \"$TIMESTAMP\"}" \
  > /dev/null 2>&1

exit 0
