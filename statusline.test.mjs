// statusline.mjs 端到端测试：spawnSync 真进程，stdin 喂 payload，验证行数/exit 0/关键内容
// env 显式最小集（绝不含任何 token 变量）→ 配额 omit，零网络、零真实缓存写。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayWidth } from './render.mjs';

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'statusline.mjs');
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');

// 干净 env：PATH 供 git 探测，其余一律不给（token 类变量绝不进入子进程）
const BASE_ENV = { PATH: process.env.PATH };

function run(stdin, envExtra = {}, cwd = null) {
  const r = spawnSync(process.execPath, [ENTRY], {
    input: stdin,
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...BASE_ENV, ...envExtra },
    cwd: cwd ?? undefined,
  });
  return r;
}

function outLines(r) {
  return r.stdout.split('\n').filter((l) => l.length > 0);
}

const NORMAL = {
  model: { id: 'glm-5.3[1m]', display_name: 'glm-5.3[1m]' },
  effort: { level: 'high' },
  workspace: { current_dir: '/home/dev/projects/demo-app' },
  context_window: { context_window_size: 1000000, total_input_tokens: 450000, used_percentage: 45 },
};

test('e2e: 正常 payload → exit 0、2 行、非空、含徽章与 Context', () => {
  const r = run(JSON.stringify(NORMAL));
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const lines = outLines(r);
  assert.ok(lines.length >= 1 && lines.length <= 2, `行数=${lines.length}`);
  const txt = lines.map(stripAnsi).join('\n');
  assert.ok(txt.includes('[GLM-5.3·1M·high]'));
  assert.ok(txt.includes('demo-app'));
  assert.ok(txt.includes('Context'));
  assert.ok(txt.includes('45%'));
  assert.ok(txt.includes('450k/1M'));
  for (const l of lines) assert.ok(stripAnsi(l).length > 0, '空行');
});

