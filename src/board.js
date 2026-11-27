// 事件榜：整站以“事件”为中心。
// - 首页是一张事件榜：最近两天的每件事一行，按分量连续排序，标出在升温还是降温、为什么排在这里；
// - 每件事有一个状态（新进来 / 我在关注 / 决定写 / 稿子已生成 / 已发布 / 不写），用户的每次选择都记下来，以后用来校准排序；
// - 点开是事件页：速览（自动的 AI 简报）、深读（点了才生成，读全文）、各方观点、时间线、稿件，全在一页里；
// - “帮我挑今天写什么”仍然是那场选题会，但结果落到事件上：一个选题对应一件事，跨了几件事的合成一行（“包含 3 件事”）。
// 深读和稿件沿用选题台的档案和英文稿两张表：run_id = 0，rank = 事件编号。

import { metaGet } from './dbguard.js';
import { storyAlias, resolveAlias } from './events.js';
import { originOf, countedAs } from './origin.js';
import { deskConfig, deskCost, nextSlot, realWho, matchWritten } from './desk.js';

const H = 3_600_000;
export const STATES = ['new', 'follow', 'write', 'drafted', 'published', 'skip'];

export const EV_TABLES = [
  "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'e', members TEXT, title TEXT, title_en TEXT, state TEXT NOT NULL DEFAULT 'new', state_ts INTEGER, note TEXT, seen INTEGER, created INTEGER, topic TEXT, gone INTEGER NOT NULL DEFAULT 0)",
  // 用户的每次选择（改状态、把消息移出事件）和当时这件事在榜上的样子：校准排序用
  'CREATE TABLE IF NOT EXISTS ev_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, ev INTEGER NOT NULL, name TEXT, act TEXT NOT NULL, note TEXT, snap TEXT)',
];

let evOk = false;
export async function ensureEv(env) {
  if (evOk) return;
  for (const s of EV_TABLES) await env.DB.prepare(s).run();
  evOk = true;
}
export function _resetEv() {
  evOk = false;
}

const safeJson = (s, d) => {
  try {
    return s ? JSON.parse(s) : d;
  } catch {
    return d;
  }
};
const clean = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const r1 = (x) => Math.round(x * 10) / 10;

/* ---------- 升温 / 降温 ---------- */

/** 泊松分布：平均 lam 次的事，出现 k 次或更多的概率 */
export function poissonTail(k, lam) {
  if (k <= 0) return 1;
  let term = Math.exp(-lam);
  let sum = term;
  for (let i = 1; i < k; i++) {
    term *= lam / i;
    sum += term;
  }
  return Math.max(0, 1 - sum);
}

const between = (ts, a, b) => {
  let n = 0;
  for (const t of ts) if (t > a && t <= b) n++;
  return n;
};

/**
 * 一件事现在是在升温、降温、刚出现，还是平稳。全部由数据算出来，不让模型判断。
 * e = { ts: [每条消息的时间], outs: [{ o, first }] 每家媒体第一次报的时间（转述的记在最初那家）, sc: [{ ts, s }] 每条的突发分, whos: [{ w, first }] 每个表态方第一次出现的时间 }
 * gts = 这段时间全部事件的消息时间（用来修正“现在是不是本来就消息多 / 少的时段”，也就是开盘还是半夜）
 * 看四样：
 *   1) 意外程度：最近 2 小时来的条数，和这件事自己之前的节奏比（按当前时段全站的消息量修正），多到“碰巧”的可能不足 5% 才算；
 *   2) 新加入的独立媒体：最近 3 小时第一次报这件事的媒体有几家；
 *   3) 新进展：最近 3 小时出现了比之前更高分的消息，或者新的表态方；
 *   4) 价格确认由调用方另外加（相关股票今天的波动是它平时的 2 倍以上）。
 * 返回 { st, k2, exp, p, newOut: [媒体名], dev: 'score' | 'actor' | '', quiet: 多少小时没有新消息 }
 */
export function heatOf(e, gts, now) {
  const ts = e.ts;
  const first = Math.min(...ts);
  const last = Math.max(...ts);
  const age = (now - first) / H;
  const quiet = (now - last) / H;
  const k2 = between(ts, now - 2 * H, now);
  const out = { st: 'flat', k2, exp: 0, p: 1, newOut: [], dev: '', quiet: r1(quiet) };
  if (age < 3) {
    out.st = 'new';
    return out;
  }
  // 这件事自己的节奏：2 小时之前、最多往前 24 小时
  const b0 = Math.max(first, now - 26 * H);
  const span = Math.max(2, (now - 2 * H - b0) / H);
  const rate2 = (between(ts, b0 - 1, now - 2 * H) / span) * 2;
  // 时段修正：全站最近 2 小时的消息量，和同一段基准时间里平均每 2 小时的量比
  const g2 = between(gts, now - 2 * H, now);
  const gBase = (between(gts, b0 - 1, now - 2 * H) / span) * 2;
  const f = gBase > 0 ? Math.min(3, Math.max(0.3, g2 / gBase)) : 1;
  const lam = Math.max(0.3, rate2 * f);
  out.exp = r1(lam);
  out.p = poissonTail(k2, lam);
  out.newOut = e.outs.filter((x) => x.first > now - 3 * H && x.first > first + 30 * 60_000).map((x) => x.o);
  const before = Math.max(0, ...e.sc.filter((x) => x.ts <= now - 3 * H).map((x) => x.s));
  const recent = Math.max(0, ...e.sc.filter((x) => x.ts > now - 3 * H).map((x) => x.s));
  if (before > 0 && recent >= before + 0.5) out.dev = 'score';
  else if ((e.whos || []).some((x) => x.first > now - 3 * H && x.first > first + 30 * 60_000)) out.dev = 'actor';
  const surprise = k2 >= 3 && out.p < 0.05;
  // 回测（2026-11-26，33 小时真实数据，611 个判断点）：单凭“新媒体加入”或“更高分的消息”一条就判升温，一半以上是虚报；
  // 要求最近 2 小时同时至少来了 2 条，说“升温”的准确率 53%、找到 25%（简单算法是 48% 和 15%），降温 86% 对 66%
  if (surprise || (out.newOut.length >= 2 && k2 >= 2) || (out.dev && k2 >= 2)) out.st = 'up';
  else {
    // 降温：按它自己的节奏最近 6 小时本该有 3 条以上，实际不到四分之一；或者干脆 12 小时没动静
    const g6 = between(gts, now - 6 * H, now);
    const gBase6 = (between(gts, b0 - 1, now - 2 * H) / span) * 6;
    const f6 = gBase6 > 0 ? Math.min(3, Math.max(0.3, g6 / gBase6)) : 1;
    const exp6 = (rate2 / 2) * 6 * f6;
    const k6 = between(ts, now - 6 * H, now);
    if (quiet >= 12 || (exp6 >= 3 && k6 <= exp6 * 0.25)) out.st = 'down';
  }
  return out;
}

