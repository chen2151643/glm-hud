// render.mjs 纯渲染测试（宽度 / 模板 / 降级 / 三态 / 双主题调色板）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLines, displayWidth, truncateAnsi, bar, barWidthFor, ctxColor, quotaColor, C, LIGHT, DARK, setTheme, themeFromEnv, hideSetFromEnv, HIDE_KEYS } from './render.mjs';
import { buildView } from './parse.mjs';

setTheme('dark'); // 测试进程默认主题与线上一致（GLM_HUD_THEME 未设 = dark）

const NOW = 1791500000000;
const PAYLOAD = {
  model: { id: 'glm-5.3[1m]', display_name: 'glm-5.3[1m]' },
  effort: { level: 'high' },
  workspace: { current_dir: '/home/dev/projects/demo-app' },
  context_window: { context_window_size: 1000000, total_input_tokens: 450000, used_percentage: 45 },
};
const QUOTA = {
  state: 'show',
  limits: {
    fiveHour: { percent: 24, resetsAt: NOW + 41 * 60_000 },
    week: { percent: 19, resetsAt: NOW + (2 * 86400 + 14 * 3600) * 1000 },
    mcp: { used: 294, total: 1000, remaining: 706, percent: 29, resetsAt: NOW + 86400_000 },
    level: 'pro', fetchedAt: NOW,
  },
};

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');

test('displayWidth: CJK 2 列、ambiguous 方块/符号实测 1 列，转义不计', () => {
  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth('中文'), 4);
  assert.equal(displayWidth('█░'), 2);        // 方块 ambiguous：实测 1 列（视觉评审重标定）
  assert.equal(displayWidth('⚡︎5h'), 3);      // ⚡(1) + VS15(0) + 5h(2)
  assert.equal(displayWidth('⚠︎'), 1);        // ⚠(1) + VS15(0)
  assert.equal(displayWidth('剩41m'), 5);     // 剩 CJK 2 列（视觉评审三轮：↻ 换中文前缀）
  assert.equal(displayWidth(C.model + '[GLM]' + '\x1b[0m'), 5);
  assert.equal(displayWidth('\x1b]8;;file:///a/b\x1b\\xx\x1b]8;;\x1b\\'), 2); // OSC8 只计文本
});

test('bar: half-up 填充 + 单 reset 收尾', () => {
  const b = bar(45, 10, C.healthy); // floor(4.5+0.5)=5
  assert.equal(stripAnsi(b).length, 10);
  assert.equal(stripAnsi(b).split('█').length - 1, 5);
  assert.ok(b.endsWith('\x1b[0m'));
  assert.equal(barWidthFor(100), 10);
  assert.equal(barWidthFor(99), 6);
  assert.equal(barWidthFor(80), 6);   // 80-99 档中条
  assert.equal(barWidthFor(79), 4);   // 60-79 档窄条
  assert.equal(barWidthFor(60), 4);
  assert.equal(barWidthFor(59), 4);
});

test('renderLines: 两行布局、段齐全、宽度不超', () => {
  const view = buildView(PAYLOAD, '/fb');
  // 2026-10-10 布局：L1 = badge │ dir git │ Context │ (env默认)；L2 = ⚡5h │ 周 │ MCP
  const lines = renderLines(view, QUOTA, { branch: 'main', dirty: true }, null, 170, NOW);
  assert.equal(lines.length, 2);
  const [l1, l2] = lines.map(stripAnsi);
  assert.ok(l1.includes('[GLM-5.3·1M·high]'));
  assert.ok(l1.includes('demo-app'));
  assert.ok(l1.includes('git:(main*)'));
  assert.ok(l1.includes('Context'), `Context 应在 L1（目录同行后）: ${l1}`);
  assert.ok(l1.includes('45%'));
  assert.ok(l1.includes('450k/1M'));
  assert.ok(l1.indexOf('cape-project') < l1.indexOf('Context'), 'Context 在目录之后');
  assert.ok(l2.includes('⚡︎5h'));
  assert.ok(l2.includes('24%'));
  assert.ok(l2.includes('剩41m'));
  assert.ok(l2.includes('周'));
  assert.ok(l2.includes('19%'));
  assert.ok(l2.includes('剩2d14h'));
  assert.ok(l2.includes('MCP'));
  assert.ok(l2.includes('294/1000'));
  assert.ok(!l1.includes('⚡︎5h') && !l2.includes('Context'), '配额归 L2、Context 归 L1');
  for (const line of lines) assert.ok(displayWidth(line) <= 170, `width ${displayWidth(line)}`);
});

