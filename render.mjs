// render.mjs — 纯渲染：双主题调色板（dark 默认/light）、分段模板、宽度适配与单行降级
import { RESET, clamp, roundHalfUp, formatCountdown, formatTokens } from './parse.mjs';

// ── 双主题调色板（同一角色两主题色相保持对应：浅底用深色、暗底用亮色）──────────
// light（浅底 #fafafa，light-daltonized 适配）；括号内为对 #fafafa 的 WCAG 对比度实测：
// dim 242 灰(5.0)；空░245 灰(3.3，图形件按非文本 3:1——249 的 2.0 在浅底失去容器轮廓)；
// model/branch 23 深青(7.2)；project 58 深橄榄(6.4)；git 127 紫(5.9)；健康=深蓝 25(6.2，色盲安全对)；
// 警告=深黄 100 加粗(3.7，蓝↔黄是色盲安全轴)；危险=砖红 124 加粗(7.1)——
// 视觉评审三轮：94 深黄棕与 warn 100 同黄系仅深浅有别，跨屏等级辨析弱 → 换 124 红；
// 旧 critical 130(4.5 压线)/208 亮橙(2.3)/94(黄系难辨)均已弃用，测试防回流
export const LIGHT = {
  dim: '\x1b[38;5;242m',
  dimBar: '\x1b[38;5;245m',
  model: '\x1b[38;5;23m',
  project: '\x1b[38;5;58m',
  git: '\x1b[38;5;127m',
  branch: '\x1b[38;5;23m',
  healthy: '\x1b[38;5;25m',
  warn: '\x1b[1m\x1b[38;5;100m',
  critical: '\x1b[1m\x1b[38;5;124m',
  quotaWarn: '\x1b[1m\x1b[38;5;133m',
};

// dark（暗底 #1c1c1c，默认主题——用户真实终端为黑底）；对 #1c1c1c 的 WCAG 对比度实测：
// dim 246 灰(5.6)；空░242 灰(3.25，非文本 3:1 图形件，明显淡于 dim 文本)；
// model/branch 80 亮青(9.9，对应 light 23 深青)；project 143 亮橄榄(7.4，对应 58)；
// git 176 亮品红(6.8，对应 127)；健康=亮蓝 39(7.0，对应 25 深蓝，蓝↔橙色盲安全轴不变)；
// 警告=亮橙黄 214 加粗(9.2，对应 100 深黄)；危险=亮红 203 加粗(5.7，对应 124 砖红)；
// quotaWarn=亮紫 213 加粗(8.3，对应 133)。升温链 蓝→橙黄→红 明度反相（暗底上红最暗沉）但
// 色相分离不变：warn.g(175) - critical.g(95) = 80 > 60，色弱下仍可辨
export const DARK = {
  dim: '\x1b[38;5;246m',
  dimBar: '\x1b[38;5;242m',
  model: '\x1b[38;5;80m',
  project: '\x1b[38;5;143m',
  git: '\x1b[38;5;176m',
  branch: '\x1b[38;5;80m',
  healthy: '\x1b[38;5;39m',
  warn: '\x1b[1m\x1b[38;5;214m',
  critical: '\x1b[1m\x1b[38;5;203m',
  quotaWarn: '\x1b[1m\x1b[38;5;213m',
};

const PALETTES = { dark: DARK, light: LIGHT };

// 活动调色板：默认 dark（黑底终端）；GLM_HUD_THEME=light 切浅色板。
// C 为模块级 let 活绑定，render*/ctxColor/quotaColor 经 C.* 取色随 setTheme 切换
export let C = DARK;

export function setTheme(name) { C = PALETTES[name] || DARK; }
export function themeFromEnv(env) {
  return env && env.GLM_HUD_THEME === 'light' ? 'light' : 'dark';
}

