// 用 Cloudflare Workers AI（免费额度）给候选快讯打 1-10 分，再按来源加权、对例行新闻减分。
// AI 出错或额度用完时，返回 null，调用方自动退回规则判断。

const SYSTEM_PROMPT = `You rate financial news headlines for a trader who only wants eye-catching, market-moving BREAKING news.
High scores (8-10): huge money figures (tens of billions of dollars or more), sharp sudden market moves (index or megacap stock moving many percent, crashes, trading halts), unexpected major events (CEO ousted or reinstated, bankruptcies, defaults, government or central bank surprises, sanctions, wars, major mergers).
Middle scores (5-7): notable but expected or second-order news.
Low scores (1-4): routine items such as regular earnings results, analyst ratings or price targets, daily market wrap-ups, opinion pieces, explainers, how-to/investing advice, ads, minor company news.
Reply with ONLY a JSON array, one object per headline: [{"i": <index>, "s": <score 1-10>}]. No other text.`;

// 例行新闻的特征词：命中则减分
const ROUTINE = [
  /\b(price target|upgrade[sd]?|downgrade[sd]?|initiates? coverage|reiterate[sd]?)\b/i,
  /\b(earnings (beat|miss|preview|call)|EPS|Q[1-4] (results|earnings)|quarterly results)\b/i,
  /\b(stocks? (making|to watch)|here's what|what investors should|how to|explainer|opinion|podcast|live updates)\b/i,
  /\b(market (wrap|close|recap)|stock market today)\b/i,
];

export function routinePenalty(title) {
  return ROUTINE.some((re) => re.test(title)) ? -2 : 0;
}

export function parseScores(raw, n) {
  let data = raw;
  if (typeof raw === 'string') {
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return null;
    try {
      data = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(data)) return null;
  const out = new Array(n).fill(null);
  for (const o of data) {
    const i = Number(o?.i);
    const s = Number(o?.s);
    if (Number.isInteger(i) && i >= 0 && i < n && Number.isFinite(s)) out[i] = Math.max(1, Math.min(10, s));
  }
  return out;
}

/**
 * @param env 含 AI 绑定
 * @param items [{title, source}]
 * @returns 每条的 AI 原始分（1-10 或 null）；整批失败返回 null
 */
export async function aiScores(env, items) {
  if (!env.AI || !items.length) return null;
  const list = items.map((it, i) => `${i}. [${it.source}] ${it.title}`).join('\n');
  try {
    const res = await env.AI.run(env.AI_MODEL || '@cf/meta/llama-3.1-8b-instruct-fast', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: list },
      ],
      max_tokens: 30 + items.length * 14,
      temperature: 0,
    });
    return parseScores(res?.response ?? res, items.length);
  } catch (e) {
    console.warn('AI scoring failed', e?.message || e);
    return null;
  }
}
