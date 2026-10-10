// parse.mjs 纯函数测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapModelName, shortEnvModelName, envDefaultNote,
  sumUsageTokens, contextFromPayload, finalizePercent,
  usageFromTranscriptChunk, buildView, withTranscriptTokens,
  formatCountdown, formatTokens, parseQuotaBody,
} from './parse.mjs';

// 2026-10-09 实测响应（仅数字）
const REAL_BODY = {
  code: 200, msg: '操作成功', success: true,
  data: {
    limits: [
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 4, nextResetTime: 1791525717638 },
      { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 20, nextResetTime: 1791731927982 },
      { type: 'TIME_LIMIT', unit: 5, number: 1, usage: 1000, currentValue: 304, remaining: 696, percentage: 30, nextResetTime: 1791991127983,
        usageDetails: [{ modelCode: 'search-prime', usage: 227 }, { modelCode: 'web-reader', usage: 77 }, { modelCode: 'zread', usage: 0 }] },
    ],
    level: 'pro',
  },
};

test('mapModelName: glm-5.3[1m] → GLM-5.3·1M', () => {
  assert.equal(mapModelName('glm-5.3[1m]'), 'GLM-5.3·1M');
  assert.equal(mapModelName('glm-5.3[1M]'), 'GLM-5.3·1M');
  assert.equal(mapModelName('glm-5.3'), 'GLM-5.3');
  assert.equal(mapModelName('claude-opus-4-6'), 'claude-opus-4-6');
  assert.equal(mapModelName(''), '');
  assert.equal(mapModelName(null), '');
});

test('shortEnvModelName: 公共前缀剥离 + 尺寸后缀剥除', () => {
  assert.equal(shortEnvModelName('glm-5.3[1m]', 'glm-5.3-flash'), 'flash');
  assert.equal(shortEnvModelName('glm-5.3', 'glm-5.3-flash[1m]'), 'flash'); // [1m] 尺寸后缀剥除
  assert.equal(shortEnvModelName('glm-5.3', 'glm-5.3[1M]'), 'glm-5.3');     // 尾巴只剩尺寸 → 回退全名（剥后缀）
  assert.equal(shortEnvModelName('a', 'a'), 'a');
});

test('envDefaultNote: 不一致才提示，文案不得出现"覆盖"', () => {
  const p = { model: { id: 'glm-5.3[1m]' } };
  const note = envDefaultNote(p, { ANTHROPIC_MODEL: 'glm-5.3-flash' });
  assert.equal(note, 'env默认:flash');
  assert.ok(!note.includes('覆盖'));
  assert.equal(envDefaultNote(p, { ANTHROPIC_MODEL: 'glm-5.3[1m]' }), null); // 一致
  assert.equal(envDefaultNote(p, {}), null);      // env 缺失
  assert.equal(envDefaultNote(null, { ANTHROPIC_MODEL: 'x' }), null);
});

test('sumUsageTokens: input+cache_creation+cache_read，无 input 为 null', () => {
  assert.equal(sumUsageTokens({ input_tokens: 42, cache_creation_input_tokens: 5, cache_read_input_tokens: 38, output_tokens: 9 }), 85);
  assert.equal(sumUsageTokens({ output_tokens: 9 }), null);
  assert.equal(sumUsageTokens(null), null);
});

test('contextFromPayload: payload 优先链', () => {
  const full = { context_window: { context_window_size: 1000000, used_percentage: 8, total_input_tokens: 85000 } };
  assert.deepEqual(contextFromPayload(full), { size: 1000000, percentRaw: 8, used: 85000 });
  // 无 total_input_tokens 时退 current_usage
  const cu = { context_window: { context_window_size: 1000000, current_usage: { input_tokens: 42, cache_read_input_tokens: 8 } } };
  assert.deepEqual(contextFromPayload(cu), { size: 1000000, percentRaw: null, used: 50 });
  assert.deepEqual(contextFromPayload(null), { size: null, percentRaw: null, used: null });
});

