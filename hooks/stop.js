#!/usr/bin/env node
// Mnemosyne — Claude Code Stop Hook (v3 — Batch Import)
// Waits until session ends, reads full transcript JSONL,
// batch-creates all D nodes, then triggers DIKW pipeline.
// No real-time noise — all data arrives at once like Codex.

const http = require('http');
const fs = require('fs');
const path = require('path');

const MNEMOSYNE_URL = process.env.MNEMOSYNE_URL || 'http://localhost:3001';

function httpPost(urlPath, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const url = new URL(MNEMOSYNE_URL + urlPath);
    const options = {
      hostname: url.hostname,
      port: url.port || 3001,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 30000
    };
    const req = http.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

// Format tool content (mirrors server.js formatToolContent)
function formatToolContent(tool, input, output) {
  if (tool === '__assistant_response__') {
    return (input?.text || '').slice(0, 8000);
  }
  const parts = [tool || 'unknown'];
  if (!input) input = {};

  // Tool-specific input formatting
  if (input.command) parts.push(': $ ' + input.command.slice(0, 300));
  else if (input.pattern) parts.push(': grep ' + input.pattern.slice(0, 120));
  else if (input.file_path) parts.push(': ' + input.file_path.split(/[/\\]/).pop());
  else if (input.query) parts.push(': ' + JSON.stringify(input.query).slice(0, 200));
  else if (input.url) parts.push(': fetch ' + input.url.slice(0, 120));

  // Rich output capture
  if (output != null) {
    const o = typeof output === 'string' ? output.trim()
            : typeof output === 'object' ? JSON.stringify(output) : String(output);
    if (tool === 'WebSearch' || tool === 'WebFetch') {
      parts.push('\n--- Result ---\n' + o.slice(0, 3000));
    } else if (tool === 'Read') {
      if (o.length < 3000) parts.push('\n' + o.slice(0, 2000));
    } else if (tool === 'Bash') {
      parts.push('\n-> ' + o.slice(0, 1000));
    } else if (o.length < 500) {
      parts.push('\n-> ' + o.slice(0, 500));
    }
  }
  return parts.join('');
}

// Parse transcript JSONL and extract tool calls + assistant messages
function parseTranscript(jsonlContent) {
  const entries = [];
  const lines = jsonlContent.trim().split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }

    // Extract assistant text messages
    if (event.type === 'assistant' && event.message?.content) {
      const textParts = Array.isArray(event.message.content)
        ? event.message.content.filter(c => c.type === 'text').map(c => c.text || '').filter(t => t.length > 0)
        : typeof event.message.content === 'string' ? [event.message.content] : [];
      const text = textParts.join('\n');
      if (text.length > 50) {
        entries.push({ type: 'assistant', tool: '__assistant_response__',
          input: { text }, output: null, ts: event.timestamp });
      }

      // Extract tool_use from assistant messages
      if (Array.isArray(event.message.content)) {
        for (const block of event.message.content) {
          if (block.type === 'tool_use') {
            entries.push({ type: 'tool_use', tool: block.name,
              input: block.input || {}, output: null, ts: event.timestamp,
              toolUseId: block.id });
          }
        }
      }
    }

    // Extract tool_result
    if (event.type === 'user' && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          // Find matching tool_use and attach output
          const match = entries.find(e => e.toolUseId === block.tool_use_id);
          if (match) {
            const resultText = Array.isArray(block.content)
              ? block.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
              : typeof block.content === 'string' ? block.content : '';
            match.output = resultText;
          }
        }
      }
    }
  }
  return entries;
}

// Main: read stdin, parse transcript, batch send
let chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', async () => {
  try {
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw.trim()) process.exit(0);
    const data = JSON.parse(raw);

    const sessionId = data.session_id || '';
    const cwd = data.cwd || '';
    const project = cwd ? cwd.replace(/\\/g, '/').split('/').pop() : '';
    const transcriptPath = data.transcript_path || '';

    // Read the full transcript JSONL
    let entries = [];
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      const content = fs.readFileSync(transcriptPath, 'utf8');
      entries = parseTranscript(content);
    }

    // If no transcript, try last_assistant_message as fallback
    if (entries.length === 0) {
      const lastMsg = data.last_assistant_message || '';
      if (lastMsg.length > 50) {
        entries.push({ type: 'assistant', tool: '__assistant_response__',
          input: { text: lastMsg }, output: null });
      }
    }

    if (entries.length === 0) process.exit(0);

    // Filter to meaningful entries: tool calls + final assistant response
    const toolEntries = entries.filter(e => e.type === 'tool_use');
    const assistantEntries = entries.filter(e => e.type === 'assistant');
    // Use last assistant message only (the final response)
    const lastAssistant = assistantEntries.length > 0
      ? [assistantEntries[assistantEntries.length - 1]] : [];
    const toSend = [...toolEntries, ...lastAssistant];

    // Batch send all D nodes concurrently (don't await one by one)
    const sendPromises = [];
    for (const entry of toSend) {
      const content = formatToolContent(entry.tool, entry.input, entry.output);
      if (content.length < 20) continue;

      sendPromises.push(httpPost('/api/hook/tool-use', {
        tool: entry.tool,
        input: entry.input,
        output: entry.output,
        session: sessionId,
        project: project,
        timestamp: entry.ts || new Date().toISOString(),
        transcriptPath: transcriptPath,
        skipAutoTransform: true  // Don't trigger per-node DIKW
      }));
    }
    await Promise.all(sendPromises);

    // Server-side debounce will auto-trigger DIKW pipeline
    // 2 seconds after last D node arrives — no need for session-end call
    process.exit(0);
  } catch (e) {
    process.exit(0);
  }
});
