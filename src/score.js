// 给候选快讯打 1-10 分，再按来源加权、对例行新闻减分。
// 首选 Claude Haiku（配了 ANTHROPIC_API_KEY 时），出错时退回 Cloudflare Workers AI（免费额度）；
// 两家都不行就返回 null，调用方自动退回规则判断。

import { claudeText, claudeUp } from './claude.js';

// 每次调用都要带上这段固定提示词，它占了大部分额度，所以写得尽量短（约 400 token）。
const SYSTEM_PROMPT = `Rate financial headlines 1-10 for a trader of US and Saudi (Tadawul) stocks who wants only eye-catching, market-moving breaking news. Headlines may be English, Chinese or Arabic; judge them alike.
8-10: huge sums ($10 billion or more), sudden large moves in an index or megacap, crashes, trading halts, major mergers, CEO ousted or reinstated, bankruptcies, defaults, central bank or government surprises, sanctions, war, OPEC+ shocks.
5-7: notable but expected or second-order news.
1-4: routine earnings, analyst ratings or price targets, market wraps, opinion, explainers, advice, ads, minor company news; also news mainly about China, Hong Kong, Japan, Europe or other local markets (including large deals by companies listed there) unless it clearly moves US or Saudi stocks or oil.
Be strict: most headlines score 1-5 and only a few per day deserve 8+.
Examples: "Nvidia short sellers reap $24 billion as stock extends slide" = 9; "Fed unexpectedly cuts rates by 50bp" = 10; "Tadawul main index plunges 6%" = 9; "Saudi Aramco to sell $10 billion of shares" = 8; "Asian chip stocks jump after Nvidia news" = 5; "Fed official says rates likely higher over time" = 5; "Saudi company reports quarterly profit" = 3; "Analyst raises price target" = 2; "上证指数收涨0.5%" = 1.
The user message lists numbered headlines.`;
const PLAIN_FORMAT = `Reply with ONLY a JSON array with one object per headline, using the headline's number as "i": [{"i": 0, "s": 7}, {"i": 1, "s": 2}]. No other text.`;
// 带标签的格式：分数低于 5 的只回 [编号, 分数]，省输出；5 分以上再加方向、股票代码、话题、板块
const TAG_FORMAT = `Reply with ONLY a JSON array holding one array per headline: [number, score] when the score is below 5, otherwise [number, score, direction, "TICKERS", "Topic", "sector"].
direction: 1 bullish for the stocks concerned, -1 bearish, 0 neutral. TICKERS: up to 3 US symbols or 4-digit Tadawul codes of the listed companies it is mainly about, comma-separated, or "". Topic: the subject as a canonical English label of 1-2 words, identical for every headline on that subject (Nvidia, Fed, Oil, Iran), or "". sector: tech, finance, energy, health, consumer, industrial, macro, crypto or other.
Example: [[0,9,-1,"NVDA","Nvidia","tech"],[1,2],[2,8,1,"2222","Aramco","energy"]]`;

// Claude 专用：每行多抄一小段标题开头，用来核对编号有没有串行（实测偶尔会把相邻两条的编号写反）
const ECHO_FORMAT = `Reply with ONLY a JSON array holding one array per headline, in the same order as the list: [number, "start", score] when the score is below 5, otherwise [number, "start", score, direction, "TICKERS", "Topic", "sector"].
"start" is the first 12 characters of that headline's text (after the [source] tag), copied exactly; it proves the row belongs to that number.
direction: 1 bullish for the stocks concerned, -1 bearish, 0 neutral. TICKERS: up to 3 US symbols or 4-digit Tadawul codes of the listed companies it is mainly about, comma-separated, or "". Topic: the subject as a canonical English label of 1-2 words, identical for every headline on that subject (Nvidia, Fed, Oil, Iran), or "". sector: tech, finance, energy, health, consumer, industrial, macro, crypto or other.
Example: [[0,"Nvidia short",9,-1,"NVDA","Nvidia","tech"],[1,"Analyst rais",2],[2,"Saudi Aramco",8,1,"2222","Aramco","energy"]]`;

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