test('finalizePercent: half-up 取整、clamp', () => {
  assert.equal(finalizePercent(44.5, null, null), 45);
  assert.equal(finalizePercent(null, 85000, 1000000), 9);  // 8.5 → 9
  assert.equal(finalizePercent(null, null, 1000000), null);
  assert.equal(finalizePercent(120, null, null), 100);
});

test('usageFromTranscriptChunk: 取最后一条 usage', () => {
  const text = [
    '{"message":{"usage":{"input_tokens":10,"cache_read_input_tokens":5}}}',
    '半截 JSON {"message":{"usage":{"input_tokens":99}}}',
    '{"message":{"usage":{"input_tokens":20,"cache_creation_input_tokens":30,"cache_read_input_tokens":50}}}',
  ].join('\n');
  assert.equal(usageFromTranscriptChunk(text), 100);
  assert.equal(usageFromTranscriptChunk(''), null);
  assert.equal(usageFromTranscriptChunk('{"foo":1}'), null);
});

test('buildView: 完整 payload', () => {
  const v = buildView({
    model: { id: 'glm-5.3[1m]', display_name: 'glm-5.3[1m]' },
    effort: { level: 'high' },
    workspace: { current_dir: '/Users/x/proj' },
    context_window: { context_window_size: 1000000, total_input_tokens: 85000 },
  }, '/fallback');
  assert.equal(v.modelName, 'GLM-5.3·1M');
  assert.equal(v.effort, 'high');
  assert.equal(v.cwd, '/Users/x/proj');
  assert.equal(v.ctx.percent, 9);
  assert.equal(v.ctx.used, 85000);
  assert.equal(v.ctx.size, 1000000);
});

test('buildView: null payload 也不炸', () => {
  const v = buildView(null, '/fb');
  assert.equal(v.modelName, 'CC');
  assert.equal(v.effort, null);
  assert.equal(v.cwd, '/fb');
  assert.equal(v.ctx.percent, null);
});

test('buildView: 非法 effort 丢弃', () => {
  const v = buildView({ effort: { level: 'ultra' }, model: {} }, '/fb');
  assert.equal(v.effort, null);
});

test('withTranscriptTokens: 补出百分比', () => {
  const base = buildView({ model: {}, context_window: { context_window_size: 1000000 } }, '/fb');
  const v = withTranscriptTokens(base, 500000);
  assert.equal(v.ctx.percent, 50);
  assert.equal(v.ctx.used, 500000);
  // 已有 percent 时不覆盖
  const done = buildView({ model: {}, context_window: { context_window_size: 1000000, used_percentage: 7 } }, '/fb');
  assert.equal(withTranscriptTokens(done, 999999).ctx.percent, 7);
});

test('formatCountdown: 全档位 + clamp + null', () => {
  assert.equal(formatCountdown(-5000), '0m');
  assert.equal(formatCountdown(0), '0m');
  assert.equal(formatCountdown(30_000), '30s');
  assert.equal(formatCountdown(41 * 60_000), '41m');
  assert.equal(formatCountdown((2 * 3600 + 32 * 60) * 1000), '2h32m');
  assert.equal(formatCountdown((24 * 3600 + 14 * 3600) * 1000), '1d14h');
  assert.equal(formatCountdown((2 * 86400 + 14 * 3600) * 1000), '2d14h');
  assert.equal(formatCountdown(null), '--');
  assert.equal(formatCountdown(undefined), '--');
  assert.equal(formatCountdown(NaN), '--'); // 损坏 resetsAt → 剩-- 而非 剩NaNdNaNh
});

test('formatTokens', () => {
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(85000), '85k');
  assert.equal(formatTokens(999999), '1000k');
  assert.equal(formatTokens(1000000), '1M');
  assert.equal(formatTokens(1500000), '1.5M');
  assert.equal(formatTokens(1234567), '1.2M');
  assert.equal(formatTokens(null), '--');
});