/** 对照用的简单算法：最近 2 小时的条数和之前 12 小时的平均比（回测时和上面那个比谁准） */
export function simpleHeat(ts, now) {
  const first = Math.min(...ts);
  if ((now - first) / H < 3) return 'new';
  const k2 = between(ts, now - 2 * H, now);
  const avg = between(ts, now - 14 * H, now - 2 * H) / 6;
  if (k2 >= 3 && k2 >= avg * 2) return 'up';
  if (k2 === 0 && between(ts, now - 14 * H, now - 2 * H) >= 3) return 'down';
  return 'flat';
}

/* ---------- 一件事的卡片 ---------- */

const SASRC = /^(Argaam|Arab News|Arabian Business|Saudi Gazette|Asharq)/i;
const SAW = /saudi|aramco|tadawul|riyadh|sabic|\bpif\b|opec|crude|\boil\b|brent|\bgulf\b|middle east|\biran|hormuz|qatar|\buae\b|沙特|阿美|利雅得|欧佩克|原油|油价|中东|海湾|伊朗|霍尔木兹|\p{Script=Arabic}/iu;
const USW = /\bU\.?S\.?\b|\bFed\b|Wall Street|Nasdaq|S&P|Dow\b|Treasur|Trump|White House|dollar|美股|美国|美联储|美元|华尔街|纳指|标普|道指/;

export function marketOf(items) {
  let sa = 0;
  let us = 0;
  for (const i of items) {
    const tk = i.tickers || '';
    const t = `${i.title} ${i.topic || ''}`;
    if (SASRC.test(i.source) || /(^|,)\d{4}(,|$)/.test(tk) || SAW.test(t)) sa++;
    if (/[A-Z]/.test(tk) || USW.test(t)) us++;
  }
  const need = Math.max(1, items.length * 0.3);
  return sa >= need && us >= need ? 'Both' : sa >= need ? 'Saudi' : 'US';
}

const lite = (i) => ({ id: i.id, title: clean(i.title).slice(0, 200), title_tr: i.title_tr || undefined, tr_lang: i.tr_lang || undefined, ts: i.ts, source: i.source, score: i.score, url: i.url || undefined });

/**
 * 把一件事的消息算成一张卡片（不含状态和排序）。items 是这件事 48 小时内的消息。
 */
export function eventCard(name, items, gts, now) {
  const its = items.slice().sort((a, b) => b.ts - a.ts);
  const outs = new Map();
  const whos = new Map();
  const origins = new Set();
  for (const i of its) {
    const o = countedAs(i);
    if (!outs.has(o) || i.ts < outs.get(o)) outs.set(o, i.ts);
    const og = originOf(i);
    if (og) origins.add(og);
    const w = i.kind === 'v' ? realWho(i.who, i.source) : '';
    if (w && (!whos.has(w) || i.ts < whos.get(w))) whos.set(w, i.ts);
  }
  const top = its.reduce((a, b) => ((b.score || 0) > (a.score || 0) ? b : a), its[0]);
  // 分量看“现在还剩多少”：一条消息过了 12 小时开始打折，每小时少 0.1 分，最多少 3 分。几天前的大新闻不会一直占着第一
  const fade = (i) => (i.score || 0) - Math.min(3, Math.max(0, (now - i.ts) / H - 12) * 0.1);
  const eff = Math.max(...its.map(fade));
  const heat = heatOf({ ts: its.map((i) => i.ts), outs: [...outs].map(([o, first]) => ({ o, first })), sc: its.map((i) => ({ ts: i.ts, s: i.score || 0 })), whos: [...whos].map(([w, first]) => ({ w, first })) }, gts, now);
  const tkc = new Map();
  for (const i of its) for (const t of String(i.tickers || '').split(',')) if (t.trim()) tkc.set(t.trim().toUpperCase(), (tkc.get(t.trim().toUpperCase()) || 0) + 1);
  const tpc = new Map();
  for (const i of its) {
    const t = String(i.topic || '').split('|')[0].trim();
    if (t) tpc.set(t, (tpc.get(t) || 0) + 1);
  }
  const vs = its.filter((i) => i.kind === 'v' && realWho(i.who, i.source)).sort((a, b) => (b.pick || 0) - (a.pick || 0));
  const bulls = vs.filter((i) => i.dir > 0).length;
  const bears = vs.filter((i) => i.dir < 0).length;
  const hooks = its.filter((i) => (i.hook || 0) >= 2).sort((a, b) => (b.hook || 0) - (a.hook || 0));
  const confirms = Math.max(0, ...its.map((i) => i.confirms || 0));
  return {
    name,
    n: its.length,
    outlets: Math.max(outs.size, Math.min(12, 1 + confirms)),
    outs: [...outs].sort((a, b) => a[1] - b[1]).map((x) => x[0]).slice(0, 8),
    relay: [...origins].slice(0, 4),
    top: r1(top.score || 0),
    eff: r1(eff),
    topAge: Math.round((now - top.ts) / H),
    pk: r1(Math.max(0, ...its.map((i) => i.pick || 0))) || undefined,
    first: Math.min(...its.map((i) => i.ts)),
    last: its[0].ts,
    st: heat.st,
    heat: { k2: heat.k2, exp: heat.exp, newOut: heat.newOut.slice(0, 3), dev: heat.dev || undefined, quiet: heat.quiet },
    market: marketOf(its),
    tickers: [...tkc].sort((a, b) => b[1] - a[1]).filter((x) => its.length < 4 || (x[1] >= 2 && x[1] >= its.length * 0.1)).map((x) => x[0]).filter((t) => /^([A-Z]{1,5}|\d{4})$/.test(t)).slice(0, 4),
    tag: [...tpc].sort((a, b) => b[1] - a[1])[0]?.[0] || '',
    lead: lite(top),
    latest: its.slice(0, 3).map(lite),
    views: vs.slice(0, 6).map((i) => ({ who: realWho(i.who, i.source), t: clean(i.title).slice(0, 120), dir: i.dir || 0, id: i.id, url: i.url || undefined })),
    split: bulls && bears ? [bulls, bears] : undefined,
    hook: hooks.length ? { n: hooks[0].hook, t: clean(hooks[0].title).slice(0, 140), tr: hooks[0].tr_lang === 'zh' ? clean(hooks[0].title_tr).slice(0, 140) : '', id: hooks[0].id } : undefined,
    tsl: its.map((i) => i.ts),
    ids: its.map((i) => i.id),
  };
}

