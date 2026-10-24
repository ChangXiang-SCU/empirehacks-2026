# Mnemosyne v2 · self-hosted remote memory

Mnemosyne runs as one small service on a Linux server and is used by every AI tool as a remote MCP server.

```
 your PCs                              server (Linux, Caddy in front)
 ┌──────────────────────┐   HTTPS    ┌──────────────────────────────────────────┐
 │ collector/            │──────────▶│ Caddy  /<secret>/*  ─▶ mnemosyne :3006    │
 │ mnemo-collector.mjs   │ /api/ingest│        (loopback only)                   │
 └──────────────────────┘            │ private network ─▶ Mind Palace UI :3006  │
 claude.ai custom connector,         │ mnemosyne.service (node, sql.js DB,      │
 Claude Code, Codex ─ /<secret>/mcp ▶│   DIKW distillation via any OpenAI-      │
 bots on the same host ─ loopback ──▶│   compatible LLM)                        │
                                     └──────────────────────────────────────────┘
```

- **MCP**: Streamable HTTP, stateless, `POST <public url>/<secret>/mcp`.
  Tools: `search_memory`, `recent_activity`, `list_projects`, `get_project_context`, `get_node`, `record_learning`, `export_skill`.
- **Credential**: a random 48-hex secret in the URL path, generated on first deploy and kept in `/etc/mnemosyne/env` (root, 600).
  Configure Caddy to redact URIs in its access log. Rotate = change the secret, re-run `deploy.sh`, update clients.
- **Ingest**: the collector scans Claude Code (`~/.claude/projects`), Cowork local sessions (`local-agent-mode-sessions/**/audit.jsonl`),
  Codex rollouts and Codex's SQLite store (`~/.codex/state_N.sqlite` + `thread_history_N.sqlite`, rebuilt per thread as rollout JSONL,
  keyed `codex-sqlite:<id>`; the server never lets these shrink a stored session). A transcript is uploaded (gzip, tool output stripped)
  once it has been idle 10 minutes. The server replaces that session's raw turns; sessions active in the last 14 days are distilled
  (D→I→K→W) a few minutes later. Scheduled-task runs are stored but not distilled.
- **UI**: bind the Mind Palace to a private interface only (e.g. a Tailscale address via `BIND_HOSTS`).

## Claude Projects
The collector also sends Claude desktop's Project list (`local-agent-mode-sessions/<account>/<org>/spaces.json`: name, claude.ai
project uuids, linked folders) to `POST /<secret>/api/spaces`. A session is filed under a Project when its working directory is inside
one of the Project's folders, or otherwise when the transcript keeps touching a Project folder (Cowork mounts them at
`/sessions/<x>/mnt/<folder>`; a path inside a deeper Project folder only counts for that one). `list_projects` with no arguments lists
Projects; `get_project_context`, `search_memory` and `record_learning` accept a Project name.

## Install

Server (Ubuntu, Node 20+, Caddy with an existing HTTPS site block that ends in `handle { respond 404 }`):

1. Put the site settings in `/etc/mnemosyne/deploy.env` (not in git):
   `MNEMO_CADDY_SITE=<caddy site address>` and `MNEMO_PUBLIC_URL=<public base url>`.
2. Build the bundle from the repo root and copy it to the server's home directory:
   `tar czf mnemo-deploy.tgz --exclude=node_modules --exclude=dist backend/server.js backend/package*.json backend/lib backend/db/schema.sql backend/db/seedData.js frontend/package*.json frontend/index.html frontend/vite.config.js frontend/src collector/mnemo-collector.mjs deploy/mnemosyne.service deploy/deploy.sh`
   (optionally also `mnemo-db.sqlite` to migrate an existing DB and `mnemo-openai.env` with `OPENAI_API_KEY=`).
3. `bash deploy.sh` (extract it from the bundle first). It is idempotent: code is replaced, secret and DB are kept.
4. Optional: `deploy/server-collector.sh <user>[:<platform>[:nodikw]] ...` uploads other local users' sessions over loopback.

Each PC:

1. `~/.mnemosyne/collector.json` → `{ "endpoint": "<public url>/<secret>" }`
2. `python deploy/setup-clients.py` (points Codex at the remote MCP, removes the old local stdio server and hook)
3. Windows: `deploy\install-collector.ps1` (starts the collector now and at logon). Status: `node collector/mnemo-collector.mjs --status`.
4. claude.ai → Customize → Connectors → add custom connector with `<public url>/<secret>/mcp` (no auth).

## Bot transcripts
Chat bots that run Claude Code behind a channel server (incoming messages arrive as `<channel>` meta events, replies are `*_reply`
tool calls) look empty to the normal importer. Give such a source `"transform": "wxbot"` in `extraSources`; the collector rebuilds each
session as plain user/assistant turns (system and history-replay messages dropped, busy-time `queued_command` messages kept) and uploads
it under the source's `platform`. `--once --dry` previews what would be uploaded. Site-specific install scripts are kept out of git.

## Ops

| what | command (on the server) |
|---|---|
| status / logs | `systemctl status mnemosyne` · `journalctl -u mnemosyne -f` |
| upgrade | rebuild the bundle, copy it over, `bash deploy.sh` |
| backup DB | `sudo cp /var/lib/mnemosyne/mnemosyne.db ~/mnemosyne-$(date +%F).db` |
| switch LLM | add `MNEMO_LLM_BASE_URL`, `MNEMO_LLM_MODEL`, `MNEMO_LLM_API_KEY` to `/etc/mnemosyne/env` (any OpenAI-compatible server) |