test('parseQuotaBody: 实测响应 → 完整 GlmLimits', () => {
  const q = parseQuotaBody(REAL_BODY, 123);
  assert.deepEqual(q.fiveHour, { percent: 4, resetsAt: 1791525717638, unit: 3, span: 5 });
  assert.deepEqual(q.week, { percent: 20, resetsAt: 1791731927982, unit: 6, span: 1 });
  assert.deepEqual(q.mcp, { used: 304, total: 1000, remaining: 696, percent: 30, resetsAt: 1791991127983 });
  assert.equal(q.level, 'pro');
  assert.equal(q.fetchedAt, 123);
});

test('parseQuotaBody: 信封校验拒绝', () => {
  assert.equal(parseQuotaBody({ code: 1001, success: true, data: { limits: [] } }, 1), null);  // HTTP 200 + 错误码（认证失败）
  assert.equal(parseQuotaBody({ code: 200, success: false, data: { limits: [] } }, 1), null);
  assert.equal(parseQuotaBody({ code: 200, success: true, data: { limits: 'x' } }, 1), null);
  assert.equal(parseQuotaBody({ code: 200, success: true }, 1), null);
  assert.equal(parseQuotaBody(null, 1), null);
});

test('parseQuotaBody: TOKENS_LIMIT 无 percentage 丢弃 / 无 reset 保留（旧 mod bug 修正）', () => {
  const q = parseQuotaBody({ code: 200, success: true, data: { limits: [
    { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 55 },               // 无 nextResetTime → 保留 resetsAt:null
    { type: 'TOKENS_LIMIT', unit: 6, number: 1, nextResetTime: 1791731927982 }, // 无 percentage → 丢弃
  ] } }, 1);
  assert.deepEqual(q.fiveHour, { percent: 55, resetsAt: null, unit: 3, span: 5 });
  assert.equal(q.week, null);
});

test('parseQuotaBody: unit 失效兜底——更早重置的补 5h', () => {
  const q = parseQuotaBody({ code: 200, success: true, data: { limits: [
    { type: 'TOKENS_LIMIT', unit: 99, number: 99, percentage: 60, nextResetTime: 2000 },
    { type: 'TOKENS_LIMIT', unit: 99, number: 99, percentage: 30, nextResetTime: 1000 }, // 更早 → 5h
  ] } }, 1);
  assert.equal(q.fiveHour.percent, 30);
  assert.equal(q.week.percent, 60);
});

test('parseQuotaBody: TIME_LIMIT 降级合成', () => {
  // 只有 currentValue → total 保持 null（绝不发明 total）
  const a = parseQuotaBody({ code: 200, success: true, data: { limits: [
    { type: 'TIME_LIMIT', currentValue: 304 },
  ] } }, 1);
  assert.deepEqual(a.mcp, { used: 304, total: null, remaining: null, percent: null, resetsAt: null });
  // usage + remaining 无 currentValue → 推导 696/1000
  const b = parseQuotaBody({ code: 200, success: true, data: { limits: [
    { type: 'TIME_LIMIT', usage: 1000, remaining: 696 },
  ] } }, 1);
  assert.equal(b.mcp.used, 304);
  assert.equal(b.mcp.total, 1000);
  assert.equal(b.mcp.percent, 30);
  // 两字段全缺 → 丢行
  const c = parseQuotaBody({ code: 200, success: true, data: { limits: [
    { type: 'TIME_LIMIT', usage: 1000 },
  ] } }, 1);
  assert.equal(c.mcp, null);
});

test('parseQuotaBody: level 非 string → null', () => {
  const q = parseQuotaBody({ code: 200, success: true, data: { limits: [], level: 5 } }, 1);
  assert.equal(q.level, null);
});

// ── 补充用例（2026-10-09 补测轮）─────────────────────────────────────

test('mapModelName: 补充——已大写前缀不变 / 空后缀剥除 / 另一大版本', () => {
  assert.equal(mapModelName('GLM-5.3'), 'GLM-5.3');
  assert.equal(mapModelName('glm-4.7[1m]'), 'GLM-4.7·1M');
  assert.equal(mapModelName('glm-x[]'), 'GLM-x');
  assert.equal(mapModelName('  glm-5.3  '), 'GLM-5.3'); // trim
});

