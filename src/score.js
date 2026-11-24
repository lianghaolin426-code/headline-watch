// 用 Cloudflare Workers AI（免费额度）给候选快讯打 1-10 分，再按来源加权、对例行新闻减分。
// AI 出错或额度用完时，返回 null，调用方自动退回规则判断。

const SYSTEM_PROMPT = `You rate financial news headlines for a trader who only wants eye-catching, market-moving BREAKING news.
The trader trades ONLY US stocks and Saudi stocks (Tadawul). Global macro counts when it moves those markets (Fed, US policy, tariffs, oil/OPEC, Middle East conflict, big moves in US megacaps).
News that is mainly about mainland China A-shares, Hong Kong, Taiwan, Korea, Japan, Europe or other local markets scores low (1-4) unless it clearly moves US or Saudi stocks or oil.
Headlines may be in English, Chinese or Arabic; judge them the same way.
High scores (8-10): huge money figures (tens of billions of dollars or more), sharp sudden market moves (index or megacap stock moving many percent, crashes, trading halts), unexpected major events (CEO ousted or reinstated, bankruptcies, defaults, government or central bank surprises, sanctions, wars, major mergers).
Middle scores (5-7): notable but expected or second-order news.
Low scores (1-4): routine items such as regular earnings results, analyst ratings or price targets, daily market wrap-ups, opinion pieces, explainers, how-to/investing advice, ads, minor company news.
Be strict: most headlines should score 1-5; only a few per day deserve 8+.
Examples: "Nvidia short sellers reap $24 billion as stock extends slide" = 9; "Company X to buy Y in $44 billion deal" = 9; "Fed unexpectedly cuts rates by 50bp" = 10; "Jensen Huang reinstated as Nvidia CEO, stock skyrockets 31%" = 10; "Asian chip stocks jump after Nvidia news" = 5; "Taiwan stocks close up 9%" = 3; "上证指数收涨0.5%" = 1; "Saudi Aramco to sell $10 billion of shares" = 8; "Tadawul main index plunges 6%" = 9; "OPEC+ agrees surprise output cut" = 9; "Saudi company reports quarterly profit" = 3; "Fed official says rates likely higher over time" = 5; "Analyst raises price target" = 2; "Newsletter / TV / sports / lifestyle story" = 1.
The user message lists numbered headlines.`;
const PLAIN_FORMAT = `Reply with ONLY a JSON array with one object per headline, using the headline's number as "i": [{"i": 0, "s": 7}, {"i": 1, "s": 2}]. No other text.`;
// 带标签的格式：分数低于 5 的只回 [编号, 分数]，省输出；5 分以上再加方向、股票代码、话题、板块
const TAG_FORMAT = `Reply with ONLY a JSON array holding one array per headline. Score below 5: [number, score]. Score 5 or above: [number, score, direction, "TICKERS", "Topic", "sector"].
direction: 1 = bullish for the stocks concerned, -1 = bearish, 0 = neutral or unclear.
TICKERS: up to 3 US ticker symbols or 4-digit Tadawul codes of the listed companies the headline is mainly about, comma-separated, whatever language the headline is in; "" if none.
Topic: the main subject as a canonical English label of 1-2 words, identical for every headline on the same subject (Nvidia, Fed, Oil, Tariffs, Iran); "" if none.
sector: tech, finance, energy, health, consumer, industrial, macro, crypto or other.
Example: [[0,9,-1,"NVDA","Nvidia","tech"],[1,2],[2,6,1,"","Fed","macro"],[3,8,1,"2222","Aramco","energy"]]. No other text.`;

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

const SECTORS = ['tech', 'finance', 'energy', 'health', 'consumer', 'industrial', 'macro', 'crypto', 'other'];

function cleanTag(t) {
  if (!t || typeof t !== 'object') return null;
  const dir = Number(t.d);
  const tickers = String(Array.isArray(t.k) ? t.k.join(',') : t.k ?? '')
    .toUpperCase()
    .split(/[,;/]+/)
    .map((x) => x.trim().replace(/^\$/, '').replace(/\.SR$/, ''))
    .filter((x) => /^[A-Z]{1,5}(\.[A-Z])?$|^\d{4}$/.test(x))
    .slice(0, 3)
    .join(',');
  const topic = String(t.t ?? '').replace(/["<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
  const sector = String(t.c ?? '').toLowerCase().trim();
  return { dir: dir > 0 ? 1 : dir < 0 ? -1 : 0, tickers, topic, sector: SECTORS.includes(sector) ? sector : '' };
}

/**
 * 解析带标签的回复。返回 { scores: [分数|null], tags: [{dir,tickers,topic,sector}|null] }，整体不合法返回 null。
 * 认三种写法：[[编号,分数,方向,"代码","话题","板块"]]、[{i,s,d,k,t,c}]、以及旧的纯分数格式。
 */
export function parseTagged(raw, n) {
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
  if (!data.some((x) => Array.isArray(x))) {
    const scores = parseScores(data, n);
    if (!scores) return null;
    const tags = new Array(n).fill(null);
    for (const o of data) {
      const i = Number(o?.i);
      if (o && typeof o === 'object' && Number.isInteger(i) && i >= 0 && i < n && ('d' in o || 'k' in o || 't' in o)) tags[i] = cleanTag(o);
    }
    return { scores, tags };
  }
  const scores = new Array(n).fill(null);
  const tags = new Array(n).fill(null);
  for (const row of data) {
    if (!Array.isArray(row)) continue;
    const i = Number(row[0]);
    const sc = Number(row[1]);
    if (!Number.isInteger(i) || i < 0 || i >= n || row[1] == null || !Number.isFinite(sc)) continue;
    scores[i] = Math.max(1, Math.min(10, sc));
    if (row.length > 2) tags[i] = cleanTag({ d: row[2], k: row[3], t: row[4], c: row[5] });
  }
  return { scores, tags };
}

/**
 * @param env 含 AI 绑定
 * @param items [{title, source}]
 * @param opts.tags 是否让 AI 顺便给出方向、股票代码、话题、板块
 * @returns 每条的 AI 原始分（1-10 或 null）的数组；数组上另带 .tags（每条的标签或 null）和 .usage（本次用的 token 数）。整批失败返回 null
 */
export async function aiScores(env, items, { tags = false } = {}) {
  if (!env.AI || !items.length) return null;
  const list = items.map((it, i) => `${i}. [${it.source}] ${it.title}`).join('\n');
  try {
    const res = await env.AI.run(env.AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + '\n' + (tags ? TAG_FORMAT : PLAIN_FORMAT) },
        { role: 'user', content: list },
      ],
      max_tokens: 20 + items.length * (tags ? 30 : 14),
      temperature: 0,
    });
    const raw = res?.response ?? res;
    const parsed = parseTagged(raw, items.length);
    if (!parsed) {
      console.warn('AI reply not parseable', String(typeof raw === 'string' ? raw : JSON.stringify(raw)).slice(0, 300));
      return null;
    }
    const out = parsed.scores;
    out.tags = parsed.tags;
    out.usage = { prompt: Number(res?.usage?.prompt_tokens) || 0, completion: Number(res?.usage?.completion_tokens) || 0 };
    return out;
  } catch (e) {
    console.warn('AI scoring failed', e?.message || e);
    return null;
  }
}
