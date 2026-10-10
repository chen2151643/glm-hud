// quota.mjs — GLM 配额 fetch + 文件缓存（TTL 90s，热路径不碰网络）
// token 只从进程 env 读；不写缓存/日志/输出/错误消息。
import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuotaBody } from './parse.mjs';

export const QUOTA_TTL_MS = 90_000;
export const FETCH_TIMEOUT_MS = 3_000;

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CACHE_FILE = here + '/cache/quota.json';

// 端点：z.ai 域走 api.z.ai，其余走 open.bigmodel.cn（共用账号体系）
export function quotaEndpoint(baseUrl) {
  return typeof baseUrl === 'string' && baseUrl.includes('api.z.ai')
    ? 'https://api.z.ai/api/monitor/usage/quota/limit'
    : 'https://open.bigmodel.cn/api/monitor/usage/quota/limit';
}

// token 顺序：ANTHROPIC_AUTH_TOKEN 仅当 base_url 指向 GLM 自有域名（别家凭证绝不禁发 monitor）→ ZAI_API_KEY → GLM_API_KEY
export function pickToken(env) {
  const base = env.ANTHROPIC_BASE_URL || '';
  const isGlmDomain = base.includes('bigmodel.cn') || base.includes('api.z.ai');
  if (isGlmDomain && typeof env.ANTHROPIC_AUTH_TOKEN === 'string' && env.ANTHROPIC_AUTH_TOKEN) return env.ANTHROPIC_AUTH_TOKEN;
  if (typeof env.ZAI_API_KEY === 'string' && env.ZAI_API_KEY) return env.ZAI_API_KEY;
  if (typeof env.GLM_API_KEY === 'string' && env.GLM_API_KEY) return env.GLM_API_KEY;
  return null;
}

// 结构校验：结构漂移/外部损坏的缓存视为无缓存（绝不把缺字段的记录喂给渲染层出 NaN）
const validWindow = (w) =>
  w === null || (typeof w === 'object' && typeof w.percent === 'number' && Number.isFinite(w.percent));
const validMcp = (m) =>
  m === null || (typeof m === 'object' && typeof m.used === 'number' && Number.isFinite(m.used));

export function readCache(file) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    if (j && typeof j === 'object' && typeof j.fetchedAt === 'number' && Number.isFinite(j.fetchedAt) &&
        validWindow(j.fiveHour) && validWindow(j.week) && validMcp(j.mcp)) return j;
  } catch { /* 读失败当无缓存 */ }
  return null;
}

// 只存配额数字与时间戳；目录 0700、文件 0600；写失败静默不影响本次输出
export function writeCache(file, limits) {
  // tmp 名带 pid：多窗并发刷新时各写各的临时文件，rename 前互不干扰
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(tmp, JSON.stringify(limits), { mode: 0o600 });
    try { chmodSync(tmp, 0o600); } catch { /* umask 兜底失败可忍 */ }
    renameSync(tmp, file);
  } catch { /* 写失败静默（tmp 残留无害，下次覆盖） */ }
}

// fetch 层：四态 {outcome:'fresh',limits} | {outcome:'failed'} | {outcome:'no-token'}
export async function fetchGlmLimits(env, { fetchImpl = null } = {}) {
  const token = pickToken(env);
  if (!token) return { outcome: 'no-token' };
  const f = fetchImpl || fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await f(quotaEndpoint(env.ANTHROPIC_BASE_URL || ''), {
      headers: { Authorization: token }, // 无 Bearer 前缀（实测）
      signal: ctrl.signal,
    });
    if (!res.ok) return { outcome: 'failed' };
    let body;
    try { body = await res.json(); } catch { return { outcome: 'failed' }; }
    const limits = parseQuotaBody(body, Date.now());
    if (!limits) return { outcome: 'failed' };
    return { outcome: 'fresh', limits };
  } catch {
    return { outcome: 'failed' };
  } finally {
    clearTimeout(timer);
  }
}

// 编排：no-token→omit；TTL 内→kept（不碰网络）；fetch 成功→落盘 fresh；失败→沿用旧缓存；从无缓存→failed
// 返回渲染态：{state:'omit'} | {state:'show', limits} | {state:'failed'}
export async function resolveQuota(env, opts = {}) {
  const {
    now = Date.now(),
    ttl = QUOTA_TTL_MS,
    cacheFile = DEFAULT_CACHE_FILE,
    fetchImpl = null,
  } = opts;
  if (!pickToken(env)) return { state: 'omit' };
  const cached = readCache(cacheFile);
  if (cached && now - cached.fetchedAt < ttl) return { state: 'show', limits: cached };
  const r = await fetchGlmLimits(env, { fetchImpl });
  if (r.outcome === 'fresh') {
    writeCache(cacheFile, r.limits);
    return { state: 'show', limits: r.limits };
  }
  if (cached) return { state: 'show', limits: cached };
  return { state: 'failed' };
}
