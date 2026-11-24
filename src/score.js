// 用 Cloudflare Workers AI（免费额度）给候选快讯打 1-10 分，再按来源加权、对例行新闻减分。
// AI 出错或额度用完时，返回 null，调用方自动退回规则判断。

const SYSTEM_PROMPT = `You rate financial news headlines for a trader who only wants eye-catching, market-moving BREAKING news.
High scores (8-10): huge money figures (tens of billions of dollars or more), sharp sudden market moves (index or megacap stock moving many percent, crashes, trading halts), unexpected major events (CEO ousted or reinstated, bankruptcies, defaults, government or central bank surprises, sanctions, wars, major mergers).
Middle scores (5-7): notable but expected or second-order news.
Low scores (1-4): routine items such as regular earnings results, analyst ratings or price targets, daily market wrap-ups, opinion pieces, explainers, how-to/investing advice, ads, minor company news.
Be strict: most headlines should score 1-5; only a few per day deserve 8+.
Examples: "Nvidia short sellers reap $24 billion as stock extends slide" = 9; "Company X to buy Y in $44 billion deal" = 9; "Fed unexpectedly cuts rates by 50bp" = 10; "Jensen Huang reinstated as Nvidia CEO, stock skyrockets 31%" = 10; "Asian chip stocks jump after Nvidia news" = 6; "Fed official says rates likely higher over time" = 5; "Analyst raises price target" = 2; "Newsletter / TV / sports / lifestyle story" = 1.
The user message lists numbered headlines. Reply with ONLY a JSON array with one object per headline, using the headline's number as "i": [{"i": 0, "s": 7}, {"i": 1, "s": 2}]. No other text.`;

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
  if (data.every((x) => typeof x === 'number' || (typeof x === 'string' && /^\d+(\.\d+)?$/.test(x)))) {
    // 按顺序的分数数组
    data.slice(0, n).forEach((x, i) => (out[i] = Math.max(1, Math.min(10, Number(x)))));
    return out;
  }
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
    const res = await env.AI.run(env.AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: list },
      ],
      max_tokens: 20 + items.length * 14,
      temperature: 0,
    });
    const raw = res?.response ?? res;
    const out = parseScores(raw, items.length);
    if (!out) console.warn('AI reply not parseable', String(typeof raw === 'string' ? raw : JSON.stringify(raw)).slice(0, 300));
    return out;
  } catch (e) {
    console.warn('AI scoring failed', e?.message || e);
    return null;
  }
}
