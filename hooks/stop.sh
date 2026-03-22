#!/bin/bash
# Mnemosyne — Claude Code Stop Hook (v2)
# Captures the assistant's final response text + triggers DIKW transformation
# The Stop hook receives last_assistant_message in the JSON payload
#
# Install: Add to Claude Code hooks config in settings.json

MNEMOSYNE_URL="${MNEMOSYNE_URL:-http://localhost:3001}"

# Read full JSON payload from stdin
INPUT=$(cat)

# Extract fields
if command -v jq &>/dev/null; then
  SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
  LAST_MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // empty')
  CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
  TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
else
  eval "$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(f'SESSION_ID=\"{d.get(\"session_id\", \"\")}\"')
    # Escape the message for shell safety
    msg = d.get('last_assistant_message', '')
    print(f'LAST_MSG_B64=\"{__import__(\"base64\").b64encode(msg.encode()).decode()}\"')
    print(f'CWD=\"{d.get(\"cwd\", \"\")}\"')
    print(f'TRANSCRIPT_PATH=\"{d.get(\"transcript_path\", \"\")}\"')
except: pass
" 2>/dev/null)"
  if [ -n "$LAST_MSG_B64" ]; then
    LAST_MSG=$(echo "$LAST_MSG_B64" | base64 -d 2>/dev/null)
  fi
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

PROJECT=""
if [ -n "$CWD" ]; then
  PROJECT=$(basename "$CWD")
fi

# Step 1: If there's a final assistant message, save it as a D node
if [ -n "$LAST_MSG" ] && [ ${#LAST_MSG} -gt 50 ]; then
  # Use python3 to safely JSON-encode the message
  PAYLOAD=$(python3 -c "
import json, sys
msg = sys.stdin.read()
print(json.dumps({
    'tool': '__assistant_response__',
    'input': {'text': msg[:8000]},
    'output': None,
    'session': '${SESSION_ID}',
    'project': '${PROJECT}',
    'timestamp': '${TIMESTAMP}',
    'transcriptPath': '${TRANSCRIPT_PATH}'
}))
" <<< "$LAST_MSG" 2>/dev/null)

  if [ -n "$PAYLOAD" ]; then
    curl -s -X POST "${MNEMOSYNE_URL}/api/hook/tool-use" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" > /dev/null 2>&1
  fi
fi

# Step 2: Trigger session-end DIKW transformation
curl -s -X POST "${MNEMOSYNE_URL}/api/hook/session-end" \
  -H "Content-Type: application/json" \
  -d "{
    \"session\": \"${SESSION_ID}\",
    \"project\": \"${PROJECT}\",
    \"timestamp\": \"${TIMESTAMP}\"
  }" > /dev/null 2>&1

echo "[Mnemosyne] Session reflection triggered for ${SESSION_ID}"
exit 0
