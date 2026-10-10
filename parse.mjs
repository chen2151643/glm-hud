// parse.mjs — 纯函数：payload 规范化 / GLM 配额解析 / 格式化
// 无任何 IO；测试只打这里与 render.mjs。

export const RESET = '\x1b[0m';

export function asNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function roundHalfUp(x) {
  return Math.floor(x + 0.5);
}

// ── 模型名映射 ──────────────────────────────────────────────────────
// glm-5.3[1m] → GLM-5.3·1M（[] 后缀转 · 前缀）；display_name 由调用方优先传入。
export function mapModelName(raw) {
  let s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return '';
  s = s.replace(/\[([^\[\]]*)\]$/, (_m, inner) => (inner ? '·' + inner.toUpperCase() : ''));
  if (/^glm-/i.test(s)) s = 'GLM-' + s.slice(4);
  return s;
}

// env 模型短名：去掉与 payload model.id 的公共前缀（glm-5.3-flash vs glm-5.3 → flash），
// 再剥掉 [1M] 这类尺寸后缀（显示 env默认:flash 而非 flash[1M]）
export function shortEnvModelName(payloadId, envModel) {
  const a = String(payloadId).toLowerCase();
  const b = String(envModel);
  const stripSize = (s) => s.replace(/\[[^\[\]]*\]$/, '');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i].toLowerCase()) i++;
  const tail = stripSize(b.slice(i).replace(/^[-._]+/, ''));
  return tail || stripSize(b);
}

// env 默认模型信息段：ANTHROPIC_MODEL 只决定【新会话】的默认模型，当前会话实际用
// payload 里的 model.id——不一致不构成"覆盖"，不是警告，只给低调提示（措辞禁用"覆盖"）
export function envDefaultNote(payload, env) {
  const id = payload && payload.model ? payload.model.id : null;
  const envModel = env ? env.ANTHROPIC_MODEL : null;
  if (typeof id !== 'string' || !id || typeof envModel !== 'string' || !envModel) return null;
  if (id.trim().toLowerCase() === envModel.trim().toLowerCase()) return null;
  return 'env默认:' + shortEnvModelName(id, envModel);
}

// ── 上下文 ──────────────────────────────────────────────────────────
// tokens = input + cache_creation + cache_read（引擎 uWe() 同公式，不含 output）
export function sumUsageTokens(u) {
  if (!u || typeof u !== 'object') return null;
  const input = asNumber(u.input_tokens);
  if (input === undefined) return null;
  return input + (asNumber(u.cache_creation_input_tokens) ?? 0) + (asNumber(u.cache_read_input_tokens) ?? 0);
}

export function contextFromPayload(payload) {
  const cw = payload && typeof payload.context_window === 'object' ? payload.context_window : null;
  return {
    size: asNumber(cw?.context_window_size) ?? null,
    percentRaw: asNumber(cw?.used_percentage) ?? null,
    used: asNumber(cw?.total_input_tokens) ?? sumUsageTokens(cw?.current_usage),
  };
}

export function finalizePercent(percentRaw, used, size) {
  if (percentRaw !== null) return clamp(roundHalfUp(percentRaw), 0, 100);
  if (used !== null && size !== null && size > 0) return clamp(roundHalfUp((used / size) * 100), 0, 100);
  return null;
}

// transcript 尾部兜底：从后往前找最后一条带 message.usage 的行（首行可能是半截 JSON，parse 失败跳过）
export function usageFromTranscriptChunk(text) {
  if (!text) return null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || line.indexOf('"usage"') === -1) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const t = sumUsageTokens(obj?.message?.usage) ?? sumUsageTokens(obj?.usage);
    if (t !== null) return t;
  }
  return null;
}

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

// id 尾部 [1M]/[1m] 尺寸后缀（档位信息）；display_name 实测常不带（"glm-5.3" + id "glm-5.3[1M]"），
// 缺失时合并进徽章，否则只显示 [GLM-5.3] 丢了 1M 档位
const sizeSuffixOf = (id) => {
  if (typeof id !== 'string') return null;
  const m = id.match(/\[([^\[\]]+)\]$/);
  return m ? m[1].toUpperCase() : null;
};

export function buildView(payload, fallbackCwd) {
  const model = payload && typeof payload.model === 'object' ? payload.model : null;
  const displayName = typeof model?.display_name === 'string' ? model.display_name.trim() : '';
  let modelName = mapModelName(displayName || model?.id) || 'CC';
  const size = sizeSuffixOf(model?.id);
  if (size && displayName && !/\[[^\[\]]*\]$/.test(displayName)) modelName += '·' + size;
  const effortRaw = payload?.effort?.level;
  const effort = typeof effortRaw === 'string' && EFFORTS.has(effortRaw) ? effortRaw : null;
  let cwd = '';
  if (typeof payload?.workspace?.current_dir === 'string' && payload.workspace.current_dir) cwd = payload.workspace.current_dir;
  else if (typeof payload?.cwd === 'string' && payload.cwd) cwd = payload.cwd;
  else if (typeof fallbackCwd === 'string' && fallbackCwd) cwd = fallbackCwd;
  const cf = contextFromPayload(payload);
  return {
    modelName,
    effort,
    cwd,
    ctx: {
      percent: finalizePercent(cf.percentRaw, cf.used, cf.size),
      used: cf.used,
      size: cf.size,
    },
  };
}

