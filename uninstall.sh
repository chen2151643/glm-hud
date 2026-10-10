#!/usr/bin/env sh
# glm-hud uninstaller — removes the statusLine block it added (leaves other keys).
set -eu
SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
[ -f "$SETTINGS" ] || { echo "no settings file, nothing to do"; exit 0; }
CLAUDE_SETTINGS="$SETTINGS" node - <<'NODEEOF'
const fs = require('fs');
const path = process.env.CLAUDE_SETTINGS;
const settings = JSON.parse(fs.readFileSync(path, 'utf8'));
if (settings.statusLine && String(settings.statusLine.command || '').includes('glm-hud')) {
  delete settings.statusLine;
  fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
  console.log('glm-hud statusLine removed.');
} else {
  console.log('statusLine is not glm-hud (or absent) — left untouched.');
}
NODEEOF
