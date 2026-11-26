// Claude（Anthropic API）：打分、贴标签和翻译的首选模型。
// 密钥放在 Cloudflare 的机密变量 ANTHROPIC_API_KEY 里（wrangler secret put），不写进代码仓库。
// 任何一步出错都返回 null，调用方自动退回 Workers AI，再不行退回规则。

import Anthropic from '@anthropic-ai/sdk';

export const CLAUDE_MODEL = 'claude-haiku-5-5';
// Claude Haiku 5.5 的官方价格（提示词不超过 10 万 token 时）：每百万输入 0.10 美元，每百万输出 0.50 美元
const USD_IN = 0.1;
const USD_OUT = 0.5;
export const claudeUsd = (input, output) => Math.round(((input * USD_IN + output * USD_OUT) / 1e6) * 1e6) / 1e6;
// 选题会和专题档案用更强的模型（调用时用 model 参数指定）。每百万 token 的官方价格：[输入, 输出]
const PRICES = { 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20] };

// 密钥失效、欠费这类短时间内不会自己好的错误：先停用一段时间，免得每分钟白跑一趟。
// （同一个 Worker 实例内有效；实例重启后会再试一次，代价只是一次失败的请求。）
let downUntil = 0;
let lastError = '';

/** 配了密钥，且没有用 AI_PROVIDER="workers" 关掉 */
export const claudeOn = (env) => !!(env.ANTHROPIC_API_KEY || env.CLAUDE_CLIENT) && env.AI_PROVIDER !== 'workers';
/** 现在可以调用：已启用，并且不在出错后的停用时间里 */
export const claudeUp = (env, now = Date.now()) => claudeOn(env) && now >= downUntil;
export const claudeState = () => ({ down_until: downUntil > Date.now() ? new Date(downUntil).toISOString() : null, last_error: lastError || null });
/** 测试用：清掉停用状态 */
export function claudeReset() {
  downUntil = 0;
  lastError = '';
}

/**
 * 发一次请求，返回 { text, usage: { input, output } }；失败、被拒答或被截断时返回 null。
 * @param kind 'score' | 'translate' | 'brief'，只用来分开记用量
 */
export async function claudeText(env, { system, user, maxTokens, kind = 'score', effort = 'low', think = false, timeout = 20_000, model = null }) {
  if (!claudeUp(env)) return null;
  try {
    // CLAUDE_CLIENT 只在测试里注入假的客户端
    const client = env.CLAUDE_CLIENT || new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout });
    const res = await client.messages.create({
      model: model || env.CLAUDE_MODEL || CLAUDE_MODEL,
      max_tokens: maxTokens,
      // 打分和翻译都是短平快的活：不要思考过程，省钱也省时间
      // 写事件简报这种需要组织材料的活才打开思考（think=true）
      // 指定了更强的模型时一律让它自己决定想多久（这些模型不接受“关闭思考”）
      thinking: think || model ? { type: 'adaptive' } : { type: 'disabled' },
      output_config: { effort },
      // 固定的提示词做缓存：每分钟都在调，命中缓存的部分只收一成的钱（提示词太短不够缓存时自动忽略，没有副作用）
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    });
    // 记账用的输入 token 按价格折算：读缓存算一成，写缓存算 1.25 倍，这样 花费 = 输入 x 单价 仍然成立
    const u = res?.usage || {};
    const cacheRead = Number(u.cache_read_input_tokens) || 0;
    const cacheWrite = Number(u.cache_creation_input_tokens) || 0;
    const usage = { input: Math.round((Number(u.input_tokens) || 0) + cacheRead * 0.1 + cacheWrite * 1.25), output: Number(u.output_tokens) || 0, cacheRead };
    // 更贵的模型：记账时把 token 数按价格折成“相当于多少 Haiku token”，这样用量表里 花费 = token x Haiku 单价 对所有模型都成立
    const pr = model && PRICES[model];
    if (pr) {
      usage.input = Math.round((usage.input * pr[0]) / USD_IN);
      usage.output = Math.round((usage.output * pr[1]) / USD_OUT);
    }
    await recordUsage(env, kind, usage);
    if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') {
      lastError = `stopped: ${res.stop_reason} (${kind}, ${usage.output} output tokens)`;
      console.warn('claude stopped early', res.stop_reason);
      return null;
    }
    const text = (res.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return text ? { text, usage } : null;
  } catch (e) {
    const status = Number(e?.status) || 0;
    lastError = `${status || ''} ${e?.message || e}`.trim().slice(0, 200);
    // 401/403 密钥不对或没权限，402 及余额类 400 欠费：停 15 分钟；429/529 限流或过载：停 2 分钟
    if (status === 401 || status === 403 || status === 402 || (status === 400 && /credit|billing/i.test(lastError))) downUntil = Date.now() + 15 * 60_000;
    else if (status === 429 || status === 529) downUntil = Date.now() + 2 * 60_000;
    console.warn('claude failed', lastError);
    return null;
  }
}

const USAGE_TABLE =
  'CREATE TABLE IF NOT EXISTS claude_usage (day TEXT NOT NULL, kind TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind))';

async function recordUsage(env, kind, u) {
  if (!env.DB) return;
  const put = () =>
    env.DB.prepare(
      `INSERT INTO claude_usage (day, kind, calls, input_tokens, output_tokens) VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(day, kind) DO UPDATE SET calls = calls + 1, input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens`
    )
      .bind(new Date().toISOString().slice(0, 10), kind, u.input, u.output)
      .run();
  try {
    await put();
  } catch {
    // 表还没建（旧库）：建好再记一次；仍失败就不记，不影响打分
    try {
      await env.DB.prepare(USAGE_TABLE).run();
      await put();
    } catch (e) {
      console.warn('claude usage not recorded', e?.message || e);
    }
  }
}

/** 最近 31 天的用量和花费，给 /api/status 用 */
export async function claudeUsage(env) {
  try {
    const rows = (await env.DB.prepare('SELECT day, kind, calls, input_tokens, output_tokens FROM claude_usage ORDER BY day DESC, kind LIMIT 400').all()).results;
    const days = rows.map((r) => ({ ...r, usd: claudeUsd(r.input_tokens, r.output_tokens) }));
    const month = new Date().toISOString().slice(0, 7);
    const sum = days.filter((r) => r.day.startsWith(month)).reduce((a, r) => a + r.usd, 0);
    return { days, month_usd: Math.round(sum * 1e4) / 1e4 };
  } catch {
    return { days: [], month_usd: 0 };
  }
}