test('renderLines: 100 列两行各自全量共存（Context 移 L1 后配额行轻装）', () => {
  const lines = renderLines(buildView(PAYLOAD, '/fb'), QUOTA, { branch: 'main', dirty: true }, null, 100, NOW);
  assert.equal(lines.length, 2);
  const [l1, l2] = lines.map(stripAnsi);
  // L1 ≈ 78 列全量；L2 ≈ 83 列全量——100 列下两行均无需丢段
  assert.ok(l1.includes('Context') && l1.includes('45%'), l1);
  assert.ok(l2.includes('⚡︎5h') && l2.includes('19%'), l2);
  assert.ok(l2.includes('294/1000'), `100 列配额行应全量（含 MCP 明细）: ${l2}`);
  for (const line of lines) assert.ok(displayWidth(line) <= 100, `width ${displayWidth(line)}`);
  // 95 列（W=6 中条档）同样两行全量
  const lines95 = renderLines(buildView(PAYLOAD, '/fb'), QUOTA, { branch: 'main', dirty: true }, null, 95, NOW);
  const l295 = stripAnsi(lines95[1]);
  assert.ok(l295.includes('⚡︎5h') && l295.includes('19%'), l295);
  assert.ok(!l295.includes('294/1000'), 'W<10 窄条档丢 MCP 明细');
  for (const line of lines95) assert.ok(displayWidth(line) <= 95, `width ${displayWidth(line)}`);
});

test('renderLines: 每行带 \x1b[0m 前缀由入口负责，这里行本身含 reset', () => {
  const lines = renderLines(buildView(PAYLOAD, '/fb'), QUOTA, null, null, 100, NOW);
  assert.ok(lines[0].includes('\x1b[0m'));
});

test('renderLines: no-token → 配额组整体省略 → 单行 L1（含 Context）', () => {
  const lines = renderLines(buildView(PAYLOAD, '/fb'), { state: 'omit' }, null, null, 100, NOW);
  assert.equal(lines.length, 1, `无 L2 素材应收成单行: ${lines.length}`);
  const l1 = stripAnsi(lines[0]);
  assert.ok(!l1.includes('⚡︎5h'));
  assert.ok(!l1.includes('MCP'));
  assert.ok(l1.includes('Context') && l1.includes('45%'), l1);
});

test('renderLines: failed 且无缓存 → dim 占位不消失', () => {
  const lines = renderLines(buildView(PAYLOAD, '/fb'), { state: 'failed' }, null, null, 100, NOW);
  const l2 = stripAnsi(lines[1]);
  assert.ok(l2.includes('⚡︎5h --'));
  assert.ok(l2.includes('周 --'));
  assert.ok(l2.includes('MCP --'));
});

test('renderLines: 配额 >=90 整段 critical + ⚠', () => {
  const q = { state: 'show', limits: { ...QUOTA.limits, fiveHour: { percent: 95, resetsAt: NOW + 60000 } } };
  const lines = renderLines(buildView(PAYLOAD, '/fb'), q, null, null, 100, NOW);
  const seg = lines[1];
  const idx = seg.indexOf('⚠︎ ⚡︎5h');
  assert.ok(idx >= 0, 'has ⚠︎ ⚡︎5h');
  const afterBar = seg.slice(idx);
  assert.ok(afterBar.includes(C.critical), 'critical color in segment');
});

test('renderLines: env 默认段——L1 行尾、dim、无 ⚠；L1 放不下时先于 dir/ctx 被丢', () => {
  const wide = renderLines(buildView(PAYLOAD, '/fb'), { state: 'omit' }, null, 'env默认:flash', 100, NOW);
  const raw1 = wide[0];
  const l1 = stripAnsi(raw1);
  assert.ok(l1.includes('env默认:flash'), l1);
  assert.ok(!l1.includes('⚠'), 'env 段不得再用警示样式');
  assert.ok(!l1.includes('覆盖'), '措辞不得出现"覆盖"');
  assert.ok(l1.endsWith('env默认:flash'), `应在行尾: ${l1}`);
  assert.ok(l1.indexOf('cape-project') < l1.indexOf('Context'), 'Context 在 dir 之后');
  assert.ok(l1.indexOf('Context') < l1.indexOf('env默认:flash'), 'note 在 Context 之后（行尾）');
  assert.ok(raw1.includes(C.dim + 'env默认:flash' + '\x1b[0m'), 'dim 灰 242、无加粗');

  // 60 列：badge+dir/git 45 列后 ctxCore 也放不下（70 列才容得下）→ L1 只剩 badge+dir，note/ctx 依次被丢
  const two = renderLines(buildView(PAYLOAD, '/fb'), QUOTA, { branch: 'main', dirty: true }, 'env默认:flash', 60, NOW);
  const t1 = stripAnsi(two[0]);
  assert.ok(!t1.includes('env默认'), `60 列 note 应最先被丢: ${t1}`);
  assert.ok(t1.includes('demo-app') && t1.includes('git:(main*)'), `dir/git 存活: ${t1}`);
  for (const line of two) assert.ok(displayWidth(line) <= 60);

  // 58 列 compact：note 同样先丢
  const compact = renderLines(buildView(PAYLOAD, '/fb'), QUOTA, { branch: 'main', dirty: true }, 'env默认:flash', 58, NOW);
  const c = stripAnsi(compact[0]);
  assert.ok(!c.includes('env默认'), c);
  assert.ok(displayWidth(compact[0]) <= 58);
});

