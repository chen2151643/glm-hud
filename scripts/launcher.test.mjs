// launcher.test.mjs — runs scripts/launcher.mjs as a subprocess against
// throwaway CLAUDE_CONFIG_DIR fixtures, covering the candidate chain:
// newest-wins, newest-broken falls back, all-broken degrades to the [hud]
// sentinel, and the git-clone / nothing-installed fallbacks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const launcher = join(dirname(fileURLToPath(import.meta.url)), 'launcher.mjs');

const prints = (text) => `process.stdout.write(${JSON.stringify(text)});\n`;
const BROKEN = "throw new Error('simulated half-written copy');\n";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'glm-hud-launcher-'));
  const plugin = (version, body) => {
    const d = join(dir, 'plugins', 'cache', 'some-marketplace', 'glm-hud', version);
    mkdirSync(d, { recursive: true });
    if (body !== null) writeFileSync(join(d, 'statusline.mjs'), body);
  };
  const clone = (body) => {
    const d = join(dir, 'glm-hud');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'statusline.mjs'), body);
  };
  return { dir, plugin, clone, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function run(configDir) {
  return spawnSync(process.execPath, [launcher], {
    encoding: 'utf8',
    input: '{}',
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
  });
}

test('launcher: newest version wins when it loads', () => {
  const f = fixture();
  try {
    f.plugin('1.9.0', prints('older\n'));
    f.plugin('2.0.0', prints('newest\n'));
    const r = run(f.dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, 'newest\n');
  } finally { f.cleanup(); }
});

test('launcher: broken newest copy falls back to the previous version', () => {
  const f = fixture();
  try {
    f.plugin('1.9.0', prints('older\n'));
    f.plugin('2.0.0', BROKEN); // half-written mid-update
    const r = run(f.dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, 'older\n');
    assert.ok(!r.stdout.includes('[hud]'));
  } finally { f.cleanup(); }
});

test('launcher: every candidate broken degrades to the [hud] sentinel', () => {
  const f = fixture();
  try {
    f.plugin('1.0.0', BROKEN);
    f.plugin('2.0.0', BROKEN);
    const r = run(f.dir);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('[hud]'));
  } finally { f.cleanup(); }
});

test('launcher: non-version and statusline-less dirs are skipped, then silence', () => {
  const f = fixture();
  try {
    f.plugin('not-a-version', prints('junk\n')); // junk name never becomes a candidate
    f.plugin('1.0.0', null); // version dir without statusline.mjs
    const r = run(f.dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  } finally { f.cleanup(); }
});

test('launcher: no plugin install falls back to the git-clone copy', () => {
  const f = fixture();
  try {
    f.clone(prints('clone\n'));
    const r = run(f.dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, 'clone\n');
  } finally { f.cleanup(); }
});

test('launcher: nothing installed anywhere stays silent and exits 0', () => {
  const f = fixture();
  try {
    const r = run(f.dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  } finally { f.cleanup(); }
});
