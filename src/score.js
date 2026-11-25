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
const ECHO_FORMAT = `Reply with ONLY a JSON array holding one array per headline, in the same order as the list: [number, "start", score, pick] when score and pick are both below 5 and hook is below 2, otherwise [number, "start", score, pick, direction, "TICKERS", "Topic", "sector", "Story", "kind", "who", hook].
pick: 1-10, how valuable the item is as raw material for an in-depth article for people who trade US or Saudi stocks. Judge it separately from score: a view piece can be score 2 and pick 8. 8-10: a named institution's or famous investor's concrete call, forecast or warning on a major theme ("Goldman: the market has already priced four Fed hikes", "Deutsche Bank sees the S&P 500 at 9000", "Oracle CDS spreads now above Bear Stearns in 2008", "Gundlach: US debt crisis starts in 2029"), a data-rich analysis that explains a big market move or risk, a striking historical comparison, and any event whose score is 8 or more. 5-7: useful analysis or context on a major theme (Fed and rates, AI and megacaps, oil and OPEC+, credit, Aramco, PIF, Tadawul). 1-4: routine, promotional or thin items, and markets this reader does not trade.
hook: 0-3, how eye-catching the headline itself is to a retail investor scrolling a feed, judged separately from score and pick (a minor item can be hook 3). 3: a startling number or claim attached to a famous name ("Nvidia to invest $50 billion in...", "Musk says...", "Buffett dumps...", a record, a first-ever, a collapse or surge of 20% or more in a well-known stock, a shocking forecast). 2: clearly more clickable than ordinary news (big round numbers, celebrity investors, dramatic reversals, unusual comparisons). 1: mildly interesting. 0: ordinary. Do not give 2 or 3 to routine earnings, routine analyst rating changes or promotional releases.
kind: "f" a fact or event, "v" a view, forecast or analysis attributed to an institution or a person, "d" a scheduled data release, "w" a market wrap or anything else. who: for kind "v" the institution or person whose view it is (never the outlet that published or relayed it, such as 格隆汇, 华尔街见闻 or 智通财经: leave who empty when the view is the outlet's own), English name then "|" and the usual Simplified Chinese name (Goldman Sachs|高盛, Jeffrey Gundlach|冈拉克), otherwise "". For kind "v", direction is the stance of the view and Story is the event or debate the view is about (reuse an open story when the view comments on one).
"start" is the first 12 characters of that headline's text (after the [source] tag), copied exactly; it proves the row belongs to that number.
direction: 1 bullish for the stocks concerned, -1 bearish, 0 neutral. TICKERS: up to 3 US symbols or 4-digit Tadawul codes of the listed companies it is mainly about, comma-separated, or "". Topic: the subject as a canonical English label of 1-2 words, identical for every headline on that subject (Nvidia, Fed, Oil, Iran), then "|" and its usual Simplified Chinese name in at most 6 characters (Nvidia|英伟达, Fed|美联储, Oil|原油, Tariffs|关税), or "". When the user message starts with a "Known topics" line, reuse one of those labels exactly whenever the headline is about that subject (add the Chinese name if the list has none), and make a new label only when none fits; prefer the broad subject (Nasdaq, not Nasdaq 100; AI stocks, not AI chip stocks). sector: tech, finance, energy, health, consumer, industrial, macro, crypto or other.
Story: the one specific event the headline reports. A Topic is a subject and holds many stories: headlines on the same development share one story, and separate developments of one subject are separate stories (under Nvidia, "黄仁勋复任英伟达CEO" and "特朗普提议政府入股英伟达" are two stories). When the user message has an "Open stories" line, answer with the id (S3) of the story the headline belongs to; later re-reports of it, reactions to it and price moves it caused belong to it too. Only when none fits, name a new story: a Simplified Chinese phrase of at most 14 characters saying who did what, with no date and no source name; headlines in this list on the same new event must use the identical phrase. Keep stories at the level of one newspaper article: statements, strikes and counter-strikes of the same clash on the same day are one story, not three. "" for market wraps, data roundups and anything that is not one event.
Every long row ends with hook, 12 items in all. Example: [[0,"Nvidia short",9,8,-1,"NVDA","Nvidia|英伟达","tech","S2","f","",3],[1,"Analyst rais",2,2],[2,"Saudi Aramco",8,8,1,"2222","Aramco|沙特阿美","energy","沙特阿美拟售百亿美元股份","f","",2],[3,"高盛：市场已替美联储",2,8,-1,"","Fed|美联储","macro","市场定价美联储加息四次","v","Goldman Sachs|高盛",1],[4,"Musk says he",3,3,0,"TSLA","Tesla|特斯拉","consumer","马斯克称将把全部身家押注火星计划","f","",3],[5,"Fed official",5,4,0,"","Fed|美联储","macro","","f","",0]]`;

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
  // 话题写成 "英文统一叫法|中文名"（如 "Nvidia|英伟达"）存在同一列里；归拢和查找只认英文那一半，中文名只用来显示
  const [en, zh] = String(t.t ?? '').replace(/["<>]/g, '').split('|').map((x) => x.replace(/\s+/g, ' ').trim());
  const topic = en ? en.slice(0, 30) + (zh && /\p{Script=Han}/u.test(zh) ? '|' + zh.slice(0, 12) : '') : '';
  const sector = String(t.c ?? '').toLowerCase().trim();
  const kind = String(t.kind ?? '').toLowerCase().trim().charAt(0);
  // 观点是谁的："英文名|中文名"，和话题一样存在同一列
  const who = String(t.who ?? '').replace(/["<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return { dir: dir > 0 ? 1 : dir < 0 ? -1 : 0, tickers, topic, sector: SECTORS.includes(sector) ? sector : '', story: String(t.y ?? '').trim(), kind: 'fvdw'.includes(kind) ? kind : '', who: kind === 'v' ? who : '', hook: Math.max(0, Math.min(3, Math.round(Number(t.hook) || 0))) };
}

/**
 * AI 给的“事件”：写的是已有事件的编号（S3）就换成那件事的名字；写的是新名字就整理一下（去引号、限长）。
 * 新名字和某件已有事件的名字只差标点空格时，也算那件已有的。不是一件具体的事（空、none）返回 ''。
 */
export function resolveStory(raw, known = []) {
  let x = String(raw ?? '').replace(/["'“”‘’「」《》<>|]/g, '').replace(/\s+/g, ' ').trim();
  if (!x || /^(none|null|n\/a|-)$/i.test(x)) return '';
  const m = x.match(/^S\s?(\d{1,3})(?![\p{L}\p{N}])/iu);
  if (m) return known[+m[1] - 1] || '';
  x = x.replace(/[。.，,；;：:]+$/, '').slice(0, 24);
  if (x.length < 2) return '';
  return sameStory(x, known) || x;
}

/**
 * 新事件名和已有的某件事是不是同一件：去掉标点空格后相同；一个包含另一个（如“厦门航空拟购50架波音飞机”和
 * “厦门航空拟购50架波音飞机，价值74亿美元”）；或者相邻两字的重合度很高（措辞略有出入）。是就返回已有的那个名字。
 */
export function sameStory(name, known = []) {
  const k = squash(name);
  if (k.length < 2) return '';
  const grams = (x) => {
    const g = new Set();
    for (let i = 0; i < x.length - 1; i++) g.add(x.slice(i, i + 2));
    return g;
  };
  const a = grams(k);
  let best = '';
  let bestScore = 0;
  for (const t of known) {
    const q = squash(t);
    if (q === k) return t;
    const short = Math.min(q.length, k.length);
    if (short >= 6 && (q.includes(k) || k.includes(q))) return t;
    const b = grams(q);
    let hit = 0;
    for (const g of a) if (b.has(g)) hit++;
    const dice = a.size + b.size ? (2 * hit) / (a.size + b.size) : 0;
    if (dice > bestScore) {
      bestScore = dice;
      best = t;
    }
  }
  return bestScore >= 0.72 ? best : '';
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

/** 把存着的 "英文|中文" 拆开：topic 只留英文叫法（旧数据本来就只有英文），中文名放进 topic_zh */
export function splitTopic(row) {
  if (row && typeof row.topic === 'string' && row.topic.includes('|')) {
    const [en, zh] = row.topic.split('|');
    row.topic = en;
    row.topic_zh = zh;
  }
  return row;
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
  const picks = new Array(n).fill(null);
  let fixed = 0;
  let dropped = 0;
  const put = (i, row) => {
    scores[i] = Math.max(1, Math.min(10, Number(row[2])));
    // 新格式多一个“选题分”：短行 4 项 [编号, 开头, 分数, 选题分]，长行 9 项以上；5 到 8 项的是旧格式（没有选题分）
    const neu = row.length === 4 || row.length >= 9;
    if (neu && row[3] != null && Number.isFinite(Number(row[3]))) picks[i] = Math.max(1, Math.min(10, Number(row[3])));
    tags[i] = row.length >= 9 ? cleanTag({ d: row[4], k: row[5], t: row[6], c: row[7], y: row[8], kind: row[9], who: row[10], hook: row[11] }) : row.length > 4 ? cleanTag({ d: row[3], k: row[4], t: row[5], c: row[6], y: row[7] }) : null;
  };
  const rows = data.filter((row) => Array.isArray(row) && typeof row[1] === 'string' && row[2] != null && Number.isFinite(Number(row[2])));
  const valid = (i) => Number.isInteger(i) && i >= 0 && i < n;
  const later = [];
  // 第一遍：编号和开头对得上的，直接认
  for (const row of rows) {
    const i = Number(row[0]);
    if (valid(i) && scores[i] == null && fits(i, squash(row[1]))) put(i, row);
    else later.push(row);
  }
  // 第二遍：对不上的，看开头能不能唯一对上另一条还空着的标题（编号写串了）；
  // 哪条都对不上、但编号的位置还空着的，按编号认（多半只是开头抄得不准）；其余丢掉，那条快讯交给规则
  for (const row of later) {
    const e = squash(row[1]);
    const i = Number(row[0]);
    const hits = keys.map((_, k) => k).filter((k) => scores[k] == null && fits(k, e));
    if (hits.length === 1) {
      put(hits[0], row);
      fixed++;
    } else if (hits.length > 1 && valid(i) && hits.includes(i)) put(i, row);
    else if (!hits.length && valid(i) && scores[i] == null && !keys.some((_, k) => fits(k, e))) put(i, row);
    else dropped++;
  }
  return { scores, tags, picks, fixed, dropped };
}

/**
 * @param env 含 ANTHROPIC_API_KEY（Claude，首选）和/或 AI 绑定（Workers AI，后备）
 * @param items [{title, source}]
 * @param opts.tags 是否让 AI 顺便给出方向、股票代码、话题、板块
 * @returns 每条的 AI 原始分（1-10 或 null）的数组；数组上另带 .tags（每条的标签或 null）、.usage（本次用的 token 数）
 *          和 .provider（'claude' 或 'workers'）。两家都失败返回 null
 */
/**
 * 把 AI 给的话题对到已有的话题上（不花钱的归并）：英文叫法相同（不分大小写）就用已有的写法；
 * 英文不同但中文名相同（如 "Nasdaq 100|纳指" 和 "Nasdaq|纳指"）也并到已有的那个；已有的没有中文名时补上。
 */
export function canonTopic(topic, known = []) {
  if (!topic) return topic;
  const [en, zh = ''] = topic.split('|');
  const list = known.map((k) => String(k).split('|'));
  const hit = list.find((k) => k[0].toLowerCase() === en.toLowerCase()) || (zh ? list.find((k) => k[1] && k[1] === zh) : null);
  if (!hit) return topic;
  const z = hit[1] || zh;
  return hit[0] + (z ? '|' + z : '');
}

export async function aiScores(env, items, { tags = false, topics = [], stories = [] } = {}) {
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
    // 事件只认 Claude 给的（带已有事件清单的那种问法）；后备模型不分事件，网页会退回按股票 / 话题归拢
    // 同一批里先出现的新事件名也算“已有”：后面措辞略有出入的同一件事会并到它上面
    const seen = stories.slice();
    out.tags = parsed.tags.map((t) => {
      if (!t) return t;
      const story = provider === 'claude' ? resolveStory(t.story, seen) : '';
      if (story && !seen.includes(story)) seen.push(story);
      return { ...t, topic: t.topic ? canonTopic(t.topic, topics) : t.topic, story };
    });
    out.picks = parsed.picks || [];
    out.usage = usage;
    out.fixed = parsed.fixed || 0;
    out.dropped = parsed.dropped || 0;
    out.provider = provider;
    return out;
  };

  if (claudeUp(env)) {
    // 已有话题放在用户消息开头（不放进系统提示词，免得每次变动都让提示词缓存失效）
    const known =
      (tags && topics.length ? `Known topics: ${topics.join('; ')}\n` : '') + (tags && stories.length ? `Open stories: ${stories.map((t, k) => `S${k + 1} ${t}`).join('; ')}\n` : '');
    const res = await claudeText(env, { system: tags ? SYSTEM_PROMPT + '\n' + ECHO_FORMAT : system, user: (known ? known + '\n' : '') + list, maxTokens: 100 + items.length * (tags ? 115 : 24), kind: 'score' });
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