test('renderLines: 窄终端（<60 列）降级 compact 单行且不超宽', () => {
  for (const cols of [58, 40, 24]) {
    const lines = renderLines(buildView(PAYLOAD, '/fb'), QUOTA, { branch: 'dev', dirty: false }, null, cols, NOW);
    assert.equal(lines.length, 1, `cols=${cols} should be single line`);
    assert.ok(displayWidth(lines[0]) <= cols, `cols=${cols} width ${displayWidth(lines[0])}`);
    assert.ok(lines[0].length > 0);
  }
  // compact 布局序（用户要求 Context 紧跟 dir）：badge │ dir/git │ C 条 % │ 配额 │ note
  const c = renderLines(buildView(PAYLOAD, '/fb'), QUOTA, { branch: 'dev', dirty: false }, null, 58, NOW);
  const txt = stripAnsi(c[0]);
  assert.ok(txt.startsWith('[GLM-5.3·1M·high]'), `compact 以 badge 开头: ${txt}`);
  assert.ok(txt.indexOf('git:(dev)') < txt.indexOf(' C '), `dir 在 ctx 之前: ${txt}`);
  assert.ok(txt.includes(' | '));
});

test('renderLines: 无 git / 无配额 / 无 context → 仍 1-2 行非空', () => {
  const lines = renderLines(buildView({ model: { id: 'glm-5.3' } }, '/fb'), { state: 'omit' }, null, null, 100, NOW);
  assert.equal(lines.length, 1);
  assert.equal(stripAnsi(lines[0]), '[GLM-5.3] │ fb');
  const lines2 = renderLines(buildView(null, '/fb'), { state: 'omit' }, null, null, 100, NOW);
  assert.equal(lines2.length, 1);
  assert.equal(stripAnsi(lines2[0]), '[CC] │ fb');
});

test('renderLines: context 无百分比但有 used/size → 数字兜底（单行 L1）', () => {
  const view = buildView({ model: {}, context_window: { context_window_size: 1000000, total_input_tokens: null } }, '/fb');
  const v2 = { ...view, ctx: { percent: null, used: 85000, size: 1000000 } };
  const lines = renderLines(v2, { state: 'omit' }, null, null, 100, NOW);
  assert.equal(lines.length, 1);
  assert.ok(stripAnsi(lines[0]).includes('85k/1M'));
});

test('truncateAnsi: 分隔符处断行加 ...，否则硬截断', () => {
  const long = 'a'.repeat(60) + ' │ ' + 'b'.repeat(60);
  const t = truncateAnsi(long, 40);
  assert.ok(t.includes('...'));           // ... + reset 收尾
  assert.ok(t.endsWith('\x1b[0m'));
  assert.ok(displayWidth(t) <= 40);
  const noSep = 'x'.repeat(80);
  const t2 = truncateAnsi(noSep, 20);
  assert.equal(displayWidth(t2), 20); // 17 chars + '...'
});

test('ctxColor / quotaColor 阈值', () => {
  assert.equal(ctxColor(69), C.healthy);
  assert.equal(ctxColor(70), C.warn);
  assert.equal(ctxColor(85), C.critical);
  assert.equal(quotaColor(74), C.healthy);
  assert.equal(quotaColor(75), C.quotaWarn);
  assert.equal(quotaColor(90), C.critical);
});

// ── 补充用例（2026-10-09 补测轮）─────────────────────────────────────

test('renderLines: nextResetTime 缺失 → 剩--（旧 mod bug 修正的渲染面）', () => {
  const q = { state: 'show', limits: { ...QUOTA.limits, fiveHour: { percent: 55, resetsAt: null } } };
  const lines = renderLines(buildView(PAYLOAD, '/fb'), q, null, null, 160, NOW); // 160 列全段保留
  const l2 = stripAnsi(lines[1]);
  assert.ok(l2.includes('⚡︎5h'));
  assert.ok(l2.includes('55% 剩--'));
  // 其余有 resetsAt 的窗口倒计时正常
  assert.ok(l2.includes('剩2d14h'));
});

test('renderLines: MCP total 未知 → 次数降级显示，绝不显示满条', () => {
  const q = { state: 'show', limits: { ...QUOTA.limits, mcp: { used: 304, total: null, remaining: null, percent: null, resetsAt: null } } };
  const lines = renderLines(buildView(PAYLOAD, '/fb'), q, null, null, 160, NOW); // 160 列全段保留
  const l2 = stripAnsi(lines[1]);
  assert.ok(l2.includes('MCP 304 次'));
  assert.ok(!l2.includes('304/'));
});

test('renderLines: context 全缺 + 配额在 → 2 行，L2 无 Context 段', () => {
  const lines = renderLines(buildView({ model: {} }, '/fb'), QUOTA, null, null, 100, NOW);
  assert.equal(lines.length, 2);
  const l2 = stripAnsi(lines[1]);
  assert.ok(l2.startsWith('⚡︎5h'));
  assert.ok(!l2.includes('Context'));
});

test('renderLines: 巨型单段（超长模型名）→ 终极 compact+截断仍 ≤ cols', () => {
  const view = buildView({
    model: { id: 'm'.repeat(80) },
    context_window: { context_window_size: 1000000, total_input_tokens: 450000, used_percentage: 45 },
  }, '/fb');
  for (const cols of [20, 25, 58]) {
    const lines = renderLines(view, QUOTA, null, null, cols, NOW);
    assert.equal(lines.length, 1, `cols=${cols}`);
    assert.ok(displayWidth(lines[0]) <= cols, `cols=${cols} width=${displayWidth(lines[0])}`);
    assert.ok(stripAnsi(lines[0]).length > 0);
  }
});

