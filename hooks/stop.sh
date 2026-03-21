#!/bin/bash
# Claude Code Stop hook
# Triggers D→I reflection when session ends

SESSION_ID="${CLAUDE_SESSION_ID:-unknown}"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Notify backend to trigger DIKW transformation
curl -s -X POST http://localhost:3001/api/hook/session-end \
  -H "Content-Type: application/json" \
  -d "{\"session\": \"$SESSION_ID\", \"timestamp\": \"$TIMESTAMP\"}" \
  > /dev/null 2>&1

echo "Session reflection triggered for $SESSION_ID"
exit 0