test('e2e: context_window 无用量 → transcript 尾读兜底出 45%', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glm-hud-e2e-'));
  try {
    const t = join(dir, 'transcript.jsonl');
    writeFileSync(t, [
      '{"message":{"usage":{"input_tokens":10,"cache_read_input_tokens":5}}}',
      '{"message":{"usage":{"input_tokens":400000,"cache_creation_input_tokens":20000,"cache_read_input_tokens":30000}}}',
    ].join('\n'), 'utf8');
    const payload = {
      model: { id: 'glm-5.3[1m]' },
      transcript_path: t,
      context_window: { context_window_size: 1000000, used_percentage: null, total_input_tokens: null, current_usage: null },
    };
    const r = run(JSON.stringify(payload));
    assert.equal(r.status, 0);
    const txt = outLines(r).map(stripAnsi).join('\n');
    assert.ok(txt.includes('45%'), `应含 45%: ${txt}`);
    assert.ok(txt.includes('450k/1M'), `应含 450k/1M: ${txt}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('e2e: transcript 指向不存在文件 → 静默省略 Context，仍 exit 0', () => {
  const payload = { model: { id: 'glm-5.3' }, transcript_path: '/nonexistent/x.jsonl', context_window: { context_window_size: 1000000 } };
  const r = run(JSON.stringify(payload));
  assert.equal(r.status, 0);
  const lines = outLines(r);
  assert.ok(lines.length >= 1 && lines.length <= 2);
  assert.ok(!lines.map(stripAnsi).join('\n').includes('Context'));
});

test('e2e: 空 stdin → exit 0、1 行、[CC] 兜底', () => {
  const r = run('');
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const lines = outLines(r);
  assert.equal(lines.length, 1);
  assert.ok(stripAnsi(lines[0]).startsWith('[CC] │'));
});

test('e2e: 坏 JSON → exit 0、1-2 行非空', () => {
  for (const bad of ['not json{{', '﻿', '[1,2,', String.fromCharCode(0) + 'garbage']) {
    const r = run(bad);
    assert.equal(r.status, 0, `input=${JSON.stringify(bad)} stderr=${r.stderr}`);
    const lines = outLines(r);
    assert.ok(lines.length >= 1 && lines.length <= 2, `input=${JSON.stringify(bad)}`);
    for (const l of lines) assert.ok(stripAnsi(l).length > 0);
  }
});

test('e2e: 全字段缺失 {} → exit 0、[CC] + cwd 目录名', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glm-hud-e2e-'));
  try {
    const r = run('{}', {}, dir);
    assert.equal(r.status, 0);
    const txt = stripAnsi(outLines(r)[0]);
    assert.ok(txt.startsWith('[CC] │'));
    assert.ok(txt.includes(dir.split('/').pop()), `应含目录名: ${txt}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('e2e: ANTHROPIC_MODEL 与 payload 不一致 → 行尾 dim env默认段（无 ⚠ 无"覆盖"）；一致 → 无该段', () => {
  const p = JSON.stringify({ model: { id: 'glm-5.3[1m]' } });
  const r1 = run(p, { ANTHROPIC_MODEL: 'glm-5.3-flash' });
  assert.equal(r1.status, 0);
  const lines1 = outLines(r1);
  const txt1 = lines1.map(stripAnsi).join('\n');
  assert.ok(txt1.includes('env默认:flash'), txt1);
  assert.ok(!txt1.includes('⚠'), `不应再有 ⚠: ${txt1}`);
  assert.ok(!txt1.includes('覆盖'), txt1);
  assert.ok(stripAnsi(lines1[0]).endsWith('env默认:flash'), `应在行尾: ${stripAnsi(lines1[0])}`);

  const r2 = run(p, { ANTHROPIC_MODEL: 'GLM-5.3[1M]' });
  assert.equal(r2.status, 0);
  const txt2 = outLines(r2).map(stripAnsi).join('\n');
  assert.ok(!txt2.includes('env默认'), `一致时不应出现: ${txt2}`);
  assert.ok(!txt2.includes('⚠'), txt2);
});

test('e2e: display_name 无 [1M] 后缀而 id 有 → 徽章合并 [GLM-5.3·1M]', () => {
  const p = JSON.stringify({ model: { id: 'glm-5.3[1M]', display_name: 'glm-5.3' } });
  const r = run(p);
  assert.equal(r.status, 0);
  const txt = outLines(r).map(stripAnsi).join('\n');
  assert.ok(txt.includes('[GLM-5.3·1M]'), txt);
});

test('e2e: COLUMNS=52 → compact 单行且显示宽度 ≤ 52', () => {
  const r = run(JSON.stringify(NORMAL), { COLUMNS: '52' });
  assert.equal(r.status, 0);
  const lines = outLines(r);
  assert.equal(lines.length, 1, `52 列应单行: ${lines.map(stripAnsi)}`);
  assert.ok(displayWidth(lines[0]) <= 52, `width=${displayWidth(lines[0])}`);
  const txt = stripAnsi(lines[0]);
  assert.ok(txt.includes('[GLM-5.3·1M·high]'));
  // 52 列极窄：compact 丢序至 Context 条（百分比可被丢——bar 本身已表达比例）
  assert.ok(txt.includes('C'), txt);
});

test('e2e: COLUMNS=160 → 无 token（配额省略）收成单行 L1，宽度 ≤ 160', () => {
  const r = run(JSON.stringify(NORMAL), { COLUMNS: '160' });
  assert.equal(r.status, 0);
  const lines = outLines(r);
  // e2e 进程无 token env → quota omit → L2 空 → 新布局收单行（L1 含 Context）
  assert.equal(lines.length, 1, `got ${lines.length}: ${lines.map(stripAnsi)}`);
  assert.ok(displayWidth(lines[0]) <= 160, `width=${displayWidth(lines[0])}`);
  assert.ok(stripAnsi(lines[0]).includes('Context'));
});

test('e2e: 无 token env → 配额组整体省略（无 ⚡/MCP 字样）', () => {
  const r = run(JSON.stringify(NORMAL));
  assert.equal(r.status, 0);
  const txt = outLines(r).map(stripAnsi).join('\n');
  assert.ok(!txt.includes('⚡︎5h'));
  assert.ok(!txt.includes('MCP'));
  assert.ok(!txt.includes('周'));
});
