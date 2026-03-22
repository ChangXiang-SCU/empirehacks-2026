#!/bin/bash
# Mnemosyne — Claude Code PostToolUse Hook
# Captures every tool call as a Data node in the knowledge graph.
#
# Install: Copy to ~/.claude/hooks/post-tool-use.sh
# The hook receives tool name and input via environment variables.

MNEMOSYNE_URL="${MNEMOSYNE_URL:-http://localhost:3001}"
TOOL_NAME="${CLAUDE_TOOL_NAME:-$1}"
TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"
SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%Y%m%d_%H%M%S)}"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Send to Mnemosyne backend (non-blocking)
curl -s -X POST "${MNEMOSYNE_URL}/api/hook/tool-use" \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"${TOOL_NAME}\",
    \"input\": \"${TOOL_INPUT}\",
    \"session\": \"${SESSION_ID}\",
    \"timestamp\": \"${TIMESTAMP}\"
  }" \
  > /dev/null 2>&1 &

exit 0