test('envDefaultNote: 大小写不敏感一致不触发', () => {
  const p = { model: { id: 'glm-5.3[1m]' } };
  assert.equal(envDefaultNote(p, { ANTHROPIC_MODEL: 'GLM-5.3[1M]' }), null);
  assert.equal(envDefaultNote({ model: { id: '' } }, { ANTHROPIC_MODEL: 'x' }), null); // 空 id
});

test('usageFromTranscriptChunk: 顶层 usage 兜底 / input=0 有效', () => {
  const text = [
    '{"usage":{"input_tokens":7,"cache_read_input_tokens":3}}',
    '{"message":{"usage":{"input_tokens":0}}}', // 0 是合法值
  ].join('\n');
  assert.equal(usageFromTranscriptChunk(text), 0); // 从后往前，最后一条 input=0
  assert.equal(usageFromTranscriptChunk('{"usage":{"cache_read_input_tokens":5}}'), null); // 无 input
});

test('buildView: display_name 优先于 id；缺尺寸后缀时从 id 合并', () => {
  // 实测样例：display_name="glm-5.3"（无后缀）+ id="glm-5.3[1M]" → 徽章合并出 1M 档位
  const v = buildView({ model: { id: 'glm-5.3[1M]', display_name: 'glm-5.3' } }, '/fb');
  assert.equal(v.modelName, 'GLM-5.3·1M');
  // display_name 自带后缀 → mapModelName 已转 ·1M，不重复合并
  const v2 = buildView({ model: { id: 'glm-5.3[1m]', display_name: 'glm-5.3[1m]' } }, '/fb');
  assert.equal(v2.modelName, 'GLM-5.3·1M');
  // 任意展示名同样合并（档位信息不丢）
  const v3 = buildView({ model: { id: 'glm-5.3[1m]', display_name: '展示名X' } }, '/fb');
  assert.equal(v3.modelName, '展示名X·1M');
  // id 无后缀 → 不合并
  const v4 = buildView({ model: { id: 'glm-5.3', display_name: 'glm-5.3' } }, '/fb');
  assert.equal(v4.modelName, 'GLM-5.3');
});

test('buildView: cwd 回退链 workspace → cwd → fallback', () => {
  assert.equal(buildView({ cwd: '/a/b' }, '/fb').cwd, '/a/b');
  assert.equal(buildView({ workspace: { current_dir: '' }, cwd: '/a/b' }, '/fb').cwd, '/a/b');
  assert.equal(buildView({}, '').cwd, '');
});

test('withTranscriptTokens: null tokens / 无 size → 不变', () => {
  const base = buildView({ model: {}, context_window: { context_window_size: 1000000 } }, '/fb');
  assert.equal(withTranscriptTokens(base, null).ctx.percent, null);
  const noSize = buildView({ model: {} }, '/fb'); // size null
  assert.equal(withTranscriptTokens(noSize, 500000).ctx.percent, null);
});

test('finalizePercent: used 超 size → clamp 100；size<=0 → null', () => {
  assert.equal(finalizePercent(null, 2_000_000, 1_000_000), 100);
  assert.equal(finalizePercent(null, 100, 0), null);
});

test('parseQuotaBody: percentage 越界 clamp', () => {
  const q = parseQuotaBody({ code: 200, success: true, data: { limits: [
    { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 150 },
  ] } }, 1);
  assert.equal(q.fiveHour.percent, 100);
});

test('parseQuotaBody: 未知 type 行忽略；limits 空 → 全 null 但非 null 返回', () => {
  const q = parseQuotaBody({ code: 200, success: true, data: { limits: [
    { type: 'SOMETHING_ELSE', percentage: 50 },
  ] } }, 1);
  assert.notEqual(q, null);
  assert.equal(q.fiveHour, null);
  assert.equal(q.week, null);
  assert.equal(q.mcp, null);
});
