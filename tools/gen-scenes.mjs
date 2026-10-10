#!/usr/bin/env node
// gen-scenes.mjs — 视觉验证场景生成器（零依赖）
// 跑真实 statusline.mjs（构造样例 payload + 注入缓存配额），ANSI 落 preview/sN.ansi，
// 经 tools/ansi2html.mjs 转 preview/sN.html，并算每场景 WCAG 对比度 → preview/scenes.json。
// env 精确受控：token 用显式占位串（缓存 TTL 内不会触网）；s6 不给 token 验证 omit。
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayWidth, LIGHT, DARK } from '../render.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PREVIEW = join(ROOT, 'preview');
const CACHE = join(ROOT, 'cache/quota.json');
const DEMO_CWD = join(PREVIEW, 'glm-hud'); // 临时 demo git 仓库（main + 未跟踪文件 → git:(main*)）

// ── 配额缓存注入（与 writeCache 同法：tmp+rename、0600；只含数字与时间戳）────────
function writeQuotaCache(limits) {
  mkdirSync(dirname(CACHE), { recursive: true, mode: 0o700 });
  const tmp = CACHE + '.' + process.pid + '.tmp';
  writeFileSync(tmp, JSON.stringify({ ...limits, fetchedAt: Date.now() }), { mode: 0o600 });
  renameSync(tmp, CACHE);
}

function quotaNumbers({ fhPct, fhMin, wkPct, wkMin, mcpUsed, mcpTotal, mcpMin }) {
  const now = Date.now();
  return {
    fiveHour: { percent: fhPct, resetsAt: now + fhMin * 60_000, unit: 3, span: 5 },
    week: { percent: wkPct, resetsAt: now + wkMin * 60_000, unit: 6, span: 1 },
    mcp: {
      used: mcpUsed, total: mcpTotal, remaining: mcpTotal - mcpUsed,
      percent: Math.round((mcpUsed / mcpTotal) * 100), resetsAt: now + mcpMin * 60_000,
    },
    level: 'pro',
  };
}

// ── demo git 仓库：main 分支 + 未跟踪文件 → 脏标 *（幂等）──────────────────────
function ensureDemoRepo() {
  if (existsSync(join(DEMO_CWD, '.git'))) return;
  mkdirSync(DEMO_CWD, { recursive: true });
  for (const [cmd, args] of [
    ['git', ['-C', DEMO_CWD, 'init', '-b', 'main']],
    ['git', ['-C', DEMO_CWD, 'config', 'user.email', 'hud@local']],
    ['git', ['-C', DEMO_CWD, 'config', 'user.name', 'hud-preview']],
    ['git', ['-C', DEMO_CWD, 'commit', '--allow-empty', '-m', 'init']],
    ['touch', [join(DEMO_CWD, 'draft.md')]], // 未跟踪 → dirty
  ]) {
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('demo repo: ' + cmd + ' ' + args.join(' ') + ' → ' + r.status);
  }
}

