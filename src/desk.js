// 选题台（小试）：
// 1) “选题会”：每天两次（沙特开盘前、美股开盘前）加上随时手动，用更强的模型把最近 12 小时的要闻放在一起看，
//    给出前 5 个选题和理由，显示在首页最上面；
// 2) 用户点“就写这个 / 这个不对”，选择记进数据库，以后用来校准排序；
// 3) 选中的选题按需生成“专题档案”：固定的几个部分，每句标来源，网页上标明每部分是基于正文还是只有标题。
//    用户可以把自己读得到的全文贴进来，档案会更扎实。
// 读者设定：沙特投资者，交易美股和沙特股（只涉及其中一个市场的事也可以入选）；app 里的文章用英语，每天 1 到 2 篇。

import { claudeText, claudeUp, claudeUsd, claudeState } from './claude.js';
import { bjTime, eventKeys } from './brief.js';
import { metaGet, metaSet } from './dbguard.js';

const H = 3_600_000;

export const DESK_TABLES = [
  'CREATE TABLE IF NOT EXISTS desk_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, slot TEXT, n INTEGER, topics TEXT, usd REAL, model TEXT)',
  'CREATE TABLE IF NOT EXISTS desk_picks (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, run_id INTEGER NOT NULL, rank INTEGER NOT NULL, verdict TEXT NOT NULL, title TEXT, note TEXT)',
  'CREATE TABLE IF NOT EXISTS desk_dossiers (run_id INTEGER NOT NULL, rank INTEGER NOT NULL, title TEXT, body TEXT, srcs TEXT, pasted TEXT, created INTEGER, updated INTEGER, writes INTEGER NOT NULL DEFAULT 0, usd REAL, PRIMARY KEY (run_id, rank))',
];

export function deskConfig(env) {
  return {
    on: env.DESK !== 'false',
    model: env.DESK_MODEL || 'claude-sonnet-5-5',
    windowH: Number(env.DESK_WINDOW_HOURS || 24), // 选题会看最近多少小时
    minScore: Number(env.DESK_ITEM_MIN || 6), // 突发分多少以上的快讯进选题会
    minPick: Number(env.DESK_PICK_MIN || 6), // 选题分多少以上的（观点、深度分析）也进选题会，哪怕突发分很低
    maxTopics: Number(env.DESK_MAX_TOPICS || 8),
    maxItems: Number(env.DESK_MAX_ITEMS || 220), // 一次最多给模型看多少条
    dailyUsd: Number(env.DESK_DAILY_USD || 0.5), // 选题会 + 档案每天最多花多少美元
    manualMin: Number(env.DESK_MANUAL_MIN || 30), // 手动“现在开一次”至少隔多少分钟
    dossierMin: Number(env.DESK_DOSSIER_MIN || 20), // 同一份档案至少隔多少分钟才重写（贴了新全文不受限）
    dossierH: Number(env.DESK_DOSSIER_HOURS || 48), // 档案往前找多久的相关报道
    maxSrc: Number(env.DESK_MAX_SOURCES || 40),
    pasteMax: Number(env.DESK_PASTE_MAX || 12000), // 每段贴进来的全文最多多少字
  };
}

/* ---------- 什么时候开选题会 ---------- */

