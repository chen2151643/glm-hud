// launcher.mjs — stable-path forwarder for the glm-hud statusline.
//
// /glm-hud:setup copies this file to <config dir>/plugins/glm-hud/statusline.mjs
// and points settings.json at that copy, so the statusLine command survives
// plugin updates: at every render it scans the plugin cache and runs the
// newest installed glm-hud, so updating the plugin never needs setup again.
//
// It consumes no stdin itself — the imported statusline reads the statusline
// JSON payload from fd 0, prints at most two lines and always exits 0.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Same resolution rule as scripts/setup.mjs: $CLAUDE_CONFIG_DIR (tilde ok), else ~/.claude
function configDir() {
  const env = process.env.CLAUDE_CONFIG_DIR;
  if (env && env.length) return env.startsWith('~') ? join(homedir(), env.slice(1)) : env;
  return join(homedir(), '.claude');
}

const parseVersion = (name) => {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(name);
  return m ? m.slice(1).map(Number) : null;
};
const newer = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]);

let latest = null;
try {
  const cacheDir = join(configDir(), 'plugins', 'cache');
  for (const marketplace of readdirSync(cacheDir)) {
    const pluginDir = join(cacheDir, marketplace, 'glm-hud');
    let versions = [];
    try { versions = readdirSync(pluginDir); } catch { continue; }
    for (const name of versions) {
      const version = parseVersion(name);
      if (!version || (latest && !newer(version, latest.version))) continue;
      const file = join(pluginDir, name, 'statusline.mjs');
      if (existsSync(file)) latest = { version, file };
    }
  }
} catch { /* no cache dir — fall through to the clone path */ }

// No plugin install found: fall back to the documented git-clone location.
const file = latest ? latest.file : join(configDir(), 'glm-hud', 'statusline.mjs');

if (!existsSync(file)) {
  process.exitCode = 0; // nothing installed — stay silent, like the prompt never happened
} else {
  try {
    await import(file); // the HUD itself: reads stdin, renders, always exits 0
  } catch {
    try { process.stdout.write('\x1b[0m[hud]\x1b[0m\n'); } catch { /* noop */ }
  }
  process.exitCode = 0;
}