// ── WCAG 对比度（公式与 render.test.mjs 一致；bg 可选 light #fafafa / dark #1c1c1c）──
function xtermRgb(n) {
  if (n >= 232) { const v = 8 + (n - 232) * 10; return [v, v, v]; }
  const lv = [0, 95, 135, 175, 215, 255];
  const i = n - 16;
  return [lv[Math.floor(i / 36)], lv[Math.floor((i % 36) / 6)], lv[i % 6]];
}
function luminance(rgb) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
export function contrastVs(n, bg = [250, 250, 250]) {
  const a = luminance(xtermRgb(n));
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// 主题 → 底色 RGB / 调色板名→256 色索引（同码在不同主题下角色不同，如 242 = light.dim = dark.dimBar）
const THEME_BG = { light: [250, 250, 250], dark: [28, 28, 28] };
const paletteNames = (pal) => {
  const map = new Map();
  for (const [name, code] of Object.entries(pal)) {
    const m = code.match(/\x1b\[38;5;(\d+)m/);
    if (m) map.set(parseInt(m[1], 10), name);
  }
  return map;
};
const THEME_NAMES = { light: paletteNames(LIGHT), dark: paletteNames(DARK) };

// 场景 ANSI 里实际用到的颜色 → [{idx,name,contrast,bold}]（按 idx 升序，对比度对主题底色）
function colorsUsed(ansi, theme) {
  const bg = THEME_BG[theme] || THEME_BG.dark;
  const names = THEME_NAMES[theme] || THEME_NAMES.dark;
  const used = new Map(); // idx -> Set(styles)
  const re = /(?:\x1b\[1m)?\x1b\[38;5;(\d+)m/g;
  let m;
  while ((m = re.exec(ansi)) !== null) {
    const idx = parseInt(m[1], 10);
    if (!used.has(idx)) used.set(idx, new Set());
    used.get(idx).add(m[0].startsWith('\x1b[1m') ? 'bold' : 'plain');
  }
  return [...used.entries()].sort((a, b) => a[0] - b[0]).map(([idx, styles]) => ({
    idx,
    name: names.get(idx) || '?',
    contrast: Number(contrastVs(idx, bg).toFixed(2)),
    bold: styles.has('bold'),
    plain: styles.has('plain'),
  }));
}

// ── 跑一个场景：注入缓存 → 受控 env 跑 statusline → ansi2html → 落盘 ────────────
function runScene(s) {
  const theme = s.theme || 'dark'; // 默认主题 dark（黑底终端）
  if (s.quota) writeQuotaCache(s.quota);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, COLUMNS: String(s.cols), GLM_HUD_THEME: theme };
  if (s.token) env.GLM_API_KEY = s.token; // 占位串：缓存 TTL 内不会触网
  if (s.anthropicModel) env.ANTHROPIC_MODEL = s.anthropicModel;

  const r = spawnSync('node', [join(ROOT, 'statusline.mjs')], {
    input: JSON.stringify(s.payload), encoding: 'utf8', env, timeout: 15_000,
  });
  const ansi = r.stdout || '';
  writeFileSync(join(PREVIEW, s.id + '.ansi'), ansi);
  const h = spawnSync('node', [join(ROOT, 'tools/ansi2html.mjs'), ...(theme === 'dark' ? ['--dark'] : []), s.title], {
    input: ansi, encoding: 'utf8', timeout: 15_000,
  });
  if (h.status !== 0) throw new Error(s.id + ' ansi2html failed: ' + h.stderr);
  writeFileSync(join(PREVIEW, s.id + '.html'), h.stdout);

  const lines = ansi.replace(/\n$/, '').split('\n');
  return {
    id: s.id, label: s.label, cols: s.cols, theme,
    lineCount: lines.length,
    lineWidths: lines.map((l) => displayWidth(l)),
    overflow: lines.some((l) => displayWidth(l) > s.cols),
    hasNaN: ansi.includes('NaN'),
    colors: colorsUsed(ansi, theme),
    plainPreview: lines.map((l) => l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')),
  };
}

// ── 场景表 ──────────────────────────────────────────────────────────────────
const payload = (ctxPct = 45, usedTokens = 90000) => ({
  model: { id: 'glm-5.3[1M]', display_name: 'glm-5.3' },
  effort: { level: 'high' },
  workspace: { current_dir: DEMO_CWD },
  context_window: { context_window_size: 200000, used_percentage: ctxPct, total_input_tokens: usedTokens },
});
const TOKEN = 'visual-pipeline-placeholder'; // 显式占位，非真实凭证
// 倒计时留 1 分钟缓冲：formatCountdown 向下取整，避免渲染瞬间跨分钟变 40m/2d7h
const normalQuota = () => quotaNumbers({ fhPct: 24, fhMin: 42, wkPct: 19, wkMin: 57 * 60, mcpUsed: 309, mcpTotal: 1000, mcpMin: 193 });
const criticalQuota = () => quotaNumbers({ fhPct: 93, fhMin: 42, wkPct: 91, wkMin: 57 * 60, mcpUsed: 309, mcpTotal: 1000, mcpMin: 193 });
const warnQuota = () => quotaNumbers({ fhPct: 81, fhMin: 42, wkPct: 34, wkMin: 57 * 60, mcpUsed: 309, mcpTotal: 1000, mcpMin: 193 });

const SCENES = [
  { id: 's1', title: 's1 宽140 全量', cols: 140, token: TOKEN, quota: normalQuota(), payload: payload(),
    label: '宽140列·全量：徽章[GLM-5.3·1M·high] + glm-hud git:(main*) + Context 45% + ⚡︎5h 24% 剩41m + 周 19% 剩2d8h + MCP 31% 309/1000（四段全共存，MCP 补百分比）' },
  { id: 's2', title: 's2 宽100 全量', cols: 100, token: TOKEN, quota: normalQuota(), payload: payload(),
    label: '宽100列：Context+⚡︎5h+周 三段共存，MCP 尾段放不下被丢' },
  { id: 's3', title: 's3 宽70 有配额', cols: 70, token: TOKEN, quota: normalQuota(), payload: payload(),
    label: '宽70列·有配额：窄条 W=4 两行档（空槽同字形 █），Context+⚡︎5h+周 共存，MCP 丢' },
  { id: 's4', title: 's4 宽50 compact', cols: 50, token: TOKEN, quota: normalQuota(), payload: payload(),
    label: '宽50列·compact 单行降级（<60 阈值）：C 标签归属 Context 用量' },
  { id: 's5', title: 's5 双critical+env默认', cols: 140, token: TOKEN, quota: criticalQuota(), anthropicModel: 'glm-5.3-flash', payload: payload(),
    label: '宽140列·⚡︎5h=93% 周=91% 双 critical 亮红警示（dark 203，5.7:1；light 124，7.1:1）+ env默认:flash 信息段（L1 行尾 dim 灰）' },
  { id: 's6', title: 's6 无token omit', cols: 140, anthropicModel: 'glm-5.3-flash', payload: payload(),
    label: '宽140列·无 token：配额组整体省略（无占位、无 ⚠︎）+ env默认:flash 信息段' },
  // 重标定后 L2 四段全量（Context+5h+周+MCP，█░ 按 1 列）约 121 列，140 列即可全量；
  // 保留 170 列对照，验证宽终端富余空间下的布局
  { id: 's7', title: 's7 宽170 全量含MCP', cols: 170, token: TOKEN, quota: normalQuota(), payload: payload(),
    label: '补充·宽170列：四段全量共存（Context+⚡︎5h+周+MCP 31% 309/1000），对照 s1 验证宽度富余' },
  { id: 's8', title: 's8 警示档配色', cols: 140, token: TOKEN, quota: warnQuota(), payload: payload(78, 156000),
    label: '宽140列·警示档：Context 78% warn（dark 214 亮橙黄 / light 100 深黄）+ ⚡︎5h 81% quotaWarn（dark 213 / light 133）+ 周 34% 与 MCP 31% healthy（dark 39 / light 25）对照' },
];

function main() {
  mkdirSync(PREVIEW, { recursive: true });
  // 备份真实配额缓存（注入前），跑完恢复
  let backup = null;
  if (existsSync(CACHE)) backup = readFileSync(CACHE, 'utf8');
  ensureDemoRepo();
  const results = [];
  let failed = null;
  try {
    for (const s of SCENES) results.push(runScene(s));
  } catch (e) {
    failed = e;
  } finally {
    if (backup !== null) {
      const tmp = CACHE + '.restore.tmp';
      writeFileSync(tmp, backup, { mode: 0o600 });
      renameSync(tmp, CACHE);
    } else if (existsSync(CACHE)) {
      rmSync(CACHE); // 原本无缓存则删掉注入物
    }
    rmSync(DEMO_CWD, { recursive: true, force: true }); // demo 仓库用完即删
  }
  if (failed) throw failed;
  writeFileSync(join(PREVIEW, 'scenes.json'), JSON.stringify(results, null, 2));
  for (const r of results) {
    console.log(`${r.id} cols=${r.cols} lines=${r.lineCount} widths=[${r.lineWidths}] overflow=${r.overflow} NaN=${r.hasNaN}`);
    console.log(`   ${r.colors.map((c) => `${c.name || '?'}(${c.idx})=${c.contrast}:1${c.bold && c.plain ? '±b' : c.bold ? 'b' : ''}`).join(' ')}`);
    for (const p of r.plainPreview) console.log(`   | ${p}`);
  }
  console.log('OK → ' + join(PREVIEW, 'scenes.json'));
}
main();
