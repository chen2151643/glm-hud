#!/usr/bin/env sh
# glm-hud installer — clones nothing (you already cloned this repo), just wires
# the statusLine block into ~/.claude/settings.json (macOS & Linux, idempotent).
# Equivalent to the /glm-hud:setup plugin command: same statusLine block
# (refreshInterval 60 included), timestamped backup, and it asks before
# replacing a third-party statusLine (--force to skip the prompt).
set -eu

SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# q — shell-quote anything outside a clearly safe character set, so install
# paths with spaces survive in the statusLine command (same rule as setup.mjs,
# which quotes only when needed).
q() {
  case "$1" in
    *[![:alnum:]/._-]*)
      printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")" ;;
    *) printf '%s' "$1" ;;
  esac
}
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

NODE_BIN=$(command -v node 2>/dev/null) || { echo "error: node (>=20) is required"; exit 1; }
NODE_MAJOR=$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || { echo "error: node >= 20 required, got $("$NODE_BIN" --version)"; exit 1; }

# Absolute node path + quoted hud path: matches scripts/setup.mjs, so a later
# /glm-hud:setup and this script produce the same command. If the runtime
# later moves (nvm/mise/asdf), re-run either installer.
CMD="$(q "$NODE_BIN") $(q "$HERE/statusline.mjs")"

mkdir -p "$(dirname "$SETTINGS")"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

CLAUDE_SETTINGS="$SETTINGS" HUD_CMD="$CMD" FORCE="$FORCE" node - <<'NODEEOF'
const fs = require('fs');
const path = process.env.CLAUDE_SETTINGS;
const cmd = process.env.HUD_CMD;
let settings;
try {
  settings = JSON.parse(fs.readFileSync(path, 'utf8'));
} catch (e) {
  console.error('error: ' + path + ' is not valid JSON (' + e.message + ')');
  console.error('fix or remove that file first, then re-run this script.');
  process.exit(1);
}
const prev = settings.statusLine && settings.statusLine.command;
const ours = !prev || String(prev).includes('glm-hud');
if (!ours && process.env.FORCE !== '1') {
  if (process.stdin.isTTY) {
    process.stdout.write('existing statusLine found:\n  ' + prev + '\nReplace it with glm-hud? [y/N] ');
    const answer = fs.readFileSync(0, 'utf8').trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') { console.log('kept your current statusLine, changed nothing.'); process.exit(0); }
  } else {
    console.error('existing (non-glm-hud) statusLine found: ' + prev);
    console.error('re-run with --force to replace it (a timestamped backup is kept either way).');
    process.exit(1);
  }
}
const backup = path + '.backup-' + new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(path, backup);
settings.statusLine = { type: 'command', command: cmd, refreshInterval: 60 };
const tmp = path + '.' + process.pid + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
fs.renameSync(tmp, path);
console.log(prev === cmd ? 'statusLine already wired: ' + cmd
  : prev ? 'statusLine updated: ' + prev + '  ->  ' + cmd
         : 'statusLine added: ' + cmd);
console.log('backup: ' + backup);
NODEEOF

echo "done. the HUD shows up below your input after your next message (restart Claude Code if it doesn't)."
echo "uninstall: sh '$(dirname "$0")/uninstall.sh'"
