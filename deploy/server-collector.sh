#!/bin/bash
# Run the collector on the Mnemosyne server itself, uploading other local users' Claude Code / Cowork sessions
# over loopback.  Usage: server-collector.sh <user>[:<platform>[:nodikw]] ...
#   e.g. server-collector.sh alice bob:claude-code:nodikw
# Idempotent; needs /opt/mnemosyne/collector from deploy.sh. Writes /var/lib/mnemo-collector/collector.json.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: $0 <user>[:<platform>[:nodikw]] ..."; exit 1; }
NODE=$(readlink -f "$(command -v node)")
SEC=$(sudo grep '^MNEMO_SECRET=' /etc/mnemosyne/env | cut -d= -f2)
PORT=$(sudo grep '^PORT=' /etc/mnemosyne/env | cut -d= -f2); PORT=${PORT:-3006}
sudo mkdir -p /var/lib/mnemo-collector
sudo python3 - "$SEC" "$PORT" "$@" <<'PY'
import json, sys
sec, port, specs = sys.argv[1], sys.argv[2], sys.argv[3:]
roots = []
for spec in specs:
    user, platform, flag = (spec.split(':') + ['claude-code', ''])[:3]
    home = f'/home/{user}'
    roots.append({'platform': platform or 'claude-code', 'root': f'{home}/.claude/projects', 'kind': 'jsonl', 'dikw': flag != 'nodikw'})
    roots.append({'platform': 'cowork', 'root': f'{home}/.config/Claude/local-agent-mode-sessions', 'kind': 'audit'})
cfg = {'endpoint': f'http://127.0.0.1:{port}/{sec}', 'idleMinutes': 10, 'dikwDays': 14, 'defaultSources': False, 'roots': roots}
json.dump(cfg, open('/var/lib/mnemo-collector/collector.json', 'w'), indent=1)
PY
sudo chmod 700 /var/lib/mnemo-collector && sudo chmod 600 /var/lib/mnemo-collector/collector.json
sudo tee /etc/systemd/system/mnemo-collector.service >/dev/null <<EOF
[Unit]
Description=Mnemosyne collector (this server's Claude Code / Cowork sessions)
After=mnemosyne.service

[Service]
Environment=MNEMO_COLLECTOR_DIR=/var/lib/mnemo-collector NODE_NO_WARNINGS=1
ExecStart=$NODE /opt/mnemosyne/collector/mnemo-collector.mjs --quiet
Restart=always
RestartSec=30
Nice=10
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/mnemo-collector
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable mnemo-collector >/dev/null 2>&1
sudo systemctl restart mnemo-collector
sleep 20
echo "collector: $(systemctl is-active mnemo-collector)"
sudo tail -n 6 /var/lib/mnemo-collector/collector.log 2>/dev/null || true
