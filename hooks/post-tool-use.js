#!/usr/bin/env node
// Mnemosyne — Claude Code PostToolUse Hook (Node.js version)
// Reads rich JSON from stdin (Claude Code hooks API)
// Runs natively on Windows — no WSL/bash dependency

const http = require('http');

const MNEMOSYNE_URL = process.env.MNEMOSYNE_URL || 'http://localhost:3001';

let chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  try {
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw.trim()) process.exit(0);
    const data = JSON.parse(raw);

    const toolName = data.tool_name || '';
    if (!toolName) process.exit(0);

    const sessionId = data.session_id || '';
    const toolInput = data.tool_input || {};
    const toolResponse = data.tool_response || null;
    const transcriptPath = data.transcript_path || '';
    const cwd = data.cwd || '';

    const project = cwd ? cwd.replace(/\\/g, '/').split('/').pop() : '';
    const timestamp = new Date().toISOString();

    const payload = JSON.stringify({
      tool: toolName,
      input: toolInput,
      output: toolResponse,
      session: sessionId,
      project: project,
      timestamp: timestamp,
      transcriptPath: transcriptPath
    });

    const url = new URL(MNEMOSYNE_URL + '/api/hook/tool-use');
    const options = {
      hostname: url.hostname,
      port: url.port || 3001,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      res.resume(); // drain response
      process.exit(0);
    });
    req.on('error', () => process.exit(0));
    req.on('timeout', () => { req.destroy(); process.exit(0); });
    req.write(payload);
    req.end();
  } catch (e) {
    // Silently exit on any error — don't block Claude Code
    process.exit(0);
  }
});
