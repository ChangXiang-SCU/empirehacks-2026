#!/bin/bash
# Mnemosyne — Claude Code PostToolUse Hook (v2)
# Reads rich JSON from stdin (Claude Code hooks API)
# Captures tool_name, tool_input (structured), tool_response
#
# Install: Add to Claude Code hooks config in settings.json

MNEMOSYNE_URL="${MNEMOSYNE_URL:-http://localhost:3001}"

# Read full JSON payload from stdin
INPUT=$(cat)

# Extract fields using jq (or python3 fallback)
if command -v jq &>/dev/null; then
  SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
  TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
  TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // {}')
  TOOL_RESPONSE=$(echo "$INPUT" | jq -c '.tool_response // null')
  TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
  CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
else
  # Python3 fallback
  eval "$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(f'SESSION_ID=\"{d.get(\"session_id\", \"\")}\"')
    print(f'TOOL_NAME=\"{d.get(\"tool_name\", \"\")}\"')
    print(f'TOOL_INPUT={json.dumps(json.dumps(d.get(\"tool_input\", {})))}')
    print(f'TOOL_RESPONSE={json.dumps(json.dumps(d.get(\"tool_response\", None)))}')
    print(f'TRANSCRIPT_PATH=\"{d.get(\"transcript_path\", \"\")}\"')
    print(f'CWD=\"{d.get(\"cwd\", \"\")}\"')
except: pass
" 2>/dev/null)"
fi

[ -z "$TOOL_NAME" ] && exit 0

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Derive project name from cwd
PROJECT=""
if [ -n "$CWD" ]; then
  PROJECT=$(basename "$CWD")
fi

# Send rich structured data to Mnemosyne backend (non-blocking)
curl -s -X POST "${MNEMOSYNE_URL}/api/hook/tool-use" \
  -H "Content-Type: application/json" \
  -d @- > /dev/null 2>&1 <<PAYLOAD &
{
  "tool": "${TOOL_NAME}",
  "input": ${TOOL_INPUT},
  "output": ${TOOL_RESPONSE:-null},
  "session": "${SESSION_ID}",
  "project": "${PROJECT}",
  "timestamp": "${TIMESTAMP}",
  "transcriptPath": "${TRANSCRIPT_PATH}"
}
PAYLOAD

exit 0