/**
 * 分量：一个连续的分数，榜就按它排。同时给出“为什么排在这里”的几条理由（按贡献大小），页面用大白话写出来。
 * 报道条数只占很小的分量：媒体互相转载，条数多不等于市场更在意。
 */
export function weigh(c, now) {
  const parts = [['top', c.top, c.top]];
  let w = c.top;
  const add = (code, v, arg) => {
    if (!v) return;
    w += v;
    parts.push([code, v, arg]);
  };
  if (c.eff != null && c.eff < c.top - 0.25) add('old', c.eff - c.top, c.topAge);
  add('out', c.outlets >= 2 ? Math.min(2, Math.log2(1 + c.outlets) * 0.6) : 0, c.outlets);
  add('vol', Math.min(0.8, Math.log2(Math.max(1, c.n)) / 6));
  if (c.pk >= 7) add('pick', Math.min(1.2, (c.pk - 6) * 0.4), c.pk);
  if (c.st === 'up') add('up', 1);
  else if (c.st === 'new') add('new', 0.5);
  else if (c.st === 'down') add('down', -1);
  if (c.split) add('split', 0.5);
  if (c.px) add('px', 0.7, c.px);
  if (c.hook) add('hook', Math.min(0.6, c.hook.n * 0.2));
  if (c.rec) add('rec', 1.5);
  const quiet = (now - c.last) / H;
  if (quiet > 2) add('quiet', -Math.min(3, (quiet - 2) * 0.2), Math.round(quiet));
  if (c.wr) add('wr', c.wr.same ? (c.wr.fresh >= 3 ? -1.5 : -3) : c.wr.fresh ? -0.5 : -1.5, c.wr.fresh || 0);
  const why = parts
    .filter((p) => p[0] !== 'vol' && Math.abs(p[1]) >= 0.3)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 4)
    .map((p) => [p[0], p[2] ?? null]);
  return { w: Math.round(w * 100) / 100, why };
}

/* ---------- 榜 ---------- */

const ITEM_COLS = 'id, source, title, substr(body, 1, 160) AS b, length(body) AS bl, url, ts, score, confirms, dir, tickers, topic, story, pick, kind, who, hook, title_tr, tr_lang';

async function recentItems(env, c, now, hours = 48) {
  const rows = (await env.DB.prepare(`SELECT ${ITEM_COLS} FROM items WHERE ts > ? AND dup_of IS NULL AND score >= 5 ORDER BY ts DESC LIMIT 1500`).bind(now - hours * H).all()).results;
  try {
    // 突发分不高、但选题分高的观点和深度分析也算进事件（走部分索引 idx_items_pick）
    const have = new Set(rows.map((r) => r.id));
    const picked = (await env.DB.prepare(`SELECT ${ITEM_COLS} FROM items WHERE ts > ? AND pick >= ${Number(c.minPick) || 6} AND dup_of IS NULL ORDER BY ts DESC LIMIT 300`).bind(now - hours * H).all()).results;
    for (const p of picked) if (!have.has(p.id) && p.story) rows.push(p);
  } catch {}
  return rows;
}

async function eventRows(env, now) {
  return (await env.DB.prepare("SELECT * FROM events WHERE gone = 0 AND (created > ? OR state IN ('follow', 'write', 'drafted')) ORDER BY id DESC LIMIT 500").bind(now - 6 * 24 * H).all()).results;
}

/** 把消息按事件归拢：{ name → { items, parts: { 成员事件名 → 条数 } } }。合并事件的成员都归到那一行下面 */
export function groupItems(rows, alias, evRows) {
  const claim = new Map();
  for (const r of evRows) if (r.kind === 'g') for (const m of safeJson(r.members, [])) claim.set(resolveAlias(m, alias), r.name);
  const by = new Map();
  for (const r of rows) {
    const story = r.story ? resolveAlias(r.story, alias) : (r.score || 0) >= 8 ? 'i:' + r.id : '';
    if (!story) continue;
    const name = claim.get(story) || story;
    let e = by.get(name);
    if (!e) by.set(name, (e = { items: [], parts: new Map() }));
    e.items.push(r);
    const p = e.parts.get(story) || { n: 0, last: 0, top: null };
    p.n++;
    p.last = Math.max(p.last, r.ts);
    if (!p.top || (r.score || 0) > (p.top.score || 0)) p.top = r;
    e.parts.set(story, p);
  }
  return by;
}

