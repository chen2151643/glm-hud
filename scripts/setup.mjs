#!/usr/bin/env node
// setup.mjs — two-phase installer behind /glm-hud:setup (claude-hud-style).
// Zero dependencies, POSIX only (macOS / Linux; WSL counts as Linux).
//
//   inspect                            print a JSON report; touches nothing
//   install --launcher <file> [--force]
//                                      copy the launcher to a stable path,
//                                      back up settings.json, write statusLine
//                                      (keeping every other key), print JSON.
//
// Exit codes: 0 ok · 2 bad usage / unreadable settings · 3 existing third-party
// statusLine needs user confirmation (re-run with --force after asking).
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Same resolution rule as scripts/launcher.mjs: $CLAUDE_CONFIG_DIR (tilde ok), else ~/.claude
function configDir() {
  const env = process.env.CLAUDE_CONFIG_DIR;
  if (env && env.length) return env.startsWith('~') ? join(homedir(), env.slice(1)) : env;
  return join(homedir(), '.claude');
}

const quote = (s) => (/\s/.test(s) ? JSON.stringify(s) : s);

function redact(command) {
  // Redacted preview for the conversation — the raw command may contain secrets.
  const preview = String(command)
    .replace(/\b(Bearer)\s+["']?[^"'\s]+/gi, '$1 [REDACTED]')
    .replace(/\b(Authorization\s*:\s*)["']?[^"'\s]+/gi, '$1[REDACTED]')
    .replace(/\b(token|api[_-]?key|secret|password|pass|auth)(=|:)\s*["']?[^"'\s]+/gi, '$1$2[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{8,}\b/g, '[GITHUB_TOKEN_REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
  return preview.length > 160 ? preview.slice(0, 157) + '...' : preview;
}

function readSettings(settingsPath) {
  let raw;
  try {
    raw = readFileSync(settingsPath, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { settings: {} };
    return { error: e.message };
  }
  try {
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { error: 'top-level value must be a JSON object' };
    return { settings: s };
  } catch (e) {
    return { error: e.message };
  }
}

const settingsPath = join(configDir(), 'settings.json');
const launcherDest = () => join(configDir(), 'plugins', 'glm-hud', 'statusline.mjs');
const buildCommand = (launcher) => `${quote(process.execPath)} ${quote(launcher)}`;

function failInvalidSettings(message) {
  console.error(`error: ${settingsPath} is not usable (${message}) — fix or remove it first, then re-run /glm-hud:setup. Do not edit settings.json by hand as part of setup.`);
  process.exit(2);
}

function inspect() {
  const { settings, error } = readSettings(settingsPath);
  if (error) failInvalidSettings(error);
  const prev = settings && settings.statusLine && settings.statusLine.command;
  const existing = !prev ? 'none' : String(prev).includes('glm-hud') ? 'glm-hud' : 'other';
  console.log(JSON.stringify(
    { settingsPath, command: buildCommand(launcherDest()), existing, existingPreview: prev ? redact(prev) : null },
    null,
    2,
  ));
}

function install(args) {
  const idx = args.indexOf('--launcher');
  const launcherSrc = idx >= 0 ? resolve(args[idx + 1]) : null;
  if (!launcherSrc || !existsSync(launcherSrc)) {
    console.error('usage: setup.mjs install --launcher <path/to/launcher.mjs> [--force]');
    process.exit(2);
  }
  const force = args.includes('--force');

  const { settings, error } = readSettings(settingsPath);
  if (error) failInvalidSettings(error);

  const prev = settings.statusLine && settings.statusLine.command;
  const ours = !prev || String(prev).includes('glm-hud');
  if (!ours && !force) {
    console.log(JSON.stringify({ needsConfirmation: true, existingPreview: redact(prev) }, null, 2));
    process.exit(3);
  }

  // 配置目录可能不存在（自定义 CLAUDE_CONFIG_DIR 指向新路径）——先建好再写 settings.json
  mkdirSync(join(settingsPath, '..'), { recursive: true });

  // Stable-path launcher: settings.json points here, never into the versioned
  // plugin cache, so plugin updates never need setup again.
  const hudDir = launcherDest().slice(0, launcherDest().lastIndexOf('/'));
  mkdirSync(hudDir, { recursive: true });
  copyFileSync(launcherSrc, launcherDest());

  let backupPath = null;
  if (existsSync(settingsPath)) {
    backupPath = `${settingsPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    copyFileSync(settingsPath, backupPath);
  }

  let previousPath = null;
  if (prev && prev !== buildCommand(launcherDest())) {
    previousPath = join(hudDir, 'previous-statusline.txt');
    writeFileSync(previousPath, String(prev) + '\n', { mode: 0o600 });
  }

  settings.statusLine = { type: 'command', command: buildCommand(launcherDest()), refreshInterval: 60 };

  let mode = null;
  try { mode = statSync(settingsPath).mode & 0o777; } catch { /* new file — umask decides */ }
  const tmp = `${settingsPath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', mode ? { mode } : undefined);
  if (mode) { try { chmodSync(tmp, mode); } catch { /* umask fallback is fine */ } }
  renameSync(tmp, settingsPath);

  console.log(JSON.stringify(
    { ok: true, settingsPath, command: settings.statusLine.command, launcher: launcherDest(), backupPath, previousPath },
    null,
    2,
  ));
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'inspect') inspect();
else if (cmd === 'install') install(rest);
else {
  console.error('usage: setup.mjs inspect | install --launcher <launcher.mjs> [--force]');
  process.exit(2);
}