// ── 段开关：GLM_HUD_HIDE（逗号分隔黑名单，默认全显）────────────────────────
// ctx=Context 整段；ctxabs=仅绝对值明细（90k/200k）；其余与视觉段同名。
// 未知段名忽略；某行内容全部被隐藏则该行不输出；两行全空保留 '[hud]' 兜底。
export const HIDE_KEYS = ['badge', 'effort', 'dir', 'branch', 'ctx', 'ctxabs', 'env', 'fiveHour', 'week', 'mcp'];

export function hideSetFromEnv(env) {
  const raw = env && typeof env.GLM_HUD_HIDE === 'string' ? env.GLM_HUD_HIDE : '';
  const set = new Set();
  for (const tok of raw.split(',')) {
    const k = tok.trim().toLowerCase();
    // 大小写不敏感匹配后回落到规范拼写：fiveHour 是唯一带大写的键，
    // 直接 includes(k) 会把文档写的 GLM_HUD_HIDE=fiveHour 变 fivehour 静默丢弃
    const key = HIDE_KEYS.find((name) => name.toLowerCase() === k);
    if (key) set.add(key);
  }
  return set;
}

// ⚡/⚠ 一律带 VS15(U+FE0E) 文本变体选择符：U+26A1 按 Unicode 默认是 emoji-presentation，
// 真实终端（iTerm2/Terminal.app 常见配置）里会渲染成双宽彩色 emoji 挤乱整行等宽对齐；
// VS15 锁定窄文本字形，displayWidth 对其计 0 列（见 charWidth）。
export const BOLT = '⚡︎';   // ⚡︎ 5h 窗口标签
export const WARN_SIGN = '⚠︎'; // ⚠︎ 配额 critical 段前缀

export function ctxColor(p) { return p >= 85 ? C.critical : p >= 70 ? C.warn : C.healthy; }
export function quotaColor(p) { return p >= 90 ? C.critical : p >= 75 ? C.quotaWarn : C.healthy; }
// 100+ 列全宽条（超宽时先削 ctx/MCP 明细保整段，见 renderLines 降级链）；
// 80-99 中条（Context+⚡5h+周 三段约 73 列可共存；MCP 无明细档 ~86 列，W<10 本就无明细）；
// 60-79 窄条（60 列两行仍保得住 Context+⚡5h）；<60 compact 同用 4
export function barWidthFor(cols) { return cols >= 100 ? 10 : cols >= 80 ? 6 : 4; }

// ── 显示宽度：CJK 等真宽区按 2 列；跳过 CSI/OSC ──
// 2026-10-09 视觉评审重标定：█░⚡⚠│↻· 等 ambiguous 字形此前保守计 2 列，导致 140 列下
// L2 只画到约半行就丢弃 周/MCP 段；实测预览管线与主流终端（Terminal.app/iTerm2/VS Code
// 默认 ambiguous=窄）均占 1 列，故改按 1 列计（CJK 恒 2 列不变）。
function charWidth(cp) {
  if (cp < 0x20 || cp === 0x7f) return 0;
  if (cp === 0xfe0e || cp === 0xfe0f) return 0; // VS15/VS16 变体选择符零宽（⚡︎/⚠︎ 携带）
  if ((cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x20000 && cp <= 0x3fffd)) {
    return 2;
  }
  return 1; // █░(2580-259f) ⚡⚠(2600-27bf) │(2500-257f) ↻(2190-21ff) ·(00b7)：ambiguous 实测 1 列
}

function skipEscape(s, i) {
  // s[i] === ESC；返回整个转义序列的字符数
  const c1 = s[i + 1];
  if (c1 === '[') { // CSI … final[@-~]
    let j = i + 2;
    while (j < s.length && !/[@-~]/.test(s[j])) j++;
    return j + 1 - i;
  }
  if (c1 === ']') { // OSC … (BEL | ESC \)
    let j = i + 2;
    while (j < s.length) {
      if (s[j] === '\x07') return j + 1 - i;
      if (s[j] === '\x1b' && s[j + 1] === '\\') return j + 2 - i;
      j++;
    }
    return j - i;
  }
  return 2;
}

