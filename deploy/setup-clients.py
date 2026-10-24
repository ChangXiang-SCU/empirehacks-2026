# Point this laptop's AI clients at the cloud Mnemosyne. Run with: python setup-clients.py
import json, os, re, shutil, time
H = os.path.expanduser('~'); stamp = time.strftime('%Y%m%d-%H%M')
cfg = json.load(open(os.path.join(H, '.mnemosyne', 'collector.json'), encoding='utf-8'))
mcp_url = cfg['endpoint'].rstrip('/') + '/mcp'
def backup(p):
    b = f'{p}.bak-{stamp}-mnemo'; shutil.copy2(p, b); return b

# 1. Claude Desktop: drop the old stdio proxy (the claude.ai connector replaces it)
p = os.path.join(os.environ['APPDATA'], 'Claude', 'claude_desktop_config.json')
if os.path.exists(p):
    d = json.load(open(p, encoding='utf-8'))
    if 'mnemosyne' in d.get('mcpServers', {}):
        backup(p); d['mcpServers'].pop('mnemosyne')
        json.dump(d, open(p, 'w', encoding='utf-8'), indent=2, ensure_ascii=False); print('desktop: removed stdio mnemosyne')
    else: print('desktop: nothing to change')

# 2. Claude Code: drop the old Stop hook that posted to localhost:3001 (the collector uploads transcripts now)
p = os.path.join(H, '.claude', 'settings.json')
if os.path.exists(p):
    d = json.load(open(p, encoding='utf-8')); changed = False
    for ev, groups in list((d.get('hooks') or {}).items()):
        keep = []
        for g in groups:
            hs = [h for h in g.get('hooks', []) if 'empirehacks-2026' not in h.get('command', '')]
            if len(hs) != len(g.get('hooks', [])): changed = True
            if hs: g['hooks'] = hs; keep.append(g)
        if keep: d['hooks'][ev] = keep
        else: d['hooks'].pop(ev); changed = True
    if changed:
        backup(p); json.dump(d, open(p, 'w', encoding='utf-8'), indent=2, ensure_ascii=False); print('claude code: removed old mnemosyne hooks')
    else: print('claude code: no old hooks')

# 3. Codex: replace the stdio entry with the remote URL
p = os.path.join(H, '.codex', 'config.toml')
if os.path.exists(p):
    s = open(p, encoding='utf-8').read()
    new_block = f'[mcp_servers.mnemosyne]\nurl = "{mcp_url}"\n'
    pat = re.compile(r'^\[mcp_servers\.mnemosyne(\.[^\]]+)?\]\n(?:(?!^\[).*\n?)*', re.M)
    if pat.search(s):
        s2 = pat.sub('', s); s2 = s2.rstrip('\n') + '\n\n' + new_block
    else:
        s2 = s.rstrip('\n') + '\n\n' + new_block
    if s2 != s:
        backup(p); open(p, 'w', encoding='utf-8').write(s2); print('codex: mnemosyne -> remote url')
