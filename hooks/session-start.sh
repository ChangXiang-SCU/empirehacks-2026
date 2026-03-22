#!/bin/bash
# Mnemosyne — Claude Code Session Start Hook
# Loads relevant Knowledge and Wisdom context when a new session begins.
# This gives the agent "memory" of past learnings.
#
# Install: Copy to ~/.claude/hooks/session-start.sh

MNEMOSYNE_URL="${MNEMOSYNE_URL:-http://localhost:3001}"
PROJECT_HINT="${1:-}"

# Fetch Knowledge nodes (skills) relevant to this session
if [ -n "$PROJECT_HINT" ]; then
  KNOWLEDGE=$(curl -s "${MNEMOSYNE_URL}/api/nodes?type=K&project=${PROJECT_HINT}" 2>/dev/null)
  WISDOM=$(curl -s "${MNEMOSYNE_URL}/api/nodes?type=W&project=${PROJECT_HINT}" 2>/dev/null)
else
  KNOWLEDGE=$(curl -s "${MNEMOSYNE_URL}/api/nodes?type=K" 2>/dev/null)
  WISDOM=$(curl -s "${MNEMOSYNE_URL}/api/nodes?type=W" 2>/dev/null)
fi

# Output context for Claude to read
if [ ! -z "$KNOWLEDGE" ] && [ "$KNOWLEDGE" != "[]" ]; then
  echo "# Mnemosyne Knowledge Context"
  echo "## Skills from past sessions:"
  echo "$KNOWLEDGE" | python3 -c "
import sys, json
try:
    nodes = json.load(sys.stdin)
    for n in nodes[:5]:
        print(f\"- {n.get('content', '')[:200]}\")
except: pass
" 2>/dev/null
fi

if [ ! -z "$WISDOM" ] && [ "$WISDOM" != "[]" ]; then
  echo ""
  echo "## Wisdom (meta-judgment):"
  echo "$WISDOM" | python3 -c "
import sys, json
try:
    nodes = json.load(sys.stdin)
    for n in nodes[:3]:
        print(f\"- {n.get('content', '')[:200]}\")
except: pass
" 2>/dev/null
fi

exit 0
