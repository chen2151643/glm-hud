#!/usr/bin/env node
// glm-hud 入口：stdin JSON → stdout 最多 2 行 → 永远 exit 0
import { readFileSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildView, withTranscriptTokens, envDefaultNote, usageFromTranscriptChunk } from './parse.mjs';
import { renderLines, setTheme, themeFromEnv, hideSetFromEnv, C } from './render.mjs';
import { resolveQuota } from './quota.mjs';

function readStdin() {
  if (process.stdin.isTTY) return ''; // 手工直跑（stdin 未重定向）时不阻塞等 EOF
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

// transcript 尾部兜底：只读最后 64KB，拿最后一条 usage
function readTranscriptUsage(path) {
  if (typeof path !== 'string' || !path) return null;
  let fd;
  try {
    fd = openSync(path, 'r');
    const st = fstatSync(fd);
    const len = Math.min(st.size, 65536);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, Math.max(0, st.size - len));
    return usageFromTranscriptChunk(buf.toString('utf8'));
  } catch {
    return null;
  } finally {
    try { if (fd !== undefined) closeSync(fd); } catch { /* noop */ }
  }
}

// git 分支/脏标：失败静默省略
function getGit(cwd) {
  if (typeof cwd !== 'string' || !cwd) return null;
  try {
    const branch = execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { timeout: 1500, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!branch) return null;
    let dirty = false;
    try {
      const st = execFileSync('git', ['-C', cwd, 'status', '--porcelain'],
        { timeout: 1500, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      dirty = st.trim().length > 0;
    } catch { return null; } // 脏标探测失败（超时等）→ 状态未知，整个 git 段省略，不显示假干净
    return { branch, dirty };
  } catch {
    return null;
  }
}

// 宽度探测（stdout 是管道，stderr 继承终端——claude-hud 同法）；都没有 → 100 列保守值
function getCols(env) {
  let c = 0;
  const colEnv = env.COLUMNS;
  if (typeof colEnv === 'string' && /^\d+$/.test(colEnv)) c = parseInt(colEnv, 10);
  else if (process.stderr && process.stderr.isTTY && process.stderr.columns) c = process.stderr.columns;
  else if (process.stdout && process.stdout.isTTY && process.stdout.columns) c = process.stdout.columns;
  if (!Number.isFinite(c) || c < 20) c = 100;
  return Math.min(c, 1000);
}

async function main() {
  const env = process.env;
  setTheme(themeFromEnv(env)); // GLM_HUD_THEME=dark|light（默认 dark，黑底终端）
  let payload = null;
  try { payload = JSON.parse(readStdin()); } catch { payload = null; }

  let view = buildView(payload, process.cwd());
  if (view.ctx.percent === null) {
    view = withTranscriptTokens(view, readTranscriptUsage(payload?.transcript_path));
  }

  const quota = await resolveQuota(env, {});
  const git = getGit(view.cwd);
  const envNote = envDefaultNote(payload, env);
  const lines = renderLines(view, quota, git, envNote, getCols(env), Date.now(), hideSetFromEnv(env));
  process.stdout.write(lines.map((l) => '\x1b[0m' + l).join('\n') + '\n');
}

// 不用 process.exit(0)：Linux/文件重定向下管道写是异步的，立即 exit 可能截断未冲刷的输出；
// process.exitCode=0 后事件循环排空（含 stdout 冲刷）自然退出
main().then(
  () => { process.exitCode = 0; },
  () => {
    // 兜底：任何未捕获异常也输出一行并 exit 0（颜色随当前主题）
    try { process.stdout.write('\x1b[0m' + C.model + '[hud]' + '\x1b[0m\n'); } catch { /* noop */ }
    process.exitCode = 0;
  },
);