export function withTranscriptTokens(view, usedTokens) {
  if (view.ctx.percent !== null || usedTokens === null || !view.ctx.size || view.ctx.size <= 0) return view;
  return { ...view, ctx: { ...view.ctx, used: usedTokens, percent: finalizePercent(null, usedTokens, view.ctx.size) } };
}

// ── 格式化 ──────────────────────────────────────────────────────────
// 倒计时：<=0→0m；<60s→Ns；<60m→Nm；<24h→NhMm；否则 NdNh；null/非有限数→--
export function formatCountdown(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '--';
  if (ms <= 0) return '0m';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h' + (m % 60) + 'm';
  const d = Math.floor(h / 24);
  return d + 'd' + (h % 24) + 'h';
}

// token 数：>=1M→X.XM（去尾 .0）；>=1k→Xk；否则原数
export function formatTokens(n) {
  if (n === null || n === undefined || typeof n !== 'number' || !Number.isFinite(n)) return '--';
  if (n >= 1e6) return ((n / 1e6).toFixed(1).replace(/\.0$/, '')) + 'M';
  if (n >= 1e3) return ((n / 1e3).toFixed(0)) + 'k';
  return String(Math.round(n));
}

// ── GLM quota 响应解析（信封校验 + limits 判别 + 窗口归类）──────────
// 返回 GlmLimits | null（null = 信封不合法，调用方按 failed 处理）
export function parseQuotaBody(body, fetchedAt) {
  if (!body || typeof body !== 'object') return null;
  if (body.code !== 200 || body.success !== true) return null; // 认证失败是 HTTP 200 + code!=1000x，这里拦
  const limits = body?.data?.limits;
  if (!Array.isArray(limits)) return null;

  let fiveHour = null;
  let week = null;
  let mcp = null;
  const unclaimed = [];

  for (const row of limits) {
    if (!row || typeof row !== 'object') continue;
    if (row.type === 'TOKENS_LIMIT') {
      const percentage = asNumber(row.percentage);
      if (percentage === undefined) continue; // 无百分比的窗口行无法展示，丢弃
      // 修正旧 mod bug：nextResetTime 缺失不再整行丢弃，保留窗口、倒计时显示 ↻--
      const rec = {
        percent: clamp(percentage, 0, 100),
        resetsAt: asNumber(row.nextResetTime) ?? null,
        unit: asNumber(row.unit),
        span: asNumber(row.number),
      };
      if (rec.unit === 3 && rec.span === 5) fiveHour = rec;
      else if (rec.unit === 6 && rec.span === 1) week = rec;
      else unclaimed.push(rec);
    } else if (row.type === 'TIME_LIMIT') {
      const currentValue = asNumber(row.currentValue);
      const remaining = asNumber(row.remaining);
      const usage = asNumber(row.usage);
      if (currentValue === undefined && remaining === undefined) continue;
      // 降级合成：缺谁算谁，绝不发明 total（used+0 会被读成 100% 用完）
      const safeUsed = currentValue !== undefined ? currentValue : Math.max(0, (usage ?? 0) - (remaining ?? 0));
      const safeTotal = usage !== undefined ? usage : (remaining !== undefined ? safeUsed + remaining : null);
      const safeRemaining = remaining !== undefined ? remaining : (safeTotal === null ? null : Math.max(0, safeTotal - safeUsed));
      const percent = asNumber(row.percentage) ??
        (safeTotal !== null && safeTotal > 0 ? Math.round((safeUsed / safeTotal) * 100) : null);
      mcp = {
        used: safeUsed,
        total: safeTotal,
        remaining: safeRemaining,
        percent,
        resetsAt: asNumber(row.nextResetTime) ?? null,
      };
    }
  }

  // unit 编码失效兜底：更早重置（null 排最后）的补 fiveHour，剩余最后一个补 week
  if ((!fiveHour || !week) && unclaimed.length > 0) {
    const sorted = unclaimed.slice().sort((a, b) =>
      ((a.resetsAt ?? Number.MAX_SAFE_INTEGER) - (b.resetsAt ?? Number.MAX_SAFE_INTEGER)));
    if (!fiveHour) fiveHour = sorted.shift() ?? null;
    if (!week && sorted.length > 0) week = sorted[sorted.length - 1];
  }

  return {
    fiveHour,
    week,
    mcp,
    level: typeof body.data.level === 'string' ? body.data.level : null,
    fetchedAt,
  };
}
