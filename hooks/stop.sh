#!/bin/bash
# Mnemosyne \u2014 Claude Code Stop Hook
# When a session ends, triggers D\u2192I transformation on accumulated Data nodes.
#
# Install: Copy to ~/.claude/hooks/stop.sh

MNEMOSYNE_URL="${MNEMOSYNE_URL:-http://localhost:3001}"
SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%Y%m%d_%H%M%S)}"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Trigger D\u2192I reflection
curl -s -X POST "${MNEMOSYNE_URL}/api/hook/session-end" \
  -H "Content-Type: application/json" \
  -d "{
    \"session\": \"${SESSION_ID}\",
    \"timestamp\": \"${TIMESTAMP}\"
  }" \
  > /dev/null 2>&1

echo "[Mnemosyne] Session reflection triggered for ${SESSION_ID}"
exit 0
