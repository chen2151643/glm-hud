// quota.mjs 测试：token 选择 / 端点 / TTL 缓存 / 四态（fetch 全部注入，不打网络）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { quotaEndpoint, pickToken, readCache, writeCache, resolveQuota, fetchGlmLimits } from './quota.mjs';

const ENV_GLM = {
  ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
  ANTHROPIC_AUTH_TOKEN: 'sk-fake-test',
};
const BODY_OK = (limits) => new Response(JSON.stringify({ code: 200, msg: 'ok', success: true, data: { limits, level: 'pro' } }), { status: 200 });

test('quotaEndpoint: z.ai 域名分流', () => {
  assert.equal(quotaEndpoint('https://api.z.ai/api/anthropic'), 'https://api.z.ai/api/monitor/usage/quota/limit');
  assert.equal(quotaEndpoint('https://open.bigmodel.cn'), 'https://open.bigmodel.cn/api/monitor/usage/quota/limit');
  assert.equal(quotaEndpoint(''), 'https://open.bigmodel.cn/api/monitor/usage/quota/limit');
});

test('pickToken: 非 GLM base_url 绝不外发 ANTHROPIC_AUTH_TOKEN', () => {
  assert.equal(pickToken(ENV_GLM), 'sk-fake-test');
  // 别家中转：ANTHROPIC_AUTH_TOKEN 是别家凭证 → 必须跳过
  assert.equal(pickToken({ ANTHROPIC_BASE_URL: 'https://gateway.corp', ANTHROPIC_AUTH_TOKEN: 'corp-secret', ZAI_API_KEY: 'z1' }), 'z1');
  // 无 GLM 域但给了 ZAI/GLM key → 可用
  assert.equal(pickToken({ ZAI_API_KEY: 'z1' }), 'z1');
  assert.equal(pickToken({ GLM_API_KEY: 'g1' }), 'g1');
  assert.equal(pickToken({}), null);
  assert.equal(pickToken({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_AUTH_TOKEN: 'official' }), null);
});

test('缓存读写：0600 文件、0700 目录', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glm-hud-t-'));
  try {
    const file = join(dir, 'sub', 'quota.json');
    const limits = { fiveHour: { percent: 4, resetsAt: 1791525717638 }, week: null, mcp: null, level: 'pro', fetchedAt: 1000 };
    writeCache(file, limits);
    assert.deepEqual(readCache(file), limits);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(dir + '/sub').mode & 0o777, 0o700);
    assert.equal(readCache(join(dir, 'missing.json')), null); // 读失败当无缓存
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveQuota: no-token → omit（不碰网络）', async () => {
  let called = 0;
  const r = await resolveQuota({}, { fetchImpl: async () => { called++; return BODY_OK([]); } });
  assert.equal(r.state, 'omit');
  assert.equal(called, 0);
});

