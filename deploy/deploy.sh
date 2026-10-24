#!/bin/bash
# Deploy/upgrade Mnemosyne on a Linux server with Caddy. Idempotent.
# Expects ~/mnemo-deploy.tgz (code), optional ~/mnemo-db.sqlite (first install) and optional ~/mnemo-openai.env
# (OPENAI_API_KEY=...). Site settings come from /etc/mnemosyne/deploy.env (kept on the server, not in git):
#   MNEMO_CADDY_SITE=<site address of an existing Caddyfile block, e.g. 203-0-113-10.sslip.io:8443>
#   MNEMO_PUBLIC_URL=<public base URL that reaches that block, e.g. https://203-0-113-10.sslip.io>
set -euo pipefail
[ -f /etc/mnemosyne/deploy.env ] && . /etc/mnemosyne/deploy.env
: "${MNEMO_CADDY_SITE:?set MNEMO_CADDY_SITE in /etc/mnemosyne/deploy.env}"
: "${MNEMO_PUBLIC_URL:?set MNEMO_PUBLIC_URL in /etc/mnemosyne/deploy.env}"
NODE=$(readlink -f "$(command -v node)"); export PATH="$(dirname "$NODE"):$PATH"
PORT=3006; TS_IP=$(tailscale ip -4 2>/dev/null | head -1)
id mnemosyne >/dev/null 2>&1 || sudo useradd --system --home-dir /var/lib/mnemosyne --no-create-home --shell /usr/sbin/nologin mnemosyne
sudo mkdir -p /opt/mnemosyne /etc/mnemosyne /var/lib/mnemosyne
sudo rm -rf /opt/mnemosyne/backend/lib /opt/mnemosyne/frontend/src /opt/mnemosyne/collector
sudo tar --no-same-owner --no-same-permissions -xzf ~/mnemo-deploy.tgz -C /opt/mnemosyne
sudo chown -R root:root /opt/mnemosyne && sudo chmod -R u=rwX,go=rX /opt/mnemosyne
cd /opt/mnemosyne/backend && sudo env PATH="$PATH" npm ci --omit=dev --no-audit --no-fund --loglevel=error
cd /opt/mnemosyne/frontend && sudo env PATH="$PATH" npm ci --no-audit --no-fund --loglevel=error && sudo env PATH="$PATH" npx vite build --logLevel warn
if ! sudo test -f /etc/mnemosyne/env; then
  SECRET=$(openssl rand -hex 24)
  KEY=""; [ -f ~/mnemo-openai.env ] && KEY=$(grep -E '^OPENAI_API_KEY=' ~/mnemo-openai.env | head -1 | cut -d= -f2- | tr -d '\r"')
  printf 'PORT=%s\nBIND_HOSTS=127.0.0.1%s\nMNEMO_SECRET=%s\nMNEMO_WATCH=0\nOPENAI_API_KEY=%s\n' "$PORT" "${TS_IP:+,$TS_IP}" "$SECRET" "$KEY" | sudo tee /etc/mnemosyne/env >/dev/null
  sudo chmod 600 /etc/mnemosyne/env
fi
rm -f ~/mnemo-openai.env
if [ -f ~/mnemo-db.sqlite ] && ! sudo test -f /var/lib/mnemosyne/mnemosyne.db; then sudo install -m 600 ~/mnemo-db.sqlite /var/lib/mnemosyne/mnemosyne.db; fi
rm -f ~/mnemo-db.sqlite
sudo chown -R mnemosyne:mnemosyne /var/lib/mnemosyne; sudo chmod 700 /var/lib/mnemosyne
sed "s#__NODE__#$NODE#" /opt/mnemosyne/deploy/mnemosyne.service | sudo tee /etc/systemd/system/mnemosyne.service >/dev/null
sudo systemctl daemon-reload && sudo systemctl enable mnemosyne >/dev/null 2>&1 && sudo systemctl restart mnemosyne
SECRET=$(sudo grep '^MNEMO_SECRET=' /etc/mnemosyne/env | cut -d= -f2)
if ! sudo grep -q '@mnemo' /etc/caddy/Caddyfile; then
  sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%Y%m%d%H%M)-mnemo
  sudo python3 - "$SECRET" "$MNEMO_CADDY_SITE" <<'PY'
import sys
p='/etc/caddy/Caddyfile'; s=open(p).read(); sec, site = sys.argv[1], sys.argv[2]
i=s.index(site + ' {'); j=s.index('\thandle {\n\t\trespond 404', i)
block=f"\t@mnemo {{\n\t\tpath /{sec}/*\n\t}}\n\thandle @mnemo {{\n\t\treverse_proxy 127.0.0.1:3006\n\t}}\n"
open(p,'w').write(s[:j]+block+s[j:])
PY
  if sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then sudo systemctl reload caddy
  else echo "CADDY INVALID, restoring"; sudo cp "$(ls -t /etc/caddy/Caddyfile.bak-*-mnemo | head -1)" /etc/caddy/Caddyfile; exit 1; fi
fi
sleep 4
echo "service: $(systemctl is-active mnemosyne)"
sudo journalctl -u mnemosyne -n 8 --no-pager -o cat
echo "local health: $(curl -s http://127.0.0.1:$PORT/$SECRET/api/health)"
echo "public health: $(curl -s $MNEMO_PUBLIC_URL/$SECRET/api/health --max-time 10)"
echo "secret: in /etc/mnemosyne/env (MCP URL = $MNEMO_PUBLIC_URL/<secret>/mcp)"