export function displayWidth(s) {
  let w = 0;
  let i = 0;
  while (i < s.length) {
    if (s.charCodeAt(i) === 0x1b) { i += skipEscape(s, i); continue; }
    const cp = s.codePointAt(i);
    w += charWidth(cp);
    i += cp > 0xffff ? 2 : 1;
  }
  return w;
}

// 超宽回绕：优先在 │ / | 分隔符处断行，否则硬截断，尾加 '...' + reset
export function truncateAnsi(s, maxW) {
  if (displayWidth(s) <= maxW) return s;
  for (const sep of [' │ ', ' | ']) {
    let idx = -1;
    let best = -1;
    while ((idx = s.indexOf(sep, idx + 1)) !== -1) {
      if (displayWidth(s.slice(0, idx)) <= maxW - 3) best = idx;
    }
    if (best >= 0) return s.slice(0, best).replace(/[ \t]+$/, '') + '...' + RESET;
  }
  let out = '';
  let w = 0;
  let i = 0;
  while (i < s.length) {
    if (s.charCodeAt(i) === 0x1b) { const n = skipEscape(s, i); out += s.slice(i, i + n); i += n; continue; }
    const cp = s.codePointAt(i);
    const cw = charWidth(cp);
    const len = cp > 0xffff ? 2 : 1;
    if (w + cw > maxW - 3) break;
    out += s.slice(i, i + len);
    w += cw;
    i += len;
  }
  return out + '...' + RESET;
}

// ── 分段模板 ────────────────────────────────────────────────────────
const osc8 = (url, text) => '\x1b]8;;' + url + '\x1b\\' + text + '\x1b]8;;\x1b\\';

export function lastDir(cwd) {
  if (typeof cwd !== 'string' || !cwd) return '';
  const parts = cwd.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || '/';
}

// 进度条：<色>█×f + <dim>░×e + reset；f = half-up(p/100×W)
// W<=4 窄条空槽改同字形 dimBar █：░ 点阵只剩 2-3 格时边缘发虚（视觉评审三轮），
// 同字形纯色阶区分填充/空槽，边界锐利；W>=6 保留 ░ 点阵的轻量观感
export function bar(percent, W, color) {
  const p = clamp(percent, 0, 100);
  const f = clamp(Math.floor((p / 100) * W + 0.5), 0, W);
  const empty = W <= 4 ? '█'.repeat(W - f) : '░'.repeat(W - f);
  return color + '█'.repeat(f) + C.dimBar + empty + RESET;
}

function badgeText(view) {
  return C.model + '[' + view.modelName + (view.effort ? '·' + view.effort : '') + ']' + RESET;
}

function dirGitSegment(view, git) {
  const name = lastDir(view.cwd);
  const dirText = name ? osc8('file://' + view.cwd, C.project + name + RESET) : '';
  const gitText = git && git.branch
    ? C.git + 'git:(' + RESET + C.branch + git.branch + (git.dirty ? '*' : '') + RESET + C.git + ')' + RESET
    : '';
  return [dirText, gitText].filter(Boolean).join(' ');
}

// env 默认模型信息段：低调 dim 灰、无 ⚠ 无加粗无红（警示样式只保留给配额 >=90 的 critical 段）
function envNoteText(note) {
  return note ? C.dim + note + RESET : '';
}

export function ctxSegment(view, W, detail = true) {
  const { percent, used, size } = view.ctx;
  if (percent === null) {
    // 无百分比：绝对值即整段本体（detail=false 时整段无剩余内容 → null，预算 pass 据此逐级降级）
    if (detail && used !== null && size) {
      return C.dim + 'Context' + RESET + ' ' + C.dim + formatTokens(used) + '/' + formatTokens(size) + RESET;
    }
    return null;
  }
  const col = ctxColor(percent);
  let s = C.dim + 'Context' + RESET + ' ' + bar(percent, W, col) + ' ' + col + percent + '%' + RESET;
  if (detail && used !== null && size) s += ' ' + C.dim + formatTokens(used) + '/' + formatTokens(size) + RESET;
  return s;
}