const fmtCache = new Map();
function parts(ts, tz) {
  let f = fmtCache.get(tz);
  if (!f) fmtCache.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' })));
  const o = {};
  for (const p of f.formatToParts(new Date(ts))) o[p.type] = p.value;
  return { wd: o.weekday, min: Number(o.hour) * 60 + Number(o.minute), day: `${o.year}-${o.month}-${o.day}` };
}
// 沙特：周日到周四 10:00 开盘（利雅得时间），提前半小时；美股：周一到周五 9:30 开盘（纽约时间），提前一小时
const SLOTS = [
  { slot: 'saudi', tz: 'Asia/Riyadh', at: 9 * 60 + 30, days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'] },
  { slot: 'us', tz: 'America/New_York', at: 8 * 60 + 30, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
];
/** 现在是不是在某一场选题会的时间窗里（开始后 25 分钟内）；是则返回 { slot, day } */
export function deskSlot(now) {
  for (const s of SLOTS) {
    const p = parts(now, s.tz);
    if (s.days.includes(p.wd) && p.min >= s.at && p.min < s.at + 25) return { slot: s.slot, day: p.day };
  }
  return null;
}
/** 下一场定时选题会 { slot, ts } */
export function nextSlot(now) {
  let t = Math.ceil(now / (30 * 60_000)) * 30 * 60_000;
  for (let k = 0; k < 6 * 48; k++, t += 30 * 60_000) {
    for (const s of SLOTS) {
      const p = parts(t, s.tz);
      if (s.days.includes(p.wd) && p.min === s.at) return { slot: s.slot, ts: t };
    }
  }
  return null;
}

/* ---------- 材料 ---------- */

const clean = (s) =>
  String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** 正文里去掉开头重复的标题后还剩多少 */
export function bodyOf(i) {
  const t = clean(i.title);
  let b = clean(i.body);
  if (b && t && b.startsWith(t.slice(0, 30))) b = b.slice(t.length).trim();
  return b;
}
/** 这条材料有多厚：f = 有成段正文，s = 一两句摘要，h = 只有标题 */
export function thickness(i) {
  const n = bodyOf(i).length;
  return n >= 400 ? 'f' : n >= 60 ? 's' : 'h';
}
/** 同一家媒体的不同渠道算一家（互相转载不该让一件事显得更大） */
export function outlet(source) {
  return String(source || '')
    .replace(/\s*\(Bluesky\)\s*$/i, '')
    .replace(/\s+(Markets|Currents|Business)$/i, '')
    .replace(/文章$/, '')
    .trim();
}

/**
 * 把最近的要闻排成给模型看的清单：同一件事（打分时归好的事件）放在一起，每件事最多列 6 条最重要的。
 * 返回 { text, list }，list[k] 是编号 k+1 的那条。
 */
export function deskInput(rows, articles, max) {
  const groups = new Map();
  // 观点线索（机构、知名人物、深度媒体怎么看）单独列一节，不和突发事实混在一起
  const views = rows.filter((r) => r.kind === 'v').sort((a, b) => (b.pick || 0) - (a.pick || 0) || b.ts - a.ts).slice(0, 60);
  const isView = new Set(views.map((r) => r.id));
  for (const r of rows) {
    if (r.kind === 'v') continue;
    const k = eventKeys(r)[0] || '';
    const key = r.story ? k : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const gs = [...groups].map(([key, items]) => {
    items.sort((a, b) => (b.score || 0) - (a.score || 0) || b.ts - a.ts);
    return { key, items, top: items[0].score || 0, last: Math.max(...items.map((i) => i.ts)), outlets: new Set(items.map((i) => outlet(i.source))).size };
  });
  gs.sort((a, b) => (a.key === '') - (b.key === '') || b.top - a.top || b.items.length - a.items.length);
  const list = [];
  const out = [];
  const line = (i) => {
    list.push(i);
    const b = bodyOf(i);
    const who = i.who ? String(i.who).split('|').pop() : '';
    return `[${list.length}] ${bjTime(i.ts)} | ${i.source}${articles.has(i.source) ? '（深度文章）' : ''} | 突发${Math.round((i.score || 0) * 10) / 10}${i.pick != null ? ' 选题' + Math.round(i.pick * 10) / 10 : ''}${who ? ' | 观点方：' + who : ''}${i.tickers ? ' | ' + i.tickers : ''} | ${clean(i.title).slice(0, 260)}${b.length >= 40 ? '\n     摘要：' + b.slice(0, 240) : ''}`;
  };
  const cap = max - views.length;
  for (const g of gs) {
    if (list.length >= cap) break;
    const show = g.key === '' ? g.items.slice(0, Math.max(0, cap - list.length)) : g.items.slice(0, 6);
    if (!show.length) continue;
    out.push(g.key === '' ? `## 没有归到具体事件的要闻` : `## 事件：${g.key.slice(1)}（共 ${g.items.length} 条，${g.outlets} 家媒体，最新 ${bjTime(g.last)}）`);
    for (const i of show) out.push(line(i));
    if (show.length < g.items.length && g.key !== '') out.push(`    （另有 ${g.items.length - show.length} 条同一事件的报道未列出）`);
  }
  if (views.length) {
    out.push('## 观点线索：机构、知名人物和深度媒体怎么看（单条不一定够成题，可以并进上面的事件，也可以几条合成一个题）');
    for (const i of views) out.push(line(i) + (i.story ? `\n     所属事件：${i.story}` : ''));
  }
  return { text: out.join('\n'), list, groups: gs, views: isView.size };
}

export const DESK_SYSTEM = `你是一家面向沙特投资者的财经 app 的选题主编。读者是沙特投资者，交易美股和沙特股（Tadawul），文章用英语发布，每天只做 1 到 2 篇有分量的稿子。

用户消息是一个新闻看板在过去 24 小时里收集到的材料，分两部分：前面是突发事实，已经按"同一件事"粗略归好；最后一节是"观点线索"，是机构、知名人物和深度媒体对市场的看法。每条前面有编号 [n]，时间是北京时间。"突发N"是这条消息有多突发、多重大，"选题N"是它作为写稿原料的价值（都是 10 分最高）。大部分只有标题，少数带一两句摘要。

你的任务：开一次选题会，从中选出最值得做成文章的 5 到 8 个选题，按值得做的程度从高到低排列。

选题有两种来路，都要考虑：
- 一件大事本身。这时把观点线索里和它有关的看法并进来，文章才有深度（比如"加息预期升温"这件事，并入高盛、摩根大通的两条看法）。
- 几条观点线索合成的一个题（比如几家机构对同一个问题的分歧，或者一个有分量的反常识判断）。单条观点通常不够，但有具体数字或大胆判断、又切中当前市场焦点的，可以单独成题。

怎么判断"值得做"（按重要性排列）：
1. 市场分量：这件事会不会真的影响价格和资金流向（指数级别、大市值公司、油价、美联储和利率、美元、沙特本地的阿美 / PIF / 银行 / 交易所规则 / 大型 IPO）。
2. 对这位读者的相关性：沙特投资者为什么要关心。常见的连接点：油价和 OPEC+；美联储利率（里亚尔盯住美元，沙特央行跟随加减息）；海湾主权基金和沙特企业参与的交易；海湾散户重仓的美股大公司；Tadawul 上市公司的公告和业绩。一件事只涉及美股或只涉及沙特股都可以入选，不要求两个市场都沾边；但和这位读者能买卖的东西完全没有连接点的事（比如纯粹的美国地方新闻）要降级。
3. 还在发展、有悬念：正在推进、接下来有明确节点的事，比已经尘埃落定的事更值得做。
4. 能不能写出一篇像样的文章：有没有清楚的角度，材料够不够。只有一两条标题的事可以入选，但要在理由里直说材料很薄。

注意：
- 报道条数多不等于市场更关注，媒体之间大量互相转载。条数和"几家媒体"只是很弱的参考。
- 看板的归类不一定对：同一件事可能被分在几个"事件"下，要合并成一个选题；一个"事件"下如果混了几件事，只取你要的那几条。5 个选题不能有两个讲的是同一件事。
- 只能依据清单里的内容。理由里可以有你的判断（为什么重要、可以从哪个角度写），但不准补充清单里没有的事实、数字或背景，也不预测涨跌。
- 例行的行情综述（"美股收高""早盘要闻汇总"）不算选题，除非背后有一件具体的事。
- 清单里够格的事不足 5 件时，有几件写几件，不要凑数。
- "facts" 是让主编不点开也能看懂这件事的三条关键事实：每条一句话（不超过 40 个字），必须出自清单里的某一条，并给出那条的编号。
- "write" 标出今天最值得动笔的选题：最多 2 个，通常就是排在最前面的 1 到 2 个；如果今天没有真正够分量的，可以一个都不标。

只输出一个 JSON 对象，不要任何别的文字，不要代码块标记：
{"topics":[{"title_zh":"不超过 26 个字的中文选题名，说清是哪件事","title_en":"English topic name, at most 12 words","why_zh":"两句话。第一句：发生了什么、市场为什么在意。第二句：沙特投资者为什么要关心、可以从哪个角度写；材料很薄时在这里直说。","why_en":"The same two sentences in English.","angle_en":"A working English headline for the article, at most 14 words","market":"US 或 Saudi 或 Both","tickers":["最相关的股票代码，最多 4 个，没有就空数组"],"facts":[["一句话事实",清单编号],["一句话事实",清单编号],["一句话事实",清单编号]],"items":[这个选题用到的清单编号（事实和观点线索都算），最多 18 个],"write":true}]}`;

/** 从模型的回答里取出 JSON；整理成选题列表（编号换成快讯 id，算出材料厚度） */
export function parseDesk(text, list, max = 8) {
  const s = String(text || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let d;
  try {
    d = JSON.parse(s.slice(a, b + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(d?.topics)) return null;
  const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  const topics = [];
  let writes = 0;
  for (const t of d.topics.slice(0, max)) {
    const items = [...new Set((Array.isArray(t.items) ? t.items : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= list.length))].slice(0, 18).map((n) => list[n - 1]);
    if (!items.length || !str(t.title_zh || t.title_en, 10)) continue;
    const basis = { f: 0, s: 0, h: 0 };
    items.forEach((i) => basis[thickness(i)]++);
    const stories = [...new Set(items.map((i) => i.story).filter(Boolean))];
    const write = !!t.write && writes < 2;
    if (write) writes++;
    topics.push({
      rank: topics.length + 1,
      title_zh: str(t.title_zh || t.title_en, 60),
      title_en: str(t.title_en || t.title_zh, 140),
      why_zh: str(t.why_zh || t.why_en, 400),
      why_en: str(t.why_en || t.why_zh, 700),
      angle_en: str(t.angle_en, 180),
      market: /^saudi$/i.test(t.market) ? 'Saudi' : /^both$/i.test(t.market) ? 'Both' : 'US',
      tickers: (Array.isArray(t.tickers) ? t.tickers : []).map((x) => str(x, 12).toUpperCase().replace(/[^A-Z0-9.]/g, '')).filter(Boolean).slice(0, 4),
      ids: items.map((i) => i.id),
      // 三条关键事实（各带出处）和并进来的观点线索：选题卡上直接显示
      facts: (Array.isArray(t.facts) ? t.facts : [])
        .map((f) => (Array.isArray(f) ? { t: str(f[0], 120), i: list[Number(f[1]) - 1] } : null))
        .filter((f) => f && f.t && f.i)
        .slice(0, 3)
        .map((f) => ({ t: f.t, id: f.i.id, src: outlet(f.i.source), url: f.i.url || undefined })),
      views: items
        .filter((i) => i.kind === 'v')
        .slice(0, 6)
        .map((i) => ({ who: i.who || '', t: clean(i.title).slice(0, 120), dir: i.dir || 0, id: i.id, url: i.url || undefined })),
      stories,
      n: items.length,
      outlets: new Set(items.map((i) => outlet(i.source))).size,
      top: Math.max(...items.map((i) => i.score || 0)),
      last: Math.max(...items.map((i) => i.ts)),
      basis,
      write,
    });
  }
  return topics.length ? topics : null;
}

/* ---------- 花费和状态 ---------- */

async function spentToday(env, now) {
  try {
    const rows = (await env.DB.prepare("SELECT input_tokens, output_tokens FROM claude_usage WHERE day = ? AND kind IN ('desk', 'dossier')").bind(new Date(now).toISOString().slice(0, 10)).all()).results;
    return rows.reduce((a, r) => a + claudeUsd(r.input_tokens, r.output_tokens), 0);
  } catch {
    return 0;
  }
}

const safeJson = (s, d) => {
  try {
    return s ? JSON.parse(s) : d;
  } catch {
    return d;
  }
};

let tablesOk = false;
async function ensureTables(env) {
  if (tablesOk) return;
  for (const s of DESK_TABLES) await env.DB.prepare(s).run();
  tablesOk = true;
}

/** 开一次选题会。返回 { ok, run } 或 { ok: false, error } */
export async function runDesk(env, { now = Date.now(), slot = 'manual', articles = new Set() } = {}) {
  const c = deskConfig(env);
  if (!c.on) return { ok: false, error: 'off' };
  if (!claudeUp(env)) return { ok: false, error: 'claude_down' };
  await ensureTables(env);
  const spent = await spentToday(env, now);
  if (spent >= c.dailyUsd) return { ok: false, error: 'budget', spent };
  // 分数线直接写进语句，用得上部分索引 idx_items_brief（5 分以上、不是重复的）
  const rows = (
    await env.DB.prepare(`SELECT id, source, title, body, url, ts, score, confirms, dir, tickers, topic, story FROM items WHERE ts > ? AND dup_of IS NULL AND score >= ${Number(c.minScore) || 6} ORDER BY ts DESC LIMIT 600`)
      .bind(now - c.windowH * H)
      .all()
  ).results;
  // 选题分高的（观点、深度分析）另查一次，走部分索引 idx_items_pick；还没有这几列（v14 之前）时跳过
  try {
    const have = new Map(rows.map((r) => [r.id, r]));
    const picked = (
      await env.DB.prepare(`SELECT id, source, title, body, url, ts, score, confirms, dir, tickers, topic, story, pick, kind, who FROM items WHERE ts > ? AND pick >= ${Number(c.minPick) || 6} AND dup_of IS NULL ORDER BY ts DESC LIMIT 400`)
        .bind(now - c.windowH * H)
        .all()
    ).results;
    for (const p of picked) {
      const o = have.get(p.id);
      if (o) Object.assign(o, { pick: p.pick, kind: p.kind, who: p.who });
      else rows.push(p);
    }
  } catch {}
  if (rows.length < 5) return { ok: false, error: 'too_few', n: rows.length };
  const inp = deskInput(rows, articles, c.maxItems);
  const user = `现在是北京时间 ${bjTime(now)}。过去 ${c.windowH} 小时里够格的材料共 ${rows.length} 条（其中观点线索 ${inp.views} 条），下面列出 ${inp.list.length} 条：\n\n${inp.text}`;
  const res = await claudeText(env, { system: DESK_SYSTEM, user, maxTokens: 16000, kind: 'desk', effort: 'medium', model: c.model, timeout: 150_000 });
  if (!res) return { ok: false, error: 'model', detail: claudeState().last_error };
  const topics = parseDesk(res.text, inp.list, c.maxTopics);
  if (!topics) return { ok: false, error: 'parse' };
  const usd = claudeUsd(res.usage.input, res.usage.output);
  const r = await env.DB.prepare('INSERT INTO desk_runs (ts, slot, n, topics, usd, model) VALUES (?, ?, ?, ?, ?, ?)').bind(now, slot, rows.length, JSON.stringify(topics), usd, c.model).run();
  return { ok: true, run: { id: r.meta?.last_row_id, ts: now, slot, n: rows.length, topics, usd } };
}

const mem = { done: '', busy: false };
/** 每分钟的定时任务里调用：到点了（且今天这一场还没开过）就开一次。不在时间窗里时不碰数据库。 */
export async function deskCron(env, { now = Date.now(), articles = new Set() } = {}) {
  const c = deskConfig(env);
  const s = c.on && deskSlot(now);
  if (!s) return null;
  const key = s.slot + ':' + s.day;
  if (mem.done === key || mem.busy) return null;
  const m = (await metaGet(env, 'desk_slot'))?.v;
  const same = m?.key === key;
  if (same && (m.ok || m.tries >= 2)) {
    mem.done = key;
    return null;
  }
  if (same && now - m.at < 6 * 60_000) return null; // 上一次没成，过几分钟再试一次
  mem.busy = true;
  try {
    await metaSet(env, 'desk_slot', { key, tries: (same ? m.tries : 0) + 1, at: now }, now);
    const r = await runDesk(env, { now, slot: s.slot, articles });
    if (r.ok) {
      await metaSet(env, 'desk_slot', { key, tries: (same ? m.tries : 0) + 1, at: now, ok: 1 }, now);
      mem.done = key;
    }
    return r;
  } finally {
    mem.busy = false;
  }
}

/** 网页用：最新一场选题会、用户的选择、已生成的档案 */
export async function deskState(env, { now = Date.now() } = {}) {
  const c = deskConfig(env);
  const out = { now, on: c.on, run: null, picks: {}, dossiers: {}, next: nextSlot(now), manual_min: c.manualMin };
  if (!c.on) return out;
  try {
    const r = (await env.DB.prepare('SELECT id, ts, slot, n, topics FROM desk_runs ORDER BY id DESC LIMIT 1').all()).results?.[0];
    if (!r) return out;
    out.run = { id: r.id, ts: r.ts, slot: r.slot, n: r.n, topics: safeJson(r.topics, []) };
    const picks = (await env.DB.prepare('SELECT rank, verdict, ts, note FROM desk_picks WHERE run_id = ? ORDER BY id').bind(r.id).all()).results;
    for (const p of picks) {
      if (p.verdict === 'clear') delete out.picks[p.rank];
      else out.picks[p.rank] = { verdict: p.verdict, ts: p.ts, note: p.note || undefined };
    }
    const ds = (await env.DB.prepare('SELECT rank, title, body, srcs, pasted, created, updated, writes FROM desk_dossiers WHERE run_id = ?').bind(r.id).all()).results;
    for (const d of ds) out.dossiers[d.rank] = { title: d.title, body: d.body, srcs: safeJson(d.srcs, []), updated: d.updated, writes: d.writes, pasted: safeJson(d.pasted, []).map((p) => ({ label: p.label, len: p.text.length })) };
  } catch {
    // 表还没建（还没开过选题会）
  }
  return out;
}

/** 记下用户的选择：pick = 就写这个，pass = 这个不对，clear = 撤销 */
export async function deskPick(env, { run, rank, verdict, note = '', now = Date.now() }) {
  if (!['pick', 'pass', 'clear'].includes(verdict)) return { ok: false, error: 'bad_verdict' };
  await ensureTables(env);
  const r = (await env.DB.prepare('SELECT id, topics FROM desk_runs WHERE id = ?').bind(Number(run) || 0).all()).results?.[0];
  const t = r && safeJson(r.topics, []).find((x) => x.rank === Number(rank));
  if (!t) return { ok: false, error: 'no_topic' };
  await env.DB.prepare('INSERT INTO desk_picks (ts, run_id, rank, verdict, title, note) VALUES (?, ?, ?, ?, ?, ?)').bind(now, r.id, t.rank, verdict, t.title_zh, String(note || '').slice(0, 300)).run();
  return { ok: true };
}

/* ---------- 专题档案 ---------- */

export const DOSSIER_SYSTEM = `你是一家面向沙特投资者的财经 app 的资深编辑。读者是沙特投资者，交易美股和沙特股（Tadawul）。你要为主编选定的一个选题整理一份"专题档案"：先让主编几分钟内看懂这件事，再作为写英文稿的底稿。

用户消息里是这个选题目前收集到的全部材料。每条前面有编号 [S1]、[S2]…，时间为北京时间；每条标明了材料的厚度：〔正文〕有成段原文，〔摘要〕只有一两句，〔仅标题〕只有标题。主编贴进来的全文编号是 [P1]、[P2]…。

硬性规则（准确性第一）：
1. 事实、数字、引语只能来自材料里明确写出的内容。不准补充任何你自己知道的背景、数字、人物身份、历史对比。材料没说的，就不写。
2. 除"为什么重要"里的推断、"还不知道什么"和"可以怎么写"之外，每一句话结尾都用方括号标来源编号，如 [S3] 或 [S3][P1]。一句话里的每个事实都要能在所标来源里找到。
3. 〔仅标题〕的材料只能支持标题字面上说的那一点，不能从标题推出细节。评论、分析文章的标题只是作者观点，要写成"某某文章认为……"。
4. "据某某报道""知情人士称"这类未经证实的消息，保留消息来源的措辞，不写成既成事实。来源之间数字不一致时写明分歧并分别标注。
5. 观点要写明是谁的观点。档案本身不给投资建议、不预测涨跌。
6. 你自己的分析只允许出现在"为什么重要"里，并且每一句都以"推断："开头，推断必须建立在前面已标注来源的事实上。
7. 材料里混进了和这个选题无关的消息，忽略它们。
8. 材料不够支撑某个部分时，那个部分就写短，或者直接写"材料里没有"。宁可空着，不要凑。

结构固定为以下小标题，顺序不变：
## 一句话
（不超过 45 个字，说清发生了什么）
## 为什么重要
（2 到 4 句。先写有来源的事实：这件事的分量在哪里；再写对沙特投资者的意义。材料里没有直接讲到沙特或海湾的，用"推断："写出你认为的连接点，例如油价、利率与里亚尔盯住美元、海湾资金的持仓，没有合理的连接点就直说关系不大。）
## 进展到哪一步
（按时间从早到晚的列表，每条以"MM-DD HH:MM"开头，只列关键节点，最多 8 条；最后一条写目前停在哪里）
## 关键数字
（列表，每条"指标：数字（口径或时间）"，数字原样来自来源，最多 8 条；没有数字就写"材料里没有可用的数字"）
## 各方说法
（列表，每条"谁：说了什么"，最多 6 条，有不同看法时两方都要有）
## 还不知道什么
（列表，2 到 5 条：要把这件事写成一篇站得住的文章，还缺哪些关键信息，或者哪些说法目前只有标题、需要读到原文核实。这一部分不用标来源。）
## 可以怎么写
（这一部分用英语写，不用标来源，不准出现材料里没有的事实：
- Headline options: 三个英文标题备选，每个不超过 14 个词
- Angle: 一句话说明这篇文章对沙特投资者的切入点
- Outline: 4 到 5 条提纲，每条一行
- Before publishing: 发稿前必须先核实或补齐的 1 到 3 件事）

写作要求：前六个部分用简体中文，书面、凝练，不重复同一事实；外国人名、公司名用通行中文译名，没有通行译名的保留原文。只输出档案正文（Markdown），不要前言后语。`;

const THICK = { f: '正文', s: '摘要', h: '仅标题' };

/** 给档案挑材料并编号。返回 [{ n, id, source, title, body, ts, url, score, k, art }] */
export function dossierSources(items, arts, max) {
  let list = items.slice();
  if (list.length > max) {
    // 太多时：有正文的优先留，其次分数高的
    const w = (i) => (thickness(i) === 'f' ? 2 : thickness(i) === 's' ? 1 : 0);
    list = list.sort((a, b) => w(b) - w(a) || (b.score || 0) - (a.score || 0) || b.ts - a.ts).slice(0, max);
  }
  list.sort((a, b) => a.ts - b.ts);
  const all = [...list.map((i) => ({ ...i, art: false })), ...arts.slice(0, 10).map((a) => ({ ...a, art: true }))];
  return all.map((i, k) => ({ n: k + 1, id: i.id, source: i.source, title: clean(i.title), body: bodyOf(i), ts: i.ts, url: i.url, score: i.score, k: thickness(i), art: i.art }));
}

export function dossierText(srcs, pasted) {
  const a = srcs.map((s) => {
    const head = `[S${s.n}] ${bjTime(s.ts)} | ${s.source}${s.art ? '（深度文章）' : ''} | 〔${THICK[s.k]}〕${s.score != null && !s.art ? ` | ${Math.round(s.score * 10) / 10}分` : ''} | ${s.title}`;
    return s.k === 'h' ? head : `${head}\n    ${s.body.slice(0, 1800)}`;
  });
  const b = pasted.map((p, k) => `[P${k + 1}] 主编贴进来的全文 | 〔正文〕 | ${p.label || '未注明出处'}\n    ${p.text}`);
  return a.concat(b).join('\n');
}

/** 整理模型输出：去掉不存在的来源编号；返回 { title, body, uncited } 或 null */
export function tidyDossier(text, nS, nP) {
  let body = String(text || '').trim();
  const at = body.indexOf('## ');
  if (at < 0) return null;
  body = body.slice(at).replace(/\[([SP])(\d+)\]/g, (m, t, d) => (+d >= 1 && +d <= (t === 'S' ? nS : nP) ? `[${t}${+d}]` : ''));
  const secs = body.split(/\n(?=##\s)/);
  if (secs.length < 4) return null;
  const m = body.match(/##\s*一句话\s*\n+([^\n]+)/);
  const title = m ? m[1].replace(/\[[SP]\d+\]/g, '').replace(/^[-*\s]+/, '').trim() : '';
  // 应当标来源却没标的行数（“为什么重要”里的推断、最后两部分不算）
  let uncited = 0;
  for (const s of secs) {
    const h = (s.match(/^##\s*(.+)/) || [])[1] || '';
    if (/还不知道什么|可以怎么写|一句话/.test(h)) continue;
    for (const l of s.split('\n').slice(1)) {
      const t = l.replace(/^[-*\s]+/, '').trim();
      if (t && !/\[[SP]\d+\]/.test(t) && !/^推断[:：]/.test(t) && !/^材料里没有/.test(t)) uncited++;
    }
  }
  return { title, body, uncited };
}

async function topicItems(env, t, c, now) {
  const cols = 'id, source, title, body, url, ts, score, confirms, tickers, topic, story, dup_of, who';
  const byId = new Map();
  const add = (rows) => rows.forEach((r) => byId.has(r.id) || byId.set(r.id, r));
  const ids = (t.ids || []).slice(0, 40);
  if (ids.length) add((await env.DB.prepare(`SELECT ${cols} FROM items WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results);
  // 同一事件下、选题会之后新来的报道也带上
  const stories = (t.stories || []).slice(0, 8);
  if (stories.length) {
    add(
      (
        await env.DB.prepare(`SELECT ${cols} FROM items WHERE ts > ? AND dup_of IS NULL AND score >= 5 AND story IN (${stories.map(() => '?').join(',')}) ORDER BY ts DESC LIMIT 120`)
          .bind(now - c.dossierH * H, ...stories)
          .all()
      ).results
    );
  }
  // 被判为重复的别家报道有时正文更全：有成段正文的也拿来用
  const main = [...byId.keys()].slice(0, 80);
  if (main.length) {
    const dups = (await env.DB.prepare(`SELECT ${cols} FROM items WHERE dup_of IN (${main.map(() => '?').join(',')}) LIMIT 200`).bind(...main).all()).results;
    add(dups.filter((d) => thickness(d) !== 'h'));
  }
  return [...byId.values()];
}

async function topicArticles(env, ids) {
  if (!ids.length) return [];
  try {
    const part = ids.slice(0, 80);
    const r = await env.DB.prepare(`SELECT DISTINCT i.id, i.source, i.title, i.body, i.url, i.ts FROM related r JOIN items i ON i.id = r.article_id WHERE r.flash_id IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    return r.results.sort((a, b) => a.ts - b.ts);
  } catch {
    return [];
  }
}

/**
 * 生成（或重写）一个选题的档案。paste = { label, text }：用户贴进来的一段全文（可选）。
 * 返回 { ok, cached? } 或 { ok: false, error }
 */
export async function writeDossier(env, { run, rank, paste = null, now = Date.now() }) {
  const c = deskConfig(env);
  if (!c.on) return { ok: false, error: 'off' };
  await ensureTables(env);
  const r = (await env.DB.prepare('SELECT id, topics FROM desk_runs WHERE id = ?').bind(Number(run) || 0).all()).results?.[0];
  const t = r && safeJson(r.topics, []).find((x) => x.rank === Number(rank));
  if (!t) return { ok: false, error: 'no_topic' };
  const old = (await env.DB.prepare('SELECT * FROM desk_dossiers WHERE run_id = ? AND rank = ?').bind(r.id, t.rank).all()).results?.[0] || null;
  const pasted = safeJson(old?.pasted, []);
  const text = paste ? clean(String(paste.text || '').slice(0, c.pasteMax * 2)).slice(0, c.pasteMax) : '';
  if (text.length >= 200) {
    pasted.push({ label: clean(paste.label).slice(0, 80), text, ts: now });
    while (pasted.length > 3) pasted.shift();
  } else if (paste) return { ok: false, error: 'paste_short' };
  else if (old && now - old.updated < c.dossierMin * 60_000) return { ok: true, cached: true };
  if (!claudeUp(env)) return { ok: false, error: 'claude_down' };
  const spent = await spentToday(env, now);
  if (spent >= c.dailyUsd) return { ok: false, error: 'budget', spent };
  const items = await topicItems(env, t, c, now);
  if (!items.length && !pasted.length) return { ok: false, error: 'no_items' };
  const arts = await topicArticles(env, items.filter((i) => !i.dup_of).map((i) => i.id));
  const have = new Set(items.map((i) => i.id));
  const srcs = dossierSources(items, arts.filter((a) => !have.has(a.id)), c.maxSrc);
  const user = `选题：${t.title_zh}（${t.title_en}）\n选题会给的理由：${t.why_zh}\n现在是北京时间 ${bjTime(now)}。以下是这个选题的 ${srcs.length + pasted.length} 条材料：\n\n${dossierText(srcs, pasted)}`;
  const res = await claudeText(env, { system: DOSSIER_SYSTEM, user, maxTokens: 14000, kind: 'dossier', effort: 'medium', model: c.model, timeout: 170_000 });
  if (!res) return { ok: false, error: 'model', detail: claudeState().last_error };
  const out = tidyDossier(res.text, srcs.length, pasted.length);
  if (!out) return { ok: false, error: 'parse' };
  const usd = claudeUsd(res.usage.input, res.usage.output);
  const map = srcs.map((s) => ({ n: s.n, id: s.id, src: s.source, ts: s.ts, url: s.url, t: s.title.slice(0, 140), k: s.k, art: s.art || undefined }));
  await env.DB.prepare(
    `INSERT INTO desk_dossiers (run_id, rank, title, body, srcs, pasted, created, updated, writes, usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(run_id, rank) DO UPDATE SET title = excluded.title, body = excluded.body, srcs = excluded.srcs, pasted = excluded.pasted, updated = excluded.updated, writes = writes + 1, usd = COALESCE(usd, 0) + excluded.usd`
  )
    .bind(r.id, t.rank, out.title, out.body, JSON.stringify(map), JSON.stringify(pasted), now, now, usd)
    .run();
  return { ok: true, usd, uncited: out.uncited, n: srcs.length };
}

/**
 * 一个选题的全部资料，整理成一份 Markdown：给用户一键复制，拿去别处（别的对话、别的模型）接着写。
 * 含选题会的理由、关键事实、观点线索、按时间排的全部报道（标题、摘要、链接）、已生成的档案、用户贴进来的全文。
 */
export async function deskPack(env, { run, rank, now = Date.now() }) {
  const c = deskConfig(env);
  await ensureTables(env);
  const r = (await env.DB.prepare('SELECT id, ts, topics FROM desk_runs WHERE id = ?').bind(Number(run) || 0).all()).results?.[0];
  const t = r && safeJson(r.topics, []).find((x) => x.rank === Number(rank));
  if (!t) return { ok: false, error: 'no_topic' };
  const items = (await topicItems(env, t, c, now)).sort((a, b) => a.ts - b.ts);
  const arts = await topicArticles(env, items.filter((i) => !i.dup_of).map((i) => i.id));
  const have = new Set(items.map((i) => i.id));
  const d = (await env.DB.prepare('SELECT body, pasted, updated FROM desk_dossiers WHERE run_id = ? AND rank = ?').bind(r.id, t.rank).all()).results?.[0];
  const L = [`# ${t.title_zh}`, `${t.title_en}`, '', `选题会时间：北京时间 ${bjTime(r.ts)}`, '', '## 为什么值得写', t.why_zh, '', t.why_en, '', `Working headline: ${t.angle_en}`];
  if (t.tickers?.length) L.push('', `相关股票：${t.tickers.join(', ')}`);
  if (t.facts?.length) L.push('', '## 关键事实', ...t.facts.map((f) => `- ${f.t}（${f.src}）`));
  if (t.views?.length) L.push('', '## 观点线索', ...t.views.map((v) => `- ${v.who ? String(v.who).split('|')[0] + '：' : ''}${v.t}${v.url ? ' ' + v.url : ''}`));
  L.push('', `## 全部报道（${items.length + arts.filter((a) => !have.has(a.id)).length} 条，按时间）`);
  for (const i of items.concat(arts.filter((a) => !have.has(a.id)))) {
    const b = bodyOf(i);
    L.push(`- ${bjTime(i.ts)} | ${i.source}${i.who ? ' | ' + String(i.who).split('|')[0] : ''} | ${clean(i.title)}${i.url ? '\n  ' + i.url : ''}${b.length >= 40 ? '\n  ' + b.slice(0, 1800) : ''}`);
  }
  if (d?.body) L.push('', `## 专题档案（AI 整理，北京时间 ${bjTime(d.updated)}；方括号里的 S 编号对应生成档案时的材料顺序）`, d.body);
  for (const p of safeJson(d?.pasted, [])) L.push('', `## 贴入的全文：${p.label || '未注明出处'}`, p.text);
  return { ok: true, text: L.join('\n'), n: items.length };
}