/**
 * 网页用：事件榜。形状和以前的选题台一致（run.topics、dossiers、drafts、pasted），
 * 只是 run.id 固定为 0、topic.rank 是事件编号，这样深读和稿件那部分页面代码可以原样用。
 */
export async function boardState(env, { now = Date.now() } = {}) {
  const c = deskConfig(env);
  const out = { now, on: c.on, board: 1, run: { id: 0, ts: now, topics: [] }, meeting: null, picks: {}, dossiers: {}, pasted: {}, drafts: {}, written: [], follow: {}, mood: null, sources: [], next: c.auto ? nextSlot(now, c.closeSlot) : null, manual_min: c.manualMin };
  if (!c.on) return out;
  await ensureEv(env);
  const [rows, alias, meta] = await Promise.all([recentItems(env, c, now), storyAlias(env, now).catch(() => ({})), metaGet(env, 'story_alias')]);
  const titles = meta?.v?.titles || {};
  let evRows = await eventRows(env, now);
  const by = groupItems(rows, alias, evRows);
  const gts = rows.map((r) => r.ts);
  let meeting = null;
  try {
    meeting = (await env.DB.prepare('SELECT id, ts, slot, n, mood FROM desk_runs ORDER BY id DESC LIMIT 1').all()).results?.[0] || null;
  } catch {}
  if (meeting) {
    out.meeting = { id: meeting.id, ts: meeting.ts, slot: meeting.slot, n: meeting.n };
    out.mood = safeJson(meeting.mood, null);
  }
  let wr = [];
  try {
    wr = (await env.DB.prepare('SELECT id, ts, title, run_id, rank, ids, stories, off, note FROM desk_written WHERE gone = 0 AND ts > ? ORDER BY id DESC LIMIT 40').bind(now - 21 * 24 * H).all()).results;
    out.written = wr.map((w) => ({ id: w.id, ts: w.ts, title: w.title, run: w.run_id, rank: w.rank, off: !!w.off, note: w.note || undefined }));
  } catch {}
  // 参考行情只读缓存，不为了排榜去请求
  let quotes = null;
  try {
    const q = (await metaGet(env, 'desk_quotes'))?.v;
    if (q && now - q.at < 45 * 60_000) quotes = new Map(q.data.map((x) => [x.t, x]));
  } catch {}

  const rowBy = new Map(evRows.map((r) => [r.name, r]));
  const cards = [];
  const mk = (name, e) => {
    const row = rowBy.get(name);
    const snap = safeJson(row?.topic, null);
    const card = e ? eventCard(name, e.items, gts, now) : { name, n: 0, outlets: 0, outs: [], relay: [], top: 0, first: row.created || now, last: row.state_ts || row.created || now, st: 'down', heat: { k2: 0, exp: 0, newOut: [], quiet: 48 }, market: snap?.market || 'US', tickers: snap?.tickers || [], tag: '', latest: [], views: [], tsl: [], ids: [] };
    const stories = row?.kind === 'g' ? safeJson(row.members, []).map((m) => resolveAlias(m, alias)) : name.startsWith('i:') ? [] : [name];
    card.stories = [...new Set(stories)];
    if (row?.kind === 'g') {
      card.kind = 'g';
      card.parts = card.stories.map((s) => {
        const p = e?.parts.get(s);
        return { name: s, title: titles[s]?.zh || s, title_en: titles[s]?.en || undefined, n: p?.n || 0, last: p?.last || 0 };
      });
    }
    if (name.startsWith('i:') && e) card.ids = [e.items[0].id];
    card.rec = snap && meeting && snap.run === meeting.id ? (snap.write ? 2 : 1) : undefined;
    const wm = matchWritten({ rank: row?.id || -1, ids: card.ids, stories: card.stories, tsl: card.tsl }, 0, wr);
    if (wm) card.wr = wm;
    if (quotes) {
      // 价格确认：相关股票今天的涨跌幅是它自己平时（约 20 个交易日涨跌幅绝对值的中位数）的 3 倍以上。
      // 正态分布下中位数约等于 0.67 个标准差，3 倍约等于业界常说的“2 个标准差”，大约每 20 个交易日出现一次
      let best = null;
      for (const t of card.tickers) {
        const q = quotes.get(t);
        if (q && q.typ > 0 && Math.abs(q.chg) >= q.typ * 3 && (!best || Math.abs(q.chg) / q.typ > best.x)) best = { t, chg: q.chg, x: r1(Math.abs(q.chg) / q.typ) };
      }
      if (best) card.px = best; // 只当作一个信号和加分项，不单凭它把一件没有新消息的事标成“在升温”
    }
    const { w, why } = weigh(card, now);
    Object.assign(card, {
      w,
      why,
      title_zh: row?.title || snap?.title_zh || titles[name]?.zh || (name.startsWith('i:') ? clean(card.lead?.title).slice(0, 40) : name),
      title_en: row?.title_en || snap?.title_en || titles[name]?.en || '',
      why_zh: snap?.why_zh || '',
      why_en: snap?.why_en || '',
      angle_en: snap?.angle_en || '',
      facts: snap?.facts || [],
      hooks: snap?.hooks || [],
      state: row?.state || 'new',
      state_ts: row?.state_ts || undefined,
      note: row?.note || undefined,
      seen: row?.seen || undefined,
      days: row?.created && now - row.created >= 36 * H ? Math.floor((now - row.created) / (24 * H)) + 1 : undefined,
      fresh: row?.seen ? card.tsl.filter((t) => t > row.seen).length : undefined,
    });
    if (snap?.market && card.n === 0) card.market = snap.market;
    if (snap?.tickers?.length) card.tickers = [...new Set(snap.tickers.concat(card.tickers))].slice(0, 4);
    delete card.tsl;
    cards.push(card);
  };
  for (const [name, e] of by) mk(name, e);
  // 用户正在跟的事，哪怕这两天没有新消息也留在榜上
  for (const r of evRows) if (!by.has(r.name) && ['follow', 'write', 'drafted'].includes(r.state)) mk(r.name, null);
  cards.sort((a, b) => b.w - a.w || b.last - a.last);
  const keep = cards.filter((x, k) => k < 40 || x.state !== 'new').slice(0, 70);

  // 榜上的事件都要有编号（深读、稿件、状态都挂在编号上）：没有的现在建
  const missing = keep.filter((x) => !rowBy.has(x.name));
  if (missing.length) {
    for (let i = 0; i < missing.length; i += 40) {
      const part = missing.slice(i, i + 40);
      await env.DB.batch(part.map((x) => env.DB.prepare("INSERT OR IGNORE INTO events (name, kind, state, created) VALUES (?, 'e', 'new', ?)").bind(x.name, now)));
    }
    evRows = await eventRows(env, now);
    for (const r of evRows) rowBy.set(r.name, r);
  }
  keep.forEach((x, k) => {
    x.rank = rowBy.get(x.name)?.id || 0;
    x.pos = k + 1;
  });
  out.run.topics = keep.filter((x) => x.rank);
  out.total = by.size;

  const ids = out.run.topics.map((x) => x.rank);
  try {
    for (let i = 0; i < ids.length; i += 80) {
      const part = ids.slice(i, i + 80);
      const q = part.map(() => '?').join(',');
      const ds = (await env.DB.prepare(`SELECT rank, title, body, srcs, pasted, updated, writes FROM desk_dossiers WHERE run_id = 0 AND rank IN (${q})`).bind(...part).all()).results;
      for (const d of ds) {
        const pasted = safeJson(d.pasted, []).map((p) => ({ label: p.label, len: p.text.length }));
        if (pasted.length) out.pasted[d.rank] = pasted;
        if (d.body) out.dossiers[d.rank] = { title: d.title, body: d.body, srcs: safeJson(d.srcs, []), updated: d.updated, writes: d.writes, pasted };
      }
      const dr = (await env.DB.prepare(`SELECT rank, format, heads, summary, body, cards, checks, updated, writes FROM desk_drafts WHERE run_id = 0 AND rank IN (${q})`).bind(...part).all()).results;
      for (const d of dr) out.drafts[d.rank] = { format: d.format, heads: safeJson(d.heads, []), summary: d.summary, body: d.body, cards: safeJson(d.cards, []), checks: safeJson(d.checks, []), updated: d.updated, writes: d.writes };
    }
  } catch {}
  try {
    out.cost = await deskCost(env, c, now);
  } catch {}
  try {
    out.fulltext = (await metaGet(env, 'fulltext_health'))?.v || null;
  } catch {}
  try {
    out.sources = (await env.DB.prepare('SELECT id, ts, name, note FROM desk_sources WHERE gone = 0 ORDER BY id DESC LIMIT 30').all()).results;
  } catch {}
  try {
    out.calib = await evCalib(env, now);
  } catch {}
  return out;
}

