#!/usr/bin/env sh
# glm-hud installer — clones nothing (you already cloned this repo), just wires
# the statusLine block into ~/.claude/settings.json (macOS & Linux, idempotent).
set -eu

SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CMD="node $HERE/statusline.mjs"

command -v node >/dev/null 2>&1 || { echo "error: node (>=20) is required"; exit 1; }
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || { echo "error: node >= 20 required, got $(node --version)"; exit 1; }

mkdir -p "$(dirname "$SETTINGS")"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

if command -v node >/dev/null 2>&1; then
  CLAUDE_SETTINGS="$SETTINGS" HUD_CMD="$CMD" node - <<'NODEEOF'
const fs = require('fs');
const path = process.env.CLAUDE_SETTINGS;
const cmd = process.env.HUD_CMD;
const settings = JSON.parse(fs.readFileSync(path, 'utf8'));
const prev = settings.statusLine && settings.statusLine.command;
settings.statusLine = { type: 'command', command: cmd };
fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
console.log(prev === cmd ? 'statusLine already wired: ' + cmd
  : prev ? 'statusLine updated: ' + prev + '  ->  ' + cmd
         : 'statusLine added: ' + cmd);
NODEEOF
fi

echo "done. restart Claude Code (new session) to load the statusline."
echo "uninstall: sh $(dirname "$0")/uninstall.sh"