function cdOf(resetsAt, now) {
  // 「剩」前缀（原 ↻ U+21BB 渲染约 60% x 高且贴基线，1× 下「↻41m」易扫成「'41m」）：
  // CJK 全高字形无 tofu 风险，与 周 标签的中文混排风格一致
  return '剩' + formatCountdown(resetsAt === null ? null : resetsAt - now);
}

// 5h / 周窗口段；>=90 整段 critical（红=警示，不再另加行）
function windowSegment(label, win, W, now) {
  if (!win || !Number.isFinite(win.percent)) return null; // 数据不完整 → 整段省略，绝不渲染 NaN
  const p = clamp(win.percent, 0, 100);
  const cd = cdOf(win.resetsAt, now);
  if (p >= 90) {
    return C.critical + WARN_SIGN + ' ' + label + ' ' + bar(p, W, C.critical) + ' ' + C.critical + p + '% ' + cd + RESET;
  }
  const col = quotaColor(p);
  return C.dim + label + RESET + ' ' + bar(p, W, col) + ' ' + col + p + '%' + RESET + ' ' + cd;
}

function mcpSegment(m, W, now, detail = true) {
  if (!m || !Number.isFinite(m.used)) return null; // 数据不完整 → 整段省略
  const hasTotal = Number.isFinite(m.total) && m.total > 0;
  if (!hasTotal) {
    // 降级：只有已用数时 dim 显示次数，绝不显示成 used/used 剩 0
    const cd = m.resetsAt !== null ? ' ' + cdOf(m.resetsAt, now) : '';
    return C.dim + 'MCP ' + m.used + ' 次' + RESET + cd;
  }
  const p = m.percent !== null && m.percent !== undefined && Number.isFinite(m.percent)
    ? clamp(m.percent, 0, 100)
    : clamp(roundHalfUp((m.used / m.total) * 100), 0, 100);
  if (!Number.isFinite(p)) return null;
  const cd = m.resetsAt !== null ? ' ' + cdOf(m.resetsAt, now) : '';
  // 与 Context/5h/周 段统一「bar + N%」扫读节奏（视觉评审三轮）；used/total 明细只在
  // 宽条档(W>=10，即 >=100 列)输出且可被预算 pass 先于整段丢弃（丢明细保整段）
  const detailStr = detail && W >= 10 ? ' ' + m.used + '/' + m.total : '';
  if (p >= 90) {
    return C.critical + WARN_SIGN + ' MCP ' + bar(p, W, C.critical) + ' ' + C.critical + p + '%' + detailStr + cd + RESET;
  }
  return C.dim + 'MCP' + RESET + ' ' + bar(p, W, quotaColor(p)) + ' ' + quotaColor(p) + p + '%' + RESET
    + (detailStr ? ' ' + C.dim + m.used + '/' + m.total + RESET : '') + cd;
}

// 窗口重置后的宽限：快照取自上一窗口（fetchedAt < resetsAt）且已过 resetsAt + 宽限 → 视为过期。
// 防止 fetch 持续失败（换 token/端点变更）时，早已重置的窗口无限期渲染高百分比 + ↻0m
export const QUOTA_STALE_GRACE_MS = 5 * 60_000;

function staleWin(win, fetchedAt, now) {
  if (!win || !Number.isFinite(win.resetsAt)) return false;
  if (!(now > win.resetsAt + QUOTA_STALE_GRACE_MS)) return false;
  return !Number.isFinite(fetchedAt) || fetchedAt < win.resetsAt;
}

// dim 占位（fetch 失败无缓存 / 全部窗口过期）：拆三个独立短段参与逐段丢弃，不许配额组无声消失
function dimPlaceholders(hide) {
  const h = (k) => hide && hide.has(k);
  return [
    !h('fiveHour') ? C.dim + BOLT + '5h --' + RESET : null,
    !h('week') ? C.dim + '周 --' + RESET : null,
    !h('mcp') ? C.dim + 'MCP --' + RESET : null,
  ].filter(Boolean);
}