test('truncateAnsi: CJK 硬截断按 2 列计宽', () => {
  const s = '中'.repeat(30);
  for (const maxW of [21, 9, 3]) {
    const t = truncateAnsi(s, maxW);
    assert.ok(displayWidth(t) <= maxW, `maxW=${maxW} got ${displayWidth(t)}`);
    assert.ok(t.endsWith('\x1b[0m') || t.includes('...'));
  }
});

test('displayWidth: ·│ 计 1 列（ambiguous 实测重标定）；混合 ANSI+CJK 精确', () => {
  assert.equal(displayWidth('剩41m'), 5);   // 剩(2 CJK) + 41m(3)
  assert.equal(displayWidth('a·b'), 3);    // ·(1)
  assert.equal(displayWidth('a│b'), 3);    // │(1)
  assert.equal(displayWidth(C.healthy + '中文abc' + '\x1b[0m'), 7);
});

test('renderLines: env默认段 + 5h critical 并存——⚠ 只属于配额 critical 段', () => {
  const q = { state: 'show', limits: { ...QUOTA.limits, fiveHour: { percent: 93, resetsAt: NOW + 60000 } } };
  const lines = renderLines(buildView(PAYLOAD, '/fb'), q, null, 'env默认:flash', 100, NOW);
  assert.equal(lines.length, 2);
  assert.ok(!stripAnsi(lines[0]).includes('⚠'), 'L1 无 ⚠');
  assert.ok(stripAnsi(lines[0]).includes('env默认:flash'));
  assert.ok(stripAnsi(lines[1]).includes('93%'));
  assert.ok(lines[1].includes('⚠︎ ⚡︎5h'), 'critical 配额段才有 ⚠');
  for (const line of lines) assert.ok(displayWidth(line) <= 100);
});

// ── 补充用例（2026-10-09 评审修复轮）─────────────────────────────────

test('renderLines: 窗口 percent 非有限数字 → 整段省略，绝不渲染 NaN（corrupt cache 兜底）', () => {
  const q = {
    state: 'show',
    limits: {
      fiveHour: { percent: NaN, resetsAt: NOW + 60000 }, // 结构漂移/损坏
      week: { percent: 19, resetsAt: NOW + 60000 },
      mcp: { used: 294, total: 1000, remaining: 706, percent: 29, resetsAt: NOW + 86400_000 },
      level: null, fetchedAt: NOW,
    },
  };
  const lines = renderLines(buildView(PAYLOAD, '/fb'), q, null, null, 200, NOW);
  const all = lines.map(stripAnsi).join('\n');
  assert.ok(!all.includes('NaN'), `不应出现 NaN: ${all}`);
  assert.ok(!all.includes('⚡︎5h'), '缺 percent 的 5h 窗口应整段省略');
  assert.ok(all.includes('周') && all.includes('19%'), '合法窗口保留');
  assert.ok(all.includes('294/1000'), '合法 MCP 保留');
});

test('renderLines: mcp used 非有限数字 → 整段省略；mcp percent NaN → 用 used/total 重算', () => {
  const q1 = { state: 'show', limits: { ...QUOTA.limits, fiveHour: null, week: null, mcp: { used: NaN, total: 1000 } } };
  const all1 = renderLines(buildView(PAYLOAD, '/fb'), q1, null, null, 200, NOW).map(stripAnsi).join('\n');
  assert.ok(!all1.includes('MCP'), `used 不完整应整段省略: ${all1}`);
  assert.ok(!all1.includes('NaN'));
  // percent 损坏但 used/total 合法 → 重算 29/1000=29% 正常展示
  const q2 = { state: 'show', limits: { ...QUOTA.limits, fiveHour: null, week: null, mcp: { used: 294, total: 1000, percent: NaN } } };
  const all2 = renderLines(buildView(PAYLOAD, '/fb'), q2, null, null, 200, NOW).map(stripAnsi).join('\n');
  assert.ok(all2.includes('294/1000'), all2);
  assert.ok(!all2.includes('NaN'));
});

test('renderLines: resetsAt 非有限数字 → 剩-- 而非 ↻NaN', () => {
  const q = { state: 'show', limits: { ...QUOTA.limits, fiveHour: { percent: 24, resetsAt: NaN }, week: null, mcp: null } };
  const all = renderLines(buildView(PAYLOAD, '/fb'), q, null, null, 200, NOW).map(stripAnsi).join('\n');
  assert.ok(all.includes('剩--'), all);
  assert.ok(!all.includes('NaN'));
});

// ── 补充用例（2026-10-09 findings 修复轮）─────────────────────────────
// 修复点：critical 208 浅底不可读、60-99 档丢段、警告先于 dir/git 被丢、
// failed 占位整段消失、窗口重置后旧高百分比无限期滞留