test('resolveQuota: TTL 内命中缓存 → 不 fetch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'glm-hud-t-'));
  try {
    const file = join(dir, 'quota.json');
    writeCache(file, { fiveHour: { percent: 10, resetsAt: null }, week: null, mcp: null, level: null, fetchedAt: 100_000 });
    let called = 0;
    const r = await resolveQuota(ENV_GLM, {
      now: 100_000 + 89_000, cacheFile: file,
      fetchImpl: async () => { called++; return BODY_OK([]); },
    });
    assert.equal(r.state, 'show');
    assert.equal(r.limits.fiveHour.percent, 10);
    assert.equal(called, 0); // 热路径不碰网络
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resolveQuota: 缓存过期 → fetch 成功落盘 fresh', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'glm-hud-t-'));
  try {
    const file = join(dir, 'quota.json');
    let called = 0;
    const r = await resolveQuota(ENV_GLM, {
      now: 1_000_000, cacheFile: file,
      fetchImpl: async (url, init) => {
        called++;
        assert.ok(String(url).includes('/api/monitor/usage/quota/limit'));
        assert.equal(init.headers.Authorization, 'sk-fake-test'); // 无 Bearer
        return BODY_OK([{ type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 44, nextResetTime: 1791525717638 }]);
      },
    });
    assert.equal(called, 1);
    assert.equal(r.state, 'show');
    assert.equal(r.limits.fiveHour.percent, 44);
    assert.deepEqual(readCache(file).fiveHour, { percent: 44, resetsAt: 1791525717638, unit: 3, span: 5 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resolveQuota: fetch 失败 → 沿用旧缓存；从无缓存 → failed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'glm-hud-t-'));
  try {
    const file = join(dir, 'quota.json');
    writeCache(file, { fiveHour: { percent: 7, resetsAt: null }, week: null, mcp: null, level: null, fetchedAt: 1 });
    const r1 = await resolveQuota(ENV_GLM, {
      now: 999_999, cacheFile: file,
      fetchImpl: async () => new Response('{"code":1001}', { status: 200 }), // HTTP 200 + 错误码
    });
    assert.equal(r1.state, 'show');
    assert.equal(r1.limits.fiveHour.percent, 7); // 沿用旧缓存

    const r2 = await resolveQuota(ENV_GLM, {
      now: 999_999, cacheFile: join(dir, 'none.json'),
      fetchImpl: async () => { throw new Error('network down'); },
    });
    assert.equal(r2.state, 'failed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fetchGlmLimits: HTTP 非 ok / 坏 JSON → failed（不抛）', async () => {
  assert.equal((await fetchGlmLimits(ENV_GLM, { fetchImpl: async () => new Response('', { status: 503 }) })).outcome, 'failed');
  assert.equal((await fetchGlmLimits(ENV_GLM, { fetchImpl: async () => new Response('<html>', { status: 200 }) })).outcome, 'failed');
  assert.equal((await fetchGlmLimits({}, { fetchImpl: async () => { throw new Error('x'); } })).outcome, 'no-token');
});

// ── 补充用例（2026-10-09 补测轮）─────────────────────────────────────

test('fetchGlmLimits: HTTP 200 + code:1001（信封不合法）→ failed', async () => {
  const r = await fetchGlmLimits(ENV_GLM, {
    fetchImpl: async () => new Response(JSON.stringify({ code: 1001, msg: '未登录', success: false }), { status: 200 }),
  });
  assert.equal(r.outcome, 'failed');
});

test('resolveQuota: 3s 超时中断 fetch → failed → 沿用旧缓存（真实 AbortController 计时）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'glm-hud-t-'));
  try {
    const file = join(dir, 'quota.json');
    writeCache(file, { fiveHour: { percent: 7, resetsAt: null }, week: null, mcp: null, level: null, fetchedAt: 1 });
    // fetchImpl 挂起直到 signal abort 才拒绝——复刻超时场景
    const hangTillAbort = (_url, init) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(new Error('aborted')));
    });
    const t0 = Date.now();
    const r = await resolveQuota(ENV_GLM, { now: 999_999, cacheFile: file, fetchImpl: hangTillAbort });
    const elapsed = Date.now() - t0;
    assert.equal(r.state, 'show');
    assert.equal(r.limits.fiveHour.percent, 7);   // 超时失败沿用旧缓存
    assert.ok(elapsed >= 2500 && elapsed < 6000, `elapsed=${elapsed}ms 应≈3s 超时`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resolveQuota: TTL 边界——恰好到期(≥ttl)就 fetch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'glm-hud-t-'));
  try {
    const file = join(dir, 'quota.json');
    writeCache(file, { fiveHour: { percent: 10, resetsAt: null }, week: null, mcp: null, level: null, fetchedAt: 100_000 });
    let called = 0;
    const r = await resolveQuota(ENV_GLM, {
      now: 100_000 + 90_000, cacheFile: file, // now - fetchedAt == ttl → 过期
      fetchImpl: async () => { called++; return BODY_OK([{ type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 44 }]); },
    });
    assert.equal(called, 1);
    assert.equal(r.state, 'show');
    assert.equal(r.limits.fiveHour.percent, 44);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readCache: 坏 JSON / 非 object → null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glm-hud-t-'));
  try {
    const file = join(dir, 'quota.json');
    writeFileSync(file, '{oops not json', 'utf8');
    assert.equal(readCache(file), null);
    writeFileSync(file, '[1,2,3]', 'utf8'); // 数组也非合法缓存
    assert.equal(readCache(file), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('pickToken: 空字符串 token / 空 key 跳过', () => {
  assert.equal(pickToken({ ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic', ANTHROPIC_AUTH_TOKEN: '' }), null);
  assert.equal(pickToken({ ZAI_API_KEY: '', GLM_API_KEY: '' }), null);
});

test('writeCache: 不可写路径静默不抛', () => {
  assert.doesNotThrow(() => writeCache('/dev/null/under/quota.json', { fiveHour: null, fetchedAt: 1 }));
});

test('缓存内容只含数字与时间戳（无 token 形态）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glm-hud-t-'));
  try {
    const file = join(dir, 'quota.json');
    writeCache(file, { fiveHour: { percent: 4, resetsAt: 1791525717638, unit: 3, span: 5 }, week: null, mcp: null, level: 'pro', fetchedAt: 123 });
    const raw = readFileSync(file, 'utf8');
    assert.ok(!/sk-|bearer|authorization|token/i.test(raw), `缓存泄露敏感词: ${raw}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── 补充用例（2026-10-09 评审修复轮）─────────────────────────────────

test('readCache: 结构漂移/损坏 → null（缺 percent、非有限数字、mcp used 缺失）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glm-hud-t-'));
  try {
    const file = join(dir, 'quota.json');
    // fiveHour 缺 percent（评审实测的 NaN% 复现结构）
    writeFileSync(file, JSON.stringify({ fiveHour: { resetsAt: 1791525717638 }, week: null, mcp: null, fetchedAt: Date.now() }), 'utf8');
    assert.equal(readCache(file), null);
    // percent 非数字
    writeFileSync(file, JSON.stringify({ fiveHour: { percent: '44' }, week: null, mcp: null, fetchedAt: Date.now() }), 'utf8');
    assert.equal(readCache(file), null);
    // mcp 缺 used
    writeFileSync(file, JSON.stringify({ fiveHour: null, week: null, mcp: { total: 1000 }, fetchedAt: Date.now() }), 'utf8');
    assert.equal(readCache(file), null);
    // week 结构漂移
    writeFileSync(file, JSON.stringify({ fiveHour: null, week: { resetsAt: 1 }, mcp: null, fetchedAt: Date.now() }), 'utf8');
    assert.equal(readCache(file), null);
    // 合法缓存（含 mcp 降级态 used 有值 total null）不受影响
    writeFileSync(file, JSON.stringify({ fiveHour: { percent: 4, resetsAt: 1 }, week: null, mcp: { used: 3, total: null }, fetchedAt: Date.now() }), 'utf8');
    assert.notEqual(readCache(file), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resolveQuota: 损坏缓存即使 TTL 内也视为无缓存 → 重新 fetch（不渲染 NaN）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'glm-hud-t-'));
  try {
    const file = join(dir, 'quota.json');
    writeFileSync(file, JSON.stringify({ fiveHour: { resetsAt: 123 }, week: null, mcp: null, fetchedAt: 100_000 }), 'utf8');
    let called = 0;
    const r = await resolveQuota(ENV_GLM, {
      now: 101_000, cacheFile: file, // TTL 内，但缓存非法 → 必须走网络
      fetchImpl: async () => { called++; return BODY_OK([{ type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 44 }]); },
    });
    assert.equal(called, 1, '非法缓存不应被 TTL 命中');
    assert.equal(r.state, 'show');
    assert.equal(r.limits.fiveHour.percent, 44);
    assert.deepEqual(readCache(file).fiveHour, { percent: 44, resetsAt: null, unit: 3, span: 5 }); // 自愈落盘
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('writeCache: tmp 名带 pid，成功后无 *.tmp 残留', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glm-hud-t-'));
  try {
    const file = join(dir, 'quota.json');
    writeCache(file, { fiveHour: null, week: null, mcp: null, level: null, fetchedAt: 1 });
    writeCache(file, { fiveHour: null, week: null, mcp: null, level: null, fetchedAt: 2 });
    const residue = readdirSync(dir).filter((f) => f.includes('.tmp'));
    assert.deepEqual(residue, [], `不应有 tmp 残留: ${residue}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