// quotaState: {state:'omit'} | {state:'failed'} | {state:'show', limits}；hide: Set 段开关
export function quotaSegments(quotaState, W, now, mcpDetail = true, hide = null) {
  if (!quotaState || quotaState.state === 'omit') return [];
  const h = (k) => hide && hide.has(k);
  if (quotaState.state === 'failed') return dimPlaceholders(hide);
  const q = quotaState.limits || {};
  const wins = [q.fiveHour, q.week, q.mcp].filter(Boolean);
  const out = [
    !h('fiveHour') && !staleWin(q.fiveHour, q.fetchedAt, now) ? windowSegment(BOLT + '5h', q.fiveHour, W, now) : null,
    !h('week') && !staleWin(q.week, q.fetchedAt, now) ? windowSegment('周', q.week, W, now) : null,
    !h('mcp') && !staleWin(q.mcp, q.fetchedAt, now) ? mcpSegment(q.mcp, W, now, mcpDetail) : null,
  ].filter(Boolean); // 过期/数据不完整/被隐藏的段在此过滤
  // 全部窗口都过期 → 回落 dim 占位：状态是"未知"而非"上一窗口的旧值"，配额组仍不无声消失
  if (out.length === 0 && wins.length > 0 && wins.every((w) => staleWin(w, q.fetchedAt, now))) {
    const ph = dimPlaceholders(hide);
    return ph.length > 0 ? ph : [];
  }
  return out;
}

function joinAndDrop(parts, sep, cols, minKeep) {
  let arr = parts.slice();
  const min = Math.max(1, minKeep);
  while (arr.length > min && displayWidth(arr.join(sep)) > cols) arr.pop();
  return arr.join(sep);
}