const squash = (x) => String(x ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * 解析带“标题开头”的回复：[[编号, "开头", 分数, 方向, "代码", "话题", "板块"]]。
 * 开头和该编号的标题对不上时，改找开头对得上的那一条（只有唯一一条时才认）；找不到就丢掉这一行，那条快讯交给规则。
 * 返回 { scores, tags, fixed, dropped }，整体不合法返回 null。
 */
export function parseEchoed(raw, titles) {
  const n = titles.length;
  const m = String(raw ?? '').match(/\[[\s\S]*\]/);
  if (!m) return null;
  let data;
  try {
    data = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const keys = titles.map(squash);
  const fits = (i, e) => e.length >= 4 && (keys[i].startsWith(e.slice(0, 8)) || (keys[i].length < 8 && e.startsWith(keys[i])));
  const scores = new Array(n).fill(null);
  const tags = new Array(n).fill(null);
  let fixed = 0;
  let dropped = 0;
  for (const row of data) {
    if (!Array.isArray(row) || typeof row[1] !== 'string') continue;
    const sc = Number(row[2]);
    if (row[2] == null || !Number.isFinite(sc)) continue;
    const e = squash(row[1]);
    let i = Number(row[0]);
    if (!(Number.isInteger(i) && i >= 0 && i < n && fits(i, e))) {
      const hits = keys.map((_, k) => k).filter((k) => fits(k, e));
      if (hits.length !== 1) {
        dropped++;
        continue;
      }
      i = hits[0];
      fixed++;
    }
    scores[i] = Math.max(1, Math.min(10, sc));
    tags[i] = row.length > 3 ? cleanTag({ d: row[3], k: row[4], t: row[5], c: row[6] }) : null;
  }
  return { scores, tags, fixed, dropped };
}

/**
 * @param env 含 ANTHROPIC_API_KEY（Claude，首选）和/或 AI 绑定（Workers AI，后备）
 * @param items [{title, source}]
 * @param opts.tags 是否让 AI 顺便给出方向、股票代码、话题、板块
 * @returns 每条的 AI 原始分（1-10 或 null）的数组；数组上另带 .tags（每条的标签或 null）、.usage（本次用的 token 数）
 *          和 .provider（'claude' 或 'workers'）。两家都失败返回 null
 */
export async function aiScores(env, items, { tags = false } = {}) {
  if (!items.length) return null;
  const system = SYSTEM_PROMPT + '\n' + (tags ? TAG_FORMAT : PLAIN_FORMAT);
  const list = items.map((it, i) => `${i}. [${it.source}] ${it.title}`).join('\n');
  const finish = (raw, usage, provider) => {
    const parsed = provider === 'claude' && tags ? parseEchoed(raw, items.map((it) => it.title)) : parseTagged(raw, items.length);
    if (parsed?.fixed || parsed?.dropped) console.warn(`claude rows renumbered: ${parsed.fixed}, dropped: ${parsed.dropped}`);
    if (!parsed) {
      console.warn(provider + ' reply not parseable', String(typeof raw === 'string' ? raw : JSON.stringify(raw)).slice(0, 300));
      return null;
    }
    const out = parsed.scores;
    out.tags = parsed.tags;
    out.usage = usage;
    out.provider = provider;
    return out;
  };

  if (claudeUp(env)) {
    const res = await claudeText(env, { system: tags ? SYSTEM_PROMPT + '\n' + ECHO_FORMAT : system, user: list, maxTokens: 100 + items.length * (tags ? 70 : 24), kind: 'score' });
    const out = res && finish(res.text, { prompt: res.usage.input, completion: res.usage.output }, 'claude');
    if (out) return out;
  }

  if (!env.AI) return null;
  try {
    const res = await env.AI.run(env.AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: list },
      ],
      max_tokens: 20 + items.length * (tags ? 30 : 14),
      temperature: 0,
    });
    return finish(res?.response ?? res, { prompt: Number(res?.usage?.prompt_tokens) || 0, completion: Number(res?.usage?.completion_tokens) || 0 }, 'workers');
  } catch (e) {
    console.warn('AI scoring failed', e?.message || e);
    return null;
  }
}
