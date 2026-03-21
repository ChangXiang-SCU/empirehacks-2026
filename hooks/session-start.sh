#!/bin/bash
# Claude Code session-start hook
# Loads relevant Knowledge and Wisdom context when session begins

SESSION_ID="${CLAUDE_SESSION_ID:-unknown}"
PROJECT_HINT="${1:-unknown}"

# Fetch relevant knowledge from Mnemosyne
KNOWLEDGE=$(curl -s -X GET "http://localhost:3001/api/nodes?type=K&project=$PROJECT_HINT" 2>/dev/null)

# Save to temporary context file if available
if [ ! -z "$KNOWLEDGE" ]; then
  CONTEXT_FILE="/tmp/mnemosyne_context_${SESSION_ID}.txt"
  echo "# Relevant Skills for this session:" > "$CONTEXT_FILE"
  echo "$KNOWLEDGE" >> "$CONTEXT_FILE"
  echo "Context loaded: $CONTEXT_FILE"
fi

exit 0