// 主入口：返回 1 或 2 行（绝不超过 2 行）
// 宽度策略：>=60 列两行（放不下按段丢弃）；<60 列（claude-hud 窄端阈值）降级 compact 单行
// 2026-10-10 布局（用户要求）：Context 上移到 L1 目录/分支之后——
//   L1 = [徽章·1M·effort] │ 目录 git:(分支*) │ Context ██░░ 45% 90k/200k │ env默认:xxx
//   L2 = ⚡5h ██░░ 18% 剩41m │ 周 ███░░ 19% 剩2d8h │ MCP ██░░ 309/1000 剩3h
// 预算 pass 两行独立：L1 依次「全量 → 削 ctx 绝对值 → 去 ctx 整段」，L2「全量 → 削 MCP 明细」，
// 各自取首个不超宽档；仍超宽才 joinAndDrop 丢整段（L2: MCP → 周 → ⚡5h；L1: env默认 → ctx → dir）。
// hide（GLM_HUD_HIDE）：badge/effort/dir/branch/ctx/ctxabs/env/fiveHour/week/mcp
export function renderLines(view, quotaState, git, envNote, colsRaw, now, hide = null) {
  const cols = Math.max(20, Math.floor(colsRaw) || 100);
  const W = barWidthFor(cols);
  const h = (k) => (hide && hide.has(k)) || false;

  // hide 以防御拷贝消化：复用既有段逻辑，不侵入各 segment 函数
  if (h('effort') && view.effort) view = { ...view, effort: null };
  if (h('dir') && view.cwd) view = { ...view, cwd: '' };
  if (h('branch') && git && git.branch) git = { ...git, branch: null };
  if (h('ctx')) view = { ...view, ctx: { percent: null, used: null, size: null } };
  else if (h('ctxabs') && (view.ctx.used !== null || view.ctx.size !== null)) {
    view = { ...view, ctx: { percent: view.ctx.percent, used: null, size: null } };
  }
  const noteSeg = h('env') ? '' : envNoteText(envNote);
  const badge = h('badge') ? '' : badgeText(view);

  const dg = dirGitSegment(view, git);
  const qs = quotaSegments(quotaState, W, now, true, hide);
  const qsTrim = quotaSegments(quotaState, W, now, false, hide);
  const ctxFull = ctxSegment(view, W, true);
  const ctxCore = ctxSegment(view, W, false);

  const l1has = Boolean(badge || dg || ctxFull || ctxCore || noteSeg);
  const l2has = qs.length > 0;

  // 两行全空（过度 HIDE）→ 兜底标识行，绝不输出空行
  if (!l1has && !l2has) return ['[hud]'];

  // L1 预算（单行/两行共用）：全量 → 削 ctx 绝对值 → 去 env默认段 → 去 ctx 整段；
  // 仍超宽 joinAndDrop（从尾丢 dir）。价值序：badge > dir/git > ctx > note——
  // Context 虽被点名上移，窄端仍不挤掉"你在哪"
  const l1cands = [
    [badge, dg, ctxFull, noteSeg],
    [badge, dg, ctxCore, noteSeg],
    [badge, dg, ctxCore],
    [badge, dg],
  ];
  const pickL1 = () => {
    for (const parts of l1cands) {
      const list = parts.filter(Boolean);
      if (list.length === 0) return '';
      const joined = list.join(' │ ');
      if (displayWidth(joined) <= cols) return joined;
    }
    const last = l1cands[l1cands.length - 1].filter(Boolean);
    return joinAndDrop(last, ' │ ', cols, 1);
  };

  // 窄终端（<60 列）→ 一律 compact 单行：badge │ dir/git │ ctx │ 配额 │ env默认（用户布局序）
  // （判断须在"无 L2 收单行"之前——否则无配额时窄端漏进 expanded 风格）
  if (cols < 60) {
    return [compactLine(view, badge, dg, noteSeg, qs, cols, W)];
  }

  // 无任何 L2 素材 → 单行 L1（expanded 风格 ' │ '）
  if (!l2has) {
    return [truncateAnsi(pickL1(), cols)];
  }

  const l1raw = pickL1();

  // L2 预算：全量 → 削 MCP 明细；仍超宽 joinAndDrop（MCP → 周 → ⚡5h，minKeep 保 5h）
  let l2raw = null;
  for (const q of [qs, qsTrim]) {
    const joined = q.join(' │ ');
    if (q.length > 0 && displayWidth(joined) <= cols) { l2raw = joined; break; }
  }
  if (l2raw === null) {
    const q = qsTrim.length > 0 ? qsTrim : qs;
    l2raw = joinAndDrop(q, ' │ ', cols, 1);
  }

  if (!l1has) return [truncateAnsi(l2raw, cols)];
  if (displayWidth(l1raw) <= cols && displayWidth(l2raw) <= cols) {
    return [truncateAnsi(l1raw, cols), truncateAnsi(l2raw, cols)];
  }
  // 两行怎么丢都放不下（单段超宽）→ 终极兜底 compact 单行 + 截断
  return [compactLine(view, badge, dg, noteSeg, qs, cols, W)];
}

// compact/终极兜底单行（用户布局序）：badge │ dir/git │ C 条 % │ 配额段 │ env默认段
// （joinAndDrop 从尾丢：note → 配额尾段 → … → ctx → dir）
function compactLine(view, badge, dg, noteSeg, qs, cols, W) {
  const parts = [badge];
  if (dg) parts.push(dg);
  if (view.ctx.percent !== null) {
    // 「C」极短 dim 标签：compact 态裸 45% 无归属线索（视觉评审三轮），1 列标签换低歧义
    parts.push(C.dim + 'C' + RESET);
    parts.push(bar(view.ctx.percent, W, ctxColor(view.ctx.percent)));
    parts.push(ctxColor(view.ctx.percent) + view.ctx.percent + '%' + RESET);
  }
  parts.push(...qs);
  if (noteSeg) parts.push(noteSeg);
  return truncateAnsi(joinAndDrop(parts.filter(Boolean), ' | ', cols, 1), cols);
}