/** 给没带管理密码的访客看的版本：榜本身可以看；状态、理由、深读、稿件、已写记录、行情、花费都不给 */
export function boardPublic(st) {
  if (!st) return st;
  const topics = (st.run?.topics || []).map(({ wr, note, seen, fresh, px, state, state_ts, why, ...t }) => ({ ...t, state: 'new', why: (why || []).filter((x) => x[0] !== 'px' && x[0] !== 'wr') }));
  return { ...st, run: { ...st.run, topics }, dossiers: {}, drafts: {}, pasted: {}, written: [], sources: [], cost: undefined, fulltext: undefined, calib: undefined, guest: true };
}

/* ---------- 事件页 ---------- */

async function rowOf(env, id) {
  await ensureEv(env);
  return (await env.DB.prepare('SELECT * FROM events WHERE id = ? AND gone = 0').bind(Number(id) || 0).all()).results?.[0] || null;
}

async function storiesOf(env, row, now) {
  const alias = await storyAlias(env, now).catch(() => ({}));
  if (row.kind === 'g') return [...new Set(safeJson(row.members, []).map((m) => resolveAlias(m, alias)))];
  if (row.name.startsWith('i:')) return [];
  return [resolveAlias(row.name, alias)];
}

/** 一件事的全部消息（最近 4 天，最多 160 条，最新的在前），每条标明材料厚度、是不是转述、全文读到没有 */
export async function eventDetail(env, { id, now = Date.now(), admin = false, ftSources = null }) {
  const row = await rowOf(env, id);
  if (!row) return { ok: false, error: 'no_event' };
  const stories = await storiesOf(env, row, now);
  const cols = 'id, source, title, substr(body, 1, 400) AS b, length(body) AS bl, url, ts, score, dir, story, kind, who, hook, title_tr, tr_lang';
  let items = [];
  if (stories.length) {
    items = (await env.DB.prepare(`SELECT ${cols} FROM items WHERE ts > ? AND dup_of IS NULL AND score >= 5 AND story IN (${stories.map(() => '?').join(',')}) ORDER BY ts DESC LIMIT 160`).bind(now - 96 * H, ...stories).all()).results;
    try {
      const have = new Set(items.map((i) => i.id));
      const more = (await env.DB.prepare(`SELECT ${cols} FROM items WHERE ts > ? AND pick >= 6 AND dup_of IS NULL AND story IN (${stories.map(() => '?').join(',')}) ORDER BY ts DESC LIMIT 60`).bind(now - 96 * H, ...stories).all()).results;
      for (const m of more) if (!have.has(m.id)) items.push(m);
      items.sort((a, b) => b.ts - a.ts);
    } catch {}
  } else {
    items = (await env.DB.prepare(`SELECT ${cols} FROM items WHERE id = ?`).bind(row.name.slice(2)).all()).results;
  }
  let ft = new Map();
  if (admin && items.length) {
    try {
      const part = items.slice(0, 90).map((i) => i.id);
      ft = new Map((await env.DB.prepare(`SELECT id, ok FROM fulltext WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).all()).results.map((r) => [r.id, r.ok]));
    } catch {}
  }
  const list = items.map((i) => {
    const body = clean(i.b);
    const o = {
      id: i.id,
      source: i.source,
      title: clean(i.title).slice(0, 260),
      title_tr: i.title_tr || undefined,
      tr_lang: i.tr_lang || undefined,
      sum: body.length >= 60 && !body.startsWith(clean(i.title).slice(0, 30)) ? body.slice(0, 220) : undefined,
      url: i.url || undefined,
      ts: i.ts,
      score: i.score,
      dir: i.dir || 0,
      story: stories.length > 1 ? i.story : undefined,
      kind: i.kind || undefined,
      who: i.kind === 'v' ? realWho(i.who, i.source) || undefined : undefined,
      k: (i.bl || 0) >= 400 ? 'f' : (i.bl || 0) >= 60 ? 's' : 'h',
      from: originOf(i) || undefined,
    };
    // 全文：读到了 / 读过但没读到 / 这家能读（点深读时会去读）/ 这家读不到
    if (admin) o.ft = ft.get(i.id) === 1 ? 'ok' : ft.has(i.id) ? 'fail' : o.k === 'f' ? 'ok' : ftSources && i.url && ftSources.has(i.source) ? 'can' : 'no';
    return o;
  });
  if (admin) {
    try {
      await env.DB.prepare('UPDATE events SET seen = ? WHERE id = ?').bind(now, row.id).run();
    } catch {}
  }
  return { ok: true, id: row.id, name: row.name, seen: admin ? row.seen || 0 : undefined, items: list };
}

/**
 * 深读和稿件要用的“选题”：从事件编号还原出以前选题会给的那种对象（标题、理由、相关事件名、股票、观点线索）。
 */
export async function eventTopic(env, id, now = Date.now()) {
  const row = await rowOf(env, id);
  if (!row) return null;
  const stories = await storiesOf(env, row, now);
  const snap = safeJson(row.topic, null) || {};
  const titles = (await metaGet(env, 'story_alias'))?.v?.titles || {};
  let items = [];
  try {
    if (stories.length) items = (await env.DB.prepare(`SELECT id, source, title, ts, score, dir, tickers, topic, kind, who, pick, hook, url FROM items WHERE ts > ? AND dup_of IS NULL AND score >= 5 AND story IN (${stories.map(() => '?').join(',')}) ORDER BY ts DESC LIMIT 200`).bind(now - 72 * H, ...stories).all()).results;
    else items = (await env.DB.prepare('SELECT id, source, title, ts, score, dir, tickers, topic, kind, who, pick, hook, url FROM items WHERE id = ?').bind(row.name.slice(2)).all()).results;
  } catch {}
  const card = items.length ? eventCard(row.name, items, items.map((i) => i.ts), now) : null;
  const zh = row.title || snap.title_zh || titles[row.name]?.zh || (row.name.startsWith('i:') ? clean(items[0]?.title).slice(0, 40) : row.name);
  return {
    rank: row.id,
    row,
    title_zh: zh,
    title_en: row.title_en || snap.title_en || titles[row.name]?.en || zh,
    why_zh: snap.why_zh || (card ? `${card.n} 条消息，${card.outlets} 家媒体在报，最高 ${card.top} 分。` : ''),
    why_en: snap.why_en || '',
    angle_en: snap.angle_en || '',
    market: snap.market || card?.market || 'US',
    tickers: [...new Set((snap.tickers || []).concat(card?.tickers || []))].slice(0, 4),
    ids: stories.length ? (snap.ids || []).slice(0, 40) : [row.name.slice(2)],
    stories,
    facts: snap.facts || [],
    hooks: snap.hooks || [],
    views: card?.views || [],
  };
}

/* ---------- 用户的操作 ---------- */

/**
 * act = 'state'：改状态（state、note）；'move'：把一条消息移出这件事（item）；'seen'：标记看过。
 * snap 是页面带上来的“当时这件事在榜上的样子”（排第几、分量、信号），原样记进日志。
 */
export async function evAct(env, { id, act, state, note = '', item, snap = null, now = Date.now() }) {
  const row = await rowOf(env, id);
  if (!row) return { ok: false, error: 'no_event' };
  const log = (a, n) => env.DB.prepare('INSERT INTO ev_log (ts, ev, name, act, note, snap) VALUES (?, ?, ?, ?, ?, ?)').bind(now, row.id, row.name, a, String(n || '').slice(0, 300), snap ? JSON.stringify(snap).slice(0, 1200) : null).run();
  if (act === 'seen') {
    await env.DB.prepare('UPDATE events SET seen = ? WHERE id = ?').bind(now, row.id).run();
    return { ok: true, quiet: true };
  }
  if (act === 'move') {
    const it = (await env.DB.prepare('SELECT id, story FROM items WHERE id = ?').bind(String(item || '')).all()).results?.[0];
    if (!it || !it.story) return { ok: false, error: 'no_item' };
    await env.DB.prepare('UPDATE items SET story = NULL WHERE id = ?').bind(it.id).run();
    await log('move', it.id + ' | ' + it.story);
    return { ok: true };
  }
  if (act === 'join') {
    // 手动把两件事并成一行一起写。任何一边已经是合并行，就往那一行里加
    const other = await rowOf(env, item);
    if (!other || other.id === row.id) return { ok: false, error: 'no_event' };
    if (row.name.startsWith('i:') || other.name.startsWith('i:')) return { ok: false, error: 'no_event' };
    const mem = (r) => (r.kind === 'g' ? safeJson(r.members, []) : [r.name]);
    const all = [...new Set(mem(row).concat(mem(other)))].slice(0, 8);
    const order = ['new', 'follow', 'write', 'drafted', 'published'];
    const st = order[Math.max(0, order.indexOf(row.state), order.indexOf(other.state))];
    const host = row.kind === 'g' ? row : other.kind === 'g' ? other : null;
    let gid;
    if (host) {
      await env.DB.prepare('UPDATE events SET members = ?, state = ? WHERE id = ?').bind(JSON.stringify(all), st, host.id).run();
      const guest = host === row ? other : row;
      if (guest.kind === 'g') await env.DB.prepare('UPDATE events SET gone = 1 WHERE id = ?').bind(guest.id).run();
      gid = host.id;
    } else {
      const tt = (await metaGet(env, 'story_alias'))?.v?.titles || {};
      const zh = (r) => r.title || tt[r.name]?.zh || r.name;
      const en = (r) => r.title_en || tt[r.name]?.en || '';
      const title = (zh(row) + ' ＋ ' + zh(other)).slice(0, 80);
      const title_en = en(row) && en(other) ? (en(row) + ' + ' + en(other)).slice(0, 160) : null;
      const r = await env.DB.prepare("INSERT INTO events (name, kind, members, title, title_en, state, state_ts, created) VALUES (?, 'g', ?, ?, ?, ?, ?, ?)").bind('g:m:' + now + ':' + row.id, JSON.stringify(all), title, title_en, st, now, Math.min(row.created || now, other.created || now)).run();
      gid = r.meta?.last_row_id || (await env.DB.prepare('SELECT id FROM events WHERE name = ?').bind('g:m:' + now + ':' + row.id).all()).results?.[0]?.id;
    }
    // 并进去的两件事自己的状态清掉，不然它们会各自再占一行
    for (const r of [row, other]) if (r.kind !== 'g') await env.DB.prepare("UPDATE events SET state = 'new' WHERE id = ?").bind(r.id).run();
    await log('join', other.name);
    return { ok: true, id: gid };
  }
  if (act === 'split') {
    if (row.kind !== 'g') return { ok: false, error: 'no_event' };
    await env.DB.prepare('UPDATE events SET gone = 1 WHERE id = ?').bind(row.id).run();
    await log('split', '');
    return { ok: true };
  }
  if (act === 'state') {
    if (!STATES.includes(state)) return { ok: false, error: 'bad_state' };
    await env.DB.prepare('UPDATE events SET state = ?, state_ts = ?, note = ? WHERE id = ?').bind(state, now, String(note || '').slice(0, 300), row.id).run();
    await log(state, note);
    // 已发布 = 记进已写记录（以后同一件事再上榜会提示“写过，之后新增几条”）；改回别的状态就撤掉
    try {
      if (state === 'published') {
        const had = (await env.DB.prepare('SELECT id FROM desk_written WHERE run_id = 0 AND rank = ? AND gone = 0 LIMIT 1').bind(row.id).all()).results?.[0];
        if (!had) {
          const t = await eventTopic(env, row.id, now);
          await env.DB.prepare('INSERT INTO desk_written (ts, title, run_id, rank, ids, stories, off, note) VALUES (?, ?, 0, ?, ?, ?, 0, ?)').bind(now, t.title_zh, row.id, JSON.stringify(t.ids || []), JSON.stringify(t.stories || []), '').run();
        }
      } else if (row.state === 'published') await env.DB.prepare('UPDATE desk_written SET gone = 1 WHERE run_id = 0 AND rank = ?').bind(row.id).run();
    } catch {}
    return { ok: true };
  }
  return { ok: false, error: 'bad_act' };
}

/** 稿子写出来了：还没到“稿子已生成”的自动推进到这一步 */
export async function evDrafted(env, id, now = Date.now()) {
  try {
    const r = await env.DB.prepare("UPDATE events SET state = 'drafted', state_ts = ? WHERE id = ? AND state IN ('new', 'follow', 'write')").bind(now, Number(id) || 0).run();
    if (r.meta?.changes) await env.DB.prepare("INSERT INTO ev_log (ts, ev, name, act, note) VALUES (?, ?, '', 'drafted', 'auto')").bind(now, Number(id) || 0).run();
  } catch {}
}

/* ---------- “帮我挑今天写什么”：把选题会的结果落到事件上 ---------- */

/**
 * 一场选题会开完后调用。每个选题：
 * - 只涉及一件事 → 把理由、关键事实、英文角度记在那件事上，并标“今天推荐”；
 * - 用到了几件事里各两条以上的消息 → 这几件事合成一行（“包含 N 件事”），标题用选题名。
 * 以前合成的行：用户动过的（关注、决定写、有稿子）保留；没动过的解散，按这一场的重新来。
 */
export async function applyDeskRun(env, run, { now = Date.now() } = {}) {
  await ensureEv(env);
  const alias = await storyAlias(env, now).catch(() => ({}));
  const rows = (await env.DB.prepare('SELECT * FROM events WHERE gone = 0 AND (created > ? OR state IN (\'follow\', \'write\', \'drafted\')) ORDER BY id DESC LIMIT 500').bind(now - 6 * 24 * H).all()).results;
  const groups = rows.filter((r) => r.kind === 'g');
  const keepG = [];
  for (const g of groups) {
    let used = g.state !== 'new';
    if (!used) {
      try {
        used = !!(await env.DB.prepare('SELECT 1 AS x FROM desk_dossiers WHERE run_id = 0 AND rank = ? UNION ALL SELECT 1 FROM desk_drafts WHERE run_id = 0 AND rank = ? LIMIT 1').bind(g.id, g.id).all()).results.length;
      } catch {}
    }
    if (used) keepG.push(g);
  }
  const taken = new Map();
  for (const g of keepG) for (const m of safeJson(g.members, [])) taken.set(resolveAlias(m, alias), g);
  const reuse = new Set(keepG.map((g) => g.id));
  let made = 0;
  let tagged = 0;
  for (const t of run.topics || []) {
    const ids = (t.ids || []).slice(0, 40);
    if (!ids.length) continue;
    const its = (await env.DB.prepare(`SELECT id, story FROM items WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results;
    const cnt = new Map();
    for (const i of its) {
      if (!i.story) continue;
      const s = resolveAlias(i.story, alias);
      cnt.set(s, (cnt.get(s) || 0) + 1);
    }
    const sorted = [...cnt].sort((a, b) => b[1] - a[1]);
    if (!sorted.length) continue;
    const members = sorted.filter((x, k) => k === 0 || x[1] >= 2).map((x) => x[0]).slice(0, 6);
    const snap = JSON.stringify({ run: run.id, rank: t.rank, title_zh: t.title_zh, title_en: t.title_en, why_zh: t.why_zh, why_en: t.why_en, angle_en: t.angle_en, market: t.market, tickers: t.tickers, facts: t.facts, hooks: t.hooks, ids: t.ids, write: !!t.write });
    // 这几件事已经在用户保留的某一行里：就更新那一行
    const old = members.map((m) => taken.get(m)).find(Boolean);
    if (old) {
      const all = [...new Set(safeJson(old.members, []).map((m) => resolveAlias(m, alias)).concat(members.filter((m) => !taken.has(m) || taken.get(m) === old)))];
      await env.DB.prepare('UPDATE events SET members = ?, topic = ?, title = ?, title_en = ? WHERE id = ?').bind(JSON.stringify(all), snap, t.title_zh, t.title_en, old.id).run();
      for (const m of all) taken.set(m, old);
      tagged++;
      continue;
    }
    const free = members.filter((m) => !taken.has(m));
    if (!free.length) continue;
    if (free.length === 1) {
      await env.DB.prepare("INSERT INTO events (name, kind, state, created, topic) VALUES (?, 'e', 'new', ?, ?) ON CONFLICT(name) DO UPDATE SET topic = excluded.topic, gone = 0").bind(free[0], now, snap).run();
      taken.set(free[0], { id: -1 });
      tagged++;
    } else {
      const name = `g:${run.id}:${t.rank}`;
      await env.DB.prepare("INSERT INTO events (name, kind, members, title, title_en, state, created, topic) VALUES (?, 'g', ?, ?, ?, 'new', ?, ?) ON CONFLICT(name) DO UPDATE SET members = excluded.members, topic = excluded.topic, gone = 0").bind(name, JSON.stringify(free), t.title_zh, t.title_en, now, snap).run();
      for (const m of free) taken.set(m, { id: -1 });
      made++;
    }
  }
  // 没动过的旧合并行解散
  for (const g of groups) if (!reuse.has(g.id) && !String(g.name).startsWith(`g:${run.id}:`) && !String(g.name).startsWith('g:m:')) await env.DB.prepare('UPDATE events SET gone = 1 WHERE id = ?').bind(g.id).run();
  return { made, tagged };
}

/* ---------- 校准：排序准不准 ---------- */

/**
 * 用最近 30 天记下的选择算：你决定写（或已发布）的事，当时排在第几；你否掉的事里有多少当时排得很靠前、最常见的理由是什么。
 * 以前选题榜上的“就写这个 / 这个不对”也算进来。
 */
export async function evCalib(env, now = Date.now()) {
  const since = now - 30 * 24 * H;
  const yes = [];
  const no = [];
  const why = {};
  const seenEv = new Set();
  try {
    const logs = (await env.DB.prepare("SELECT ts, ev, act, note, snap FROM ev_log WHERE ts > ? AND act IN ('write', 'published', 'skip') ORDER BY id DESC LIMIT 400").bind(since).all()).results;
    for (const l of logs) {
      const key = l.ev + ':' + (l.act === 'skip' ? 'n' : 'y');
      if (seenEv.has(key)) continue; // 同一件事先“决定写”再“已发布”只算一次
      seenEv.add(key);
      const s = safeJson(l.snap, {}) || {};
      if (l.act === 'skip') {
        no.push(s.pos || 0);
        for (const w of String(l.note || '').split('; ').filter(Boolean)) why[w] = (why[w] || 0) + 1;
      } else yes.push(s.pos || 0);
    }
  } catch {}
  try {
    const picks = (await env.DB.prepare("SELECT run_id, rank, verdict, note FROM desk_picks WHERE ts > ? AND verdict IN ('pick', 'pass') ORDER BY id DESC LIMIT 300").bind(since).all()).results;
    const seen = new Set();
    for (const p of picks) {
      const key = p.run_id + ':' + p.rank;
      if (seen.has(key)) continue;
      seen.add(key);
      if (p.verdict === 'pick') yes.push(p.rank);
      else {
        no.push(p.rank);
        for (const w of String(p.note || '').split('; ').filter(Boolean)) why[w] = (why[w] || 0) + 1;
      }
    }
  } catch {}
  const top5 = (a) => a.filter((x) => x >= 1 && x <= 5).length;
  const known = (a) => a.filter((x) => x >= 1).length;
  return { days: 30, yes: yes.length, yes_top5: top5(yes), yes_known: known(yes), no: no.length, no_top5: top5(no), why: Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 4) };
}