// xterm-256 → RGB → WCAG 对比度（bg 可指定：dark #1c1c1c / light #fafafa）
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
function contrastVs(n, bg) {
  const l = luminance(xtermRgb(n));
  const b = luminance(bg);
  const hi = Math.max(l, b), lo = Math.min(l, b);
  return (hi + 0.05) / (lo + 0.05);
}
const BG = { dark: [28, 28, 28], light: [250, 250, 250] };
const codeOf = (pal, name) => parseInt(pal[name].match(/\x1b\[38;5;(\d+)m/)[1], 10);

// 两主题共用阈值：粗体警示 ≥3、critical ≥5 留余量、空░图形件（非文本 3:1）≥3、其余普通色 ≥4.5
const MIN_CONTRAST = { warn: 3, quotaWarn: 3, critical: 5, dimBar: 3 };

for (const [theme, pal] of [['dark', DARK], ['light', LIGHT]]) {
  test(`调色板可读性（WCAG, ${theme} 底 #${theme === 'dark' ? '1c1c1c' : 'fafafa'}）：粗体 ≥3:1、普通 ≥4.5:1、critical ≥5 留余量、空░图形件 ≥3:1`, () => {
    for (const [name, code] of Object.entries(pal)) {
      const m = code.match(/\x1b\[38;5;(\d+)m/);
      assert.ok(m, `${name} 应含 256 色编码`);
      const need = MIN_CONTRAST[name] ?? 4.5;
      const r = contrastVs(parseInt(m[1], 10), BG[theme]);
      assert.ok(r >= need, `${name}(${m[1]}) ${theme} 底对比度 ${r.toFixed(2)} < ${need}`);
    }
  });
}

test('调色板防回流：旧浅底色板不能混入 dark 主题、旧 critical 色值不能回流 light', () => {
  // light 旧色在暗底全部不达普通文本 4.5（dim 242→3.25 / healthy 25→2.64），反之 dark 亮色在浅底
  // 同样崩（healthy 39→2.35）——任一主题误用对方色板都会被拦下
  for (const name of ['dim', 'healthy', 'project']) {
    assert.ok(contrastVs(codeOf(LIGHT, name), BG.dark) < 4.5, `light.${name} 在暗底应不达标（防混用）`);
    assert.ok(contrastVs(codeOf(DARK, name), BG.light) < 4.5, `dark.${name} 在浅底应不达标（防混用）`);
  }
  // 208 亮橙（更旧 critical，浅底 2.31:1）保持弃用，防回流
  assert.ok(contrastVs(208, BG.light) < 3);
  // 130（4.5 压线旧 critical）不得回访 critical 位
  assert.notEqual(codeOf(LIGHT, 'critical'), 130);
  assert.notEqual(codeOf(DARK, 'critical'), 130);
});

test('调色板等级辨析（双主题）：critical(红) 与 warn(黄/橙) 色相分离 + 明度双保险（防回流）', () => {
  // 旧 light critical 94(#875f00 黄棕) 与 warn 100(#878700 橄榄黄) 同黄系仅深浅有别 → 换红主导。
  // 绿分量差 >60 拦黄棕系回流（94.g=95 vs warn.g=135 差 40 会被拦下）。
  for (const [theme, pal, bg] of [['dark', DARK, BG.dark], ['light', LIGHT, BG.light]]) {
    const warnRgb = xtermRgb(codeOf(pal, 'warn'));
    const critRgb = xtermRgb(codeOf(pal, 'critical'));
    assert.ok(warnRgb[1] - critRgb[1] > 60, `[${theme}] warn 绿分量应显著高于 critical（黄/橙 vs 红）: warn.g=${warnRgb[1]} crit.g=${critRgb[1]}`);
    assert.ok(critRgb[0] > critRgb[1], `[${theme}] critical 应红主导(r>g): ${critRgb}`);
    const cWarn = contrastVs(codeOf(pal, 'warn'), bg);
    const cCrit = contrastVs(codeOf(pal, 'critical'), bg);
    if (theme === 'light') {
      // 浅底：critical 更深 = 对比度更高
      assert.ok(cCrit > cWarn + 1, `[${theme}] critical 应比 warn 明显更深: ${cCrit.toFixed(2)} vs ${cWarn.toFixed(2)}`);
    } else {
      // 暗底明度反相：critical 更暗沉 = 对比度更低（红在黑底上视觉更重）
      assert.ok(cCrit < cWarn - 1, `[${theme}] critical 应比 warn 明显更暗沉（明度反相）: ${cCrit.toFixed(2)} vs ${cWarn.toFixed(2)}`);
    }
  }
});

test('主题选择：GLM_HUD_THEME 环境变量（默认 dark）、setTheme 切换 C 活绑定', () => {
  assert.equal(themeFromEnv({}), 'dark');
  assert.equal(themeFromEnv({ GLM_HUD_THEME: 'dark' }), 'dark');
  assert.equal(themeFromEnv({ GLM_HUD_THEME: 'light' }), 'light');
  assert.equal(themeFromEnv({ GLM_HUD_THEME: 'nonsense' }), 'dark'); // 非法值回落 dark
  setTheme('light');
  assert.equal(ctxColor(69), LIGHT.healthy);
  assert.equal(C, LIGHT);
  setTheme('dark');
  assert.equal(ctxColor(69), DARK.healthy);
  assert.equal(quotaColor(80), DARK.quotaWarn);
  assert.equal(C, DARK);
  // 非法主题名 → 保持/回落 dark
  setTheme('bogus');
  assert.equal(C, DARK);
});

test('bar: W<=4 窄条空槽用同字形 dimBar █（点阵边缘发虚修复）', () => {
  const b = bar(50, 4, C.healthy); // f = floor(2+0.5) = 2
  assert.equal(stripAnsi(b), '████'); // 同字形，纯色阶区分填充/空槽
  assert.ok(b.includes(C.healthy + '██' + C.dimBar + '██'), '前半健康色、后半 dimBar');
  assert.ok(!b.includes('░'), '窄条不再用 ░ 点阵');
  assert.ok(bar(50, 6, C.healthy).includes('░')); // W>=6 保留 ░ 点阵轻量观感
  assert.ok(bar(0, 4, C.healthy).includes(C.dimBar + '████')); // 0% 全空槽（色前缀仍先发）
});

test('renderLines: MCP 段带百分比，与 Context/5h/周 扫读节奏一致；W<10 窄档丢明细保百分比', () => {
  const wide = renderLines(buildView(PAYLOAD, '/fb'), QUOTA, null, null, 170, NOW);
  const wl2 = stripAnsi(wide[1]);
  assert.ok(wl2.includes('29% 294/1000'), `宽档应带百分比+明细: ${wl2}`);
  const mid = renderLines(buildView(PAYLOAD, '/fb'), QUOTA, null, null, 99, NOW); // W=6 档
  const ml2 = stripAnsi(mid[1]);
  assert.ok(ml2.includes('MCP') && ml2.includes('29%'), `窄档保百分比: ${ml2}`);
  assert.ok(!ml2.includes('294/1000'), `窄档丢 used/total 明细: ${ml2}`);
});

test('renderLines: 70 列两行 Context(L1) 与 ⚡︎5h(L2) 分行共存；60 列退守 badge+dir', () => {
  // 70 列：L1 恰容 ctxCore（badge45+3+22=70），L2 容三配额段
  const lines = renderLines(buildView(PAYLOAD, '/fb'), QUOTA, { branch: 'main', dirty: true }, null, 70, NOW);
  assert.equal(lines.length, 2);
  const [l1, l2] = lines.map(stripAnsi);
  assert.ok(l1.includes('Context'), `Context 在 L1: ${l1}`);
  assert.ok(l2.includes('⚡︎5h'), `⚡︎5h 在 L2: ${l2}`);
  for (const line of lines) assert.ok(displayWidth(line) <= 70, `width ${displayWidth(line)}`);
  // 60 列：短目录名下 ctxCore 档（59 列）恰好放得下 → Context 存活于 L1
  const lines60 = renderLines(buildView(PAYLOAD, '/fb'), QUOTA, { branch: 'main', dirty: true }, null, 60, NOW);
  const l60 = stripAnsi(lines60[0]);
  assert.ok(l60.includes('demo-app') && l60.includes('Context') && !l60.includes('450k/1M'), l60);
  assert.ok(stripAnsi(lines60[1]).includes('⚡︎5h'));
  for (const line of lines60) assert.ok(displayWidth(line) <= 60, `width ${displayWidth(line)}`);
});

test('renderLines: 140 列两行全量共存（重标定回归——修复前 MCP 被误丢）', () => {
  const lines = renderLines(buildView(PAYLOAD, '/fb'), QUOTA, { branch: 'main', dirty: true }, null, 140, NOW);
  assert.equal(lines.length, 2);
  const [l1, l2] = lines.map(stripAnsi);
  assert.ok(l1.includes('Context') && l1.includes('45%'), l1);
  for (const frag of ['⚡︎5h', '24%', '周', '19%', 'MCP', '29%', '294/1000']) {
    assert.ok(l2.includes(frag), `${frag} 应保留: ${l2}`);
  }
  for (const line of lines) assert.ok(displayWidth(line) <= 140, `width ${displayWidth(line)}`);
});

// （原"窄宽度下 env 覆盖警告存活、目录/git 先被丢"用例已并入上方新语义用例：
//   env 段降级为 dim 信息段后优先级最低，窄时最先被丢）

test('renderLines: failed 占位在 L2 全保——60 列两行、57 列 compact 下保 badge+dir', () => {
  const wide = renderLines(buildView(PAYLOAD, '/fb'), { state: 'failed' }, null, null, 60, NOW);
  const wl2 = stripAnsi(wide[1]);
  assert.ok(wl2.includes('⚡︎5h --') && wl2.includes('周 --') && wl2.includes('MCP --'), wl2);
  assert.ok(displayWidth(wide[1]) <= 60);
  // 57 列 compact（用户布局序 dir 在配额前）：dir/git 活得比配额段久——放不下先丢配额尾段
  const narrow = renderLines(buildView(PAYLOAD, '/fb'), { state: 'failed' }, null, null, 57, NOW);
  const nl = stripAnsi(narrow[0]);
  assert.ok(nl.includes('demo-app'), `dir 在配额段之前应后丢: ${nl}`);
  assert.ok(displayWidth(narrow[0]) <= 57);
});

// ── 布局重排（2026-10-10）：Context 移 L1 ── 两行各自预算，明细削减不再互斥

test('renderLines: 110 列两行全量——Context(L1) 与配额含明细(L2) 互不挤占', () => {
  const lines = renderLines(buildView(PAYLOAD, '/fb'), QUOTA, { branch: 'main', dirty: true }, null, 110, NOW);
  assert.equal(lines.length, 2);
  const [l1, l2] = lines.map(stripAnsi);
  for (const frag of ['Context', '45%', '450k/1M']) assert.ok(l1.includes(frag), `L1 ${frag}: ${l1}`);
  for (const frag of ['⚡︎5h', '24%', '周', '19%', 'MCP', '29%', '294/1000']) {
    assert.ok(l2.includes(frag), `L2 ${frag}: ${l2}`);
  }
  for (const line of lines) assert.ok(displayWidth(line) <= 110, `width ${displayWidth(line)}`);
});

test('renderLines: 降级序（L1）——明细未超宽时不白削；差 1 列只削 ctx 绝对值', () => {
  // 长目录名把 L1 全量顶进 W=10 档且超宽，才测得到「档 2 胜出」（短目录下
  // 列宽档位从 10 缩到 4 自愈，永远走不到削减档——bar 宽自适应是特性不是 bug）
  const longDir = '/fb/' + 'x'.repeat(60);
  const view = buildView({ ...PAYLOAD, workspace: { current_dir: longDir } }, '/fb');
  const wFull = displayWidth(renderLines(view, { state: 'omit' }, null, null, 500, NOW)[0]);
  assert.ok(wFull >= 100, `前置：全量应落在 W=10 档，wFull=${wFull}`);
  // 恰好全量宽 → 什么都不削
  const full = renderLines(view, { state: 'omit' }, null, null, wFull, NOW);
  assert.ok(stripAnsi(full[0]).includes('450k/1M'), stripAnsi(full[0]));
  assert.ok(displayWidth(full[0]) <= wFull);
  // 全量宽 -1 → 容不下全量但容得下削 ctx 明细（省 8 列）→ 只削 ctx 绝对值，dir/git 保留
  const mid = renderLines(view, { state: 'omit' }, null, null, wFull - 1, NOW);
  const m1 = stripAnsi(mid[0]);
  assert.ok(!m1.includes('450k/1M'), `应削 ctx 绝对值: ${m1}`);
  assert.ok(m1.includes('Context') && m1.includes('xxxx'), `dir 与 ctx 段保留: ${m1}`);
  assert.ok(displayWidth(mid[0]) <= wFull - 1, `width ${displayWidth(mid[0])}`);
});

test('renderLines: ctx 无百分比时绝对值段随 L1 预算（70 列下存活）', () => {
  const base = buildView({ model: {}, context_window: { context_window_size: 1000000, total_input_tokens: null } }, '/fb');
  const view = { ...base, ctx: { percent: null, used: 85000, size: 1000000 } };
  const lines = renderLines(view, QUOTA, null, null, 70, NOW);
  const [l1, l2] = lines.map(stripAnsi);
  assert.ok(l1.includes('85k/1M'), `70 列 L1 应保住纯绝对值段: ${l1}`);
  assert.ok(l2.includes('⚡︎5h') && l2.includes('MCP'), `配额段在 L2: ${l2}`);
  for (const line of lines) assert.ok(displayWidth(line) <= 70, `width ${displayWidth(line)}`);
});

test('renderLines: 窗口重置后旧快照过期 → 丢弃该段，不再挂 剩0m 高百分比', () => {
  // fetchedAt 落后 resetsAt 20 分钟，且已过 resetsAt+5min 宽限 → 5h 段过期丢弃
  const stale = {
    state: 'show',
    limits: {
      fiveHour: { percent: 95, resetsAt: NOW - 10 * 60_000 },
      week: { percent: 19, resetsAt: NOW + (2 * 86400 + 14 * 3600) * 1000 },
      mcp: null, level: 'pro', fetchedAt: NOW - 20 * 60_000,
    },
  };
  const all = renderLines(buildView(PAYLOAD, '/fb'), stale, null, null, 200, NOW).map(stripAnsi).join('\n');
  assert.ok(!all.includes('⚡︎5h'), `过期 5h 段应丢弃: ${all}`);
  assert.ok(!all.includes('95%') && !all.includes('剩0m'), all);
  assert.ok(all.includes('周') && all.includes('19%'), '未过期的周窗口保留');

  // 全部窗口过期 → 回落 dim 占位（配额组不无声消失）
  const allStale = {
    state: 'show',
    limits: {
      fiveHour: { percent: 95, resetsAt: NOW - 10 * 60_000 },
      week: { percent: 25, resetsAt: NOW - 8 * 60_000 },
      mcp: { used: 309, total: 1000, percent: 30, resetsAt: NOW - 6 * 60_000 },
      level: 'pro', fetchedAt: NOW - 20 * 60_000,
    },
  };
  const all2 = renderLines(buildView(PAYLOAD, '/fb'), allStale, null, null, 200, NOW).map(stripAnsi).join('\n');
  assert.ok(all2.includes('⚡︎5h --') && all2.includes('周 --') && all2.includes('MCP --'), all2);
  assert.ok(!all2.includes('95%') && !all2.includes('剩0m'), all2);

  // 宽限期内（重置刚过 2 分钟）→ 沿用旧值渲染 剩0m，属可容忍瞬态
  const grace = {
    state: 'show',
    limits: {
      fiveHour: { percent: 95, resetsAt: NOW - 2 * 60_000 },
      week: null, mcp: null, level: 'pro', fetchedAt: NOW - 3 * 60_000,
    },
  };
  const all3 = renderLines(buildView(PAYLOAD, '/fb'), grace, null, null, 200, NOW).map(stripAnsi).join('\n');
  assert.ok(all3.includes('⚡︎5h') && all3.includes('95% 剩0m'), all3);
});

// ── GLM_HUD_HIDE 段开关（2026-10-10）─────────────────────────────────

test('hideSetFromEnv: 空缺省全显、逗号分隔、未知段忽略、大小写与空格容忍', () => {
  assert.equal(hideSetFromEnv(null).size, 0);
  assert.equal(hideSetFromEnv({}).size, 0);
  assert.equal(hideSetFromEnv({ GLM_HUD_HIDE: '' }).size, 0);
  assert.deepEqual([...hideSetFromEnv({ GLM_HUD_HIDE: 'mcp' })], ['mcp']);
  assert.deepEqual([...hideSetFromEnv({ GLM_HUD_HIDE: ' MCP , week' })], ['mcp', 'week']);
  assert.deepEqual([...hideSetFromEnv({ GLM_HUD_HIDE: 'mcp,bogus,ctx' })], ['mcp', 'ctx']);
  assert.ok(HIDE_KEYS.includes('ctxabs') && HIDE_KEYS.length === 10);
});

test('renderLines hide: 单段（mcp）/多段，未知段无影响', () => {
  const v = buildView(PAYLOAD, '/fb');
  const full = renderLines(v, QUOTA, null, null, 140, NOW, new Set(['mcp']));
  assert.ok(!stripAnsi(full.join('\n')).includes('MCP'), 'mcp 隐藏');
  assert.ok(stripAnsi(full[1]).includes('⚡︎5h') && stripAnsi(full[1]).includes('周'), '其余配额保留');
  const multi = renderLines(v, QUOTA, null, null, 140, NOW, new Set(['mcp', 'week', 'fiveHour']));
  assert.equal(multi.length, 1, '三配额段全隐藏 → L2 空 → 单行 L1');
  assert.ok(!stripAnsi(multi[0]).includes('⚡︎5h'), '5h 隐藏');
  assert.ok(!stripAnsi(multi[0]).includes('MCP'), 'MCP 隐藏');
  const same = renderLines(v, QUOTA, null, null, 140, NOW, new Set(['bogus1', 'bogus2']));
  assert.ok(stripAnsi(same[1]).includes('MCP'), '未知段名忽略=全显');
});

test('renderLines hide: ctx 与 ctxabs 分级；badge/effort/dir/branch/env 各自生效', () => {
  const v = buildView(PAYLOAD, '/fb');
  const hideAbs = renderLines(v, { state: 'omit' }, null, null, 200, NOW, new Set(['ctxabs']));
  const l1abs = stripAnsi(hideAbs[0]);
  assert.ok(l1abs.includes('Context') && l1abs.includes('45%'), 'ctxabs 只去绝对值');
  assert.ok(!l1abs.includes('450k/1M'), '绝对值已隐藏');
  const hideCtx = renderLines(v, { state: 'omit' }, null, null, 200, NOW, new Set(['ctx']));
  assert.ok(!stripAnsi(hideCtx[0]).includes('Context'), 'ctx 整段隐藏');
  const g = { branch: 'main', dirty: true };
  const hideBits = renderLines(v, QUOTA, g, 'env默认:flash', 200, NOW, new Set(['badge', 'effort', 'dir', 'branch', 'env']));
  const txt = stripAnsi(hideBits.join('\n'));
  assert.ok(!txt.includes('GLM-5.3'), 'badge 隐藏');
  assert.ok(!txt.includes('high'), 'effort 隐藏');
  assert.ok(!txt.includes('demo-app'), 'dir 隐藏');
  assert.ok(!txt.includes('git:('), 'branch 隐藏');
  assert.ok(!txt.includes('env默认'), 'env 隐藏');
  assert.ok(txt.includes('⚡︎5h'), '配额不受影响');
});

test('renderLines hide: 全隐藏 → [hud] 兜底；HIDE×窄终端 compact 叠加', () => {
  const v = buildView(PAYLOAD, '/fb');
  const all = renderLines(v, { state: 'omit' }, null, null, 140, NOW,
    new Set(['badge', 'effort', 'dir', 'branch', 'ctx', 'ctxabs', 'env']));
  assert.deepEqual(all.map(stripAnsi), ['[hud]'], '全隐藏兜底');
  const allQ = renderLines(v, QUOTA, g0(), 'env默认:flash', 140, NOW,
    new Set(['badge', 'effort', 'dir', 'branch', 'ctx', 'ctxabs', 'env']));
  assert.ok(stripAnsi(allQ[0]).includes('⚡︎5h'), '配额仍在');
  // 窄终端 + HIDE：compact 里被隐藏段不出现、宽度守恒
  const narrow = renderLines(v, QUOTA, g0(), null, 52, NOW, new Set(['dir', 'branch', 'mcp']));
  const nt = stripAnsi(narrow[0]);
  assert.ok(!nt.includes('demo-app') && !nt.includes('MCP'), nt);
  assert.ok(displayWidth(narrow[0]) <= 52);
  function g0() { return { branch: 'main', dirty: true }; }
});
