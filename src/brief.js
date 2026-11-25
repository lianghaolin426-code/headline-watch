// 事件简报：对重要事件（有 9 分以上的快讯，或 8 分以上且有多家来源证实），
// 用 Claude 把这件事已收集到的快讯和深度文章标题写成一篇中文简报。
// 只用收集到的原文，每句话标注来源编号，网页上可以点开原文。
// 有新报道时滚动重写（攒够几条或隔一段时间，9 分以上的新消息立即），每天有花费上限。

import { claudeText, claudeUp, claudeUsd, claudeState } from './claude.js';

const failedUntil = new Map();

export const BRIEF_TABLE =
  'CREATE TABLE IF NOT EXISTS briefs (key TEXT PRIMARY KEY, title TEXT, body TEXT, srcs TEXT, ids TEXT, n INTEGER, created INTEGER, updated INTEGER, writes INTEGER NOT NULL DEFAULT 0, day TEXT, day_writes INTEGER NOT NULL DEFAULT 0)';

const H = 3_600_000;

export function briefConfig(env) {
  return {
    on: env.BRIEFS !== 'false',
    windowH: Number(env.BRIEF_WINDOW_HOURS || 36), // 同一件事往前看多久
    minScore: Number(env.BRIEF_ITEM_MIN || 5), // 多少分以上的快讯算进事件
    dailyUsd: Number(env.BRIEF_DAILY_USD || 0.5), // 每天最多花多少美元写简报
    perDay: Number(env.BRIEF_MAX_PER_DAY || 24), // 每件事每天最多写几次（9 分以上的新消息不受这个限制，只受每日花费上限）
    keepPrev: Number(env.BRIEF_KEEP_PREV || 15), // 重写时带上上一版引用过、已不在窗口里的报道（最多几条），长事件的前情不会丢
    perRun: Number(env.BRIEF_MAX_PER_RUN || 2), // 每分钟最多写几篇（控制单轮耗时）
    batchN: Number(env.BRIEF_BATCH_N || 3), // 攒够几条新报道才更新
    batchMin: Number(env.BRIEF_BATCH_MIN || 30), // 两次更新至少隔多少分钟
    urgentMin: Number(env.BRIEF_URGENT_MIN || 10), // 9 分以上的新消息：至少隔多少分钟就更新
    staleH: Number(env.BRIEF_STALE_HOURS || 3), // 只有一两条新报道时，最多等多久也更新
    maxSrc: Number(env.BRIEF_MAX_SOURCES || 45), // 一篇最多喂多少条报道
    minItems: Number(env.BRIEF_MIN_ITEMS || 3), // 至少几条报道才值得写简报
  };
}

/**
 * 事件的键（和网页上的“同一件事”分组一致）：AI 打分时给了事件名的，就只按事件名（"~事件名"）归拢，
 * 同一只股票下的几件不同的事各写各的简报；没有事件名的（旧数据、行情综述）仍按股票代码、再按话题标签。
 */
export function eventKeys(i) {
  if (i.story) return ['~' + String(i.story).trim()];
  const ks = String(i.tickers || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .map((s) => '$' + s);
  if (!ks.length && i.topic) {
    const t = String(i.topic).split('|')[0].toLowerCase().replace(/^(us|u\.s\.)\s+/, '').trim();
    if (t) ks.push('#' + t);
  }
  return ks;
}

/** 把快讯按共同的键归成事件（有共同股票或话题就并在一起） */
export function groupEvents(items) {
  const parent = new Map();
  const find = (k) => {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)));
      k = parent.get(k);
    }
    return k;
  };
  const add = (k) => parent.has(k) || parent.set(k, k);
  const keyed = [];
  for (const i of items) {
    const ks = eventKeys(i);
    if (!ks.length) continue;
    ks.forEach(add);
    for (const k of ks.slice(1)) parent.set(find(k), find(ks[0]));
    keyed.push([i, ks]);
  }
  const groups = new Map();
  for (const [i, ks] of keyed) {
    const root = find(ks[0]);
    if (!groups.has(root)) groups.set(root, { items: [], counts: new Map() });
    const g = groups.get(root);
    g.items.push(i);
    ks.forEach((k) => g.counts.set(k, (g.counts.get(k) || 0) + 1));
  }
  // 事件的名字：组里出现最多的键（如 $NVDA）
  return [...groups.values()].map((g) => ({ key: [...g.counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0], items: g.items }));
}

export const isBig = (i) => (i.score || 0) >= 9 || ((i.score || 0) >= 8 && (i.confirms || 0) >= 1);

/**
 * 这件事现在要不要写（或重写）简报。返回原因字符串，或 null。
 * @param ev { key, items }  @param row 上一版简报（数据库里的一行），没有则为 null
 */
export function needsWrite(ev, row, now, c) {
  if (ev.items.length < c.minItems || !ev.items.some(isBig)) return null;
  const today = new Date(now).toISOString().slice(0, 10);
  if (!row || now - row.updated > c.windowH * H) return 'new';
  const had = new Set(safeJson(row.ids, []));
  const fresh = ev.items.filter((i) => !had.has(i.id));
  if (!fresh.length) return null;
  const mins = (now - row.updated) / 60_000;
  if (fresh.some((i) => (i.score || 0) >= 9) && mins >= c.urgentMin) return 'urgent';
  if (row.day === today && row.day_writes >= c.perDay) return null;
  if (fresh.length >= c.batchN && mins >= c.batchMin) return 'batch';
  if (mins >= c.staleH * 60) return 'stale';
  return null;
}

const clean = (s) =>
  String(s || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** 北京时间 MM-DD HH:MM（读者主要看中文） */
export const bjTime = (ts) => new Date(ts + 8 * H).toISOString().slice(5, 16).replace('T', ' ');

/**
 * 挑出喂给模型的报道：太多时留分数最高的，再按时间排；深度文章附在后面。
 * 返回 [{ n, id, source, title, body, ts, url, score, art }]
 */
export function pickSources(items, arts, max, prev = []) {
  let list = items.slice();
  if (list.length > max) list = list.sort((a, b) => (b.score || 0) - (a.score || 0) || b.ts - a.ts).slice(0, max);
  // 上一版引用过、这次没选上的报道（多半已滑出时间窗口）：作为“早前报道”带上，只有标题，不用再从数据库读
  const have = new Set(list.map((i) => i.id).concat(arts.map((a) => a.id)));
  list = list.concat(prev.filter((p) => !have.has(p.id)).map((p) => ({ ...p, prev: true })));
  list.sort((a, b) => a.ts - b.ts);
  const all = [...list.map((i) => ({ ...i, art: false })), ...arts.slice(0, 12).map((a) => ({ ...a, art: true }))];
  return all.map((i, k) => ({ n: k + 1, id: i.id, source: i.source, title: clean(i.title), body: clean(i.body), ts: i.ts, url: i.url, score: i.score, confirms: i.confirms || 0, art: i.art, prev: i.prev || undefined }));
}

export function sourceText(srcs) {
  return srcs
    .map((s) => {
      let body = s.body;
      if (body && body.startsWith(s.title.slice(0, 30))) body = body.slice(s.title.length).trim();
      const head = `[S${s.n}] ${bjTime(s.ts)} | ${s.source}${s.art ? '（深度文章）' : ''}${s.prev ? '（早前报道，上一版简报用过）' : ''}${s.score != null && !s.art ? ` | ${Math.round(s.score * 10) / 10}分` : ''} | ${s.title}`;
      return body && body.length > 15 ? `${head}\n    ${body.slice(0, 700)}` : head;
    })
    .join('\n');
}

export const BRIEF_SYSTEM = `你是一名财经编辑，为一个只关注美股和沙特股市的新闻看板撰写"事件简报"。用户消息里是同一事件的全部原始报道（快讯，以及深度文章的标题和摘要），每条前面有编号 [S1]、[S2]…，时间为北京时间，"N分"是看板给这条消息打的重要性分数（10 分最高）。

硬性规则（准确性第一）：
1. 只能使用报道里明确写出的事实、数字和说法。不准补充任何你自己知道的背景、数字、人物身份、历史对比或推测。原文没说的，就不写。
2. 每一句话结尾都要用方括号标注来源编号，如 [S3] 或 [S3][S12]。一句话里的每个事实都必须能在所标来源中找到。
3. 来源之间说法不一致时（比如涨幅 30% 与 31%），要么写明分歧并分别标注，要么用能被多个来源同时支持的更保守的表述。
4. "据某某报道""知情人士称"这类未经证实的消息，要保留消息来源的措辞，不能写成既成事实。
5. 观点必须写明是谁的观点（机构或人名），不能变成简报自己的判断。简报本身不给投资建议、不预测涨跌。
6. 深度文章只能引用它给出的标题和摘要，写成"某某文章称/认为"。
7. 9 分及以上的报道是这件事最重要的进展，都要写进简报（重复的说法合并）。
8. 报道里如果混进了和这件事无关的消息，忽略它们。
9. 评论文章、分析文章的标题（如"……扼杀了降息希望""……还有三大疑问"）只是作者观点，要写成"某某文章认为……"，并尽量贴近原标题的意思，不能夸大成确定的数字或结论。
10. 每个数字（涨跌幅、金额、日期、概率）都必须紧跟它的来源编号；括号里的补充说明也一样，没有来源的补充一律不写。
11. 不要说"某某等媒体称"，只写实际标注了的那一家来源。
12. 标着"早前报道"的是这件事前期的关键报道（只有标题），用来保留来龙去脉：事件脉络和背景里该写的照样写、照样标注。
13. 这些报道通常是同一件具体的事；但同一家公司或同一话题下，有时会混进几件不同的事（比如人事变动和政府入股提议）。"一句话"和"发生了什么"的第一句要写最新的重要进展（时间最晚的 8 分以上报道），较早的事放在后面或写进事件脉络，不要让旧消息盖过新进展。
14. 重点标记：全文最多 2 处，用 ==…== 包住读者最该记住的关键事实（一个数字、一项决定或一个日期，每处不超过 25 个字），只放在"发生了什么"或"市场反应"里。只能包住句子里的文字，不包来源编号，不包观点和推测；没有特别关键的事实就一处也不标。"一句话"里不标。

写作要求：
- 简体中文，书面、凝练、通顺，像一流财经媒体的编辑稿，不堆砌、不重复同一事实。外国人名、公司名用通行中文译名，没有通行译名的保留原文。
- 结构固定为以下小标题（某部分没有素材就省略该部分）：
## 一句话
（不超过 40 字，说清发生了什么，可作为标题）
## 发生了什么
（3–5 句）
## 事件脉络
（按时间从早到晚的要点列表，每条都以"MM-DD HH:MM"开头（月-日 时:分，用报道时间，日期不能省），只列关键节点，最多 8 条）
## 市场反应
（涨跌幅、指数、相关板块，数字必须原样来自来源）
## 各方观点
（列表，每条"谁：观点"，最多 6 条，有不同看法时正反两方都要有）
## 接下来关注
（只写来源里明确提到的后续日程或悬而未决的问题，最多 4 条）
- 全文 500–900 字（不含来源标注）。
- 只输出简报正文（Markdown），不要前言后语。`;

/** 事件脉络按开头的 "MM-DD HH:MM" 从早到晚排（没有时间的条目留在原位置之后） */
export function sortTimeline(body) {
  return body.replace(/(##\s*事件脉络[^\n]*\n)([\s\S]*?)(?=\n##|$)/, (all, h, sec) => {
    const L = sec.split('\n');
    const key = (l) => (l.match(/^\s*[-*]?\s*(\d{2}-\d{2} \d{2}:\d{2})/) || [])[1] || '~';
    const items = L.map((l, k) => ({ l, k })).filter((x) => x.l.trim());
    items.sort((a, b) => (key(a.l) < key(b.l) ? -1 : key(a.l) > key(b.l) ? 1 : a.k - b.k));
    return h + items.map((x) => x.l).join('\n');
  });
}

/** 检查并整理模型的输出：去掉不存在的来源编号；返回 { title, body, uncited } 或 null */
export function tidyBrief(text, n) {
  let body = String(text || '').trim();
  const at = body.indexOf('## ');
  if (at < 0) return null;
  body = body.slice(at);
  body = body.replace(/\[S(\d+)\]/g, (m, d) => (+d >= 1 && +d <= n ? `[S${+d}]` : ''));
  body = sortTimeline(body);
  // 重点标记 ==…==：最多保留前 2 处，太长的、跨行的、落单的一律去掉记号（文字保留）
  body = body.replace(/(##\s*一句话\s*\n+)([^\n]+)/, (m, h, l) => h + l.replace(/==/g, ''));
  let marks = 0;
  body = body.replace(/==([^=\n]+)==/g, (m, t) => (/\[S\d+\]/.test(t) || t.length > 40 || marks >= 2 ? t : (marks++, `\u0001${t}\u0001`))).replace(/==/g, '').replace(/\u0001/g, '==');
  const lines = body.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  if (!lines.length) return null;
  const uncited = lines.filter((l) => !/\[S\d+\]/.test(l)).length;
  const m = body.match(/##\s*一句话\s*\n+([^\n]+)/);
  const title = m ? m[1].replace(/\[S\d+\]/g, '').replace(/^[-*\s]+/, '').trim() : '';
  return { title, body, uncited };
}

const safeJson = (s, d) => {
  try {
    return s ? JSON.parse(s) : d;
  } catch {
    return d;
  }
};

async function ensureTable(env) {
  await env.DB.prepare(BRIEF_TABLE).run();
}

/** 今天写简报已经花了多少美元 */
async function spentToday(env, now) {
  try {
    const r = await env.DB.prepare("SELECT input_tokens, output_tokens FROM claude_usage WHERE day = ? AND kind = 'brief'").bind(new Date(now).toISOString().slice(0, 10)).first();
    return r ? claudeUsd(r.input_tokens, r.output_tokens) : 0;
  } catch {
    return 0;
  }
}

async function loadEvents(env, c, now, articles) {
  // 分数线直接写进语句，这样能用上部分索引 idx_items_brief（只含 5 分以上、不是重复的快讯）
  const q = (cols) =>
    env.DB.prepare(`SELECT id, source, title, body, url, ts, score, confirms, tickers, topic${cols} FROM items WHERE ts > ? AND dup_of IS NULL AND score >= ${Number(c.minScore) || 0} ORDER BY ts DESC LIMIT 1500`)
      .bind(now - c.windowH * H)
      .all();
  let rows;
  try {
    rows = (await q(', story')).results;
  } catch {
    rows = (await q('')).results; // 还没有 story 列（v13 之前的库）
  }
  return groupEvents(rows.filter((r) => !articles.has(r.source)));
}

async function articlesFor(env, ids) {
  if (!ids.length) return [];
  try {
    const out = new Map();
    for (let k = 0; k < ids.length; k += 80) {
      const part = ids.slice(k, k + 80);
      const r = await env.DB.prepare(
        `SELECT DISTINCT i.id, i.source, i.title, i.body, i.url, i.ts FROM related r JOIN items i ON i.id = r.article_id WHERE r.flash_id IN (${part.map(() => '?').join(',')})`
      )
        .bind(...part)
        .all();
      r.results.forEach((a) => out.set(a.id, a));
    }
    return [...out.values()].sort((a, b) => a.ts - b.ts);
  } catch {
    return []; // 还没有 related 表
  }
}

/** 上一版正文里引用过的报道（分数高、多源证实的优先），供重写时保留前情 */
export function prevCited(row, max) {
  if (!row || !max) return [];
  const srcs = safeJson(row.srcs, []);
  const cnt = new Map();
  String(row.body || '').replace(/\[S(\d+)\]/g, (_, n) => cnt.set(+n, (cnt.get(+n) || 0) + 1));
  return srcs
    .filter((x) => !x.art && cnt.has(x.n))
    // 留哪些：分数高的优先，其次多家来源证实的，再其次被引用次数多的（之后按时间排进材料）
    .sort((a, b) => (b.sc || 0) - (a.sc || 0) || (b.cf || 0) - (a.cf || 0) || cnt.get(b.n) - cnt.get(a.n) || a.ts - b.ts)
    .slice(0, max)
    .map((x) => ({ id: x.id, source: x.src, title: x.t, body: '', ts: x.ts, url: x.url, score: x.sc ?? null, confirms: x.cf || 0 }));
}

/** 写（或重写）一件事的简报，成功返回新的一行 */
export async function writeBrief(env, ev, row, c, now) {
  const arts = await articlesFor(env, ev.items.map((i) => i.id));
  const srcs = pickSources(ev.items, arts, c.maxSrc, prevCited(row, c.keepPrev));
  const user = `以下是关于同一事件的 ${srcs.length} 条报道（现在是北京时间 ${bjTime(now)}）：\n\n${sourceText(srcs)}`;
  const res = await claudeText(env, { system: BRIEF_SYSTEM, user, maxTokens: 16000, kind: 'brief', effort: 'low', think: true, timeout: 120_000 });
  if (!res) return null;
  const out = tidyBrief(res.text, srcs.length);
  if (!out) return null;
  const had = new Set(safeJson(row?.ids, []));
  const fresh = !!row && now - row.updated <= c.windowH * H;
  const map = srcs.map((s) => ({ n: s.n, id: s.id, src: s.source, ts: s.ts, url: s.url, t: s.title.slice(0, 120), sc: s.score ?? undefined, cf: s.confirms || undefined, art: s.art || undefined, prev: s.prev || undefined, new: fresh && !s.art && !s.prev && !had.has(s.id) ? 1 : undefined }));
  const today = new Date(now).toISOString().slice(0, 10);
  const next = {
    key: ev.key,
    title: out.title,
    body: out.body,
    srcs: JSON.stringify(map),
    ids: JSON.stringify(ev.items.map((i) => i.id)),
    n: ev.items.length,
    created: fresh ? row.created : now,
    updated: now,
    writes: (fresh ? row.writes : 0) + 1,
    day: today,
    day_writes: (fresh && row.day === today ? row.day_writes : 0) + 1,
  };
  await env.DB.prepare(
    `INSERT INTO briefs (key, title, body, srcs, ids, n, created, updated, writes, day, day_writes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET title = excluded.title, body = excluded.body, srcs = excluded.srcs, ids = excluded.ids, n = excluded.n, created = excluded.created,
       updated = excluded.updated, writes = excluded.writes, day = excluded.day, day_writes = excluded.day_writes`
  )
    .bind(next.key, next.title, next.body, next.srcs, next.ids, next.n, next.created, next.updated, next.writes, next.day, next.day_writes)
    .run();
  return { ...next, usd: claudeUsd(res.usage.input, res.usage.output), uncited: out.uncited };
}

/** 每分钟跑一次：找出需要写/更新的事件，按重要性写最多 perRun 篇 */
export async function runBriefs(env, { now = Date.now(), articles = new Set(), force = null } = {}) {
  const c = briefConfig(env);
  const report = { written: [], skipped: null };
  if (!c.on && !force) return report;
  if (!claudeUp(env)) return { ...report, skipped: 'claude 不可用' };
  await ensureTable(env);
  const spent = await spentToday(env, now);
  if (spent >= c.dailyUsd) return { ...report, skipped: `今天已花 $${spent.toFixed(3)}，到上限` };
  const rows = new Map((await env.DB.prepare('SELECT * FROM briefs WHERE updated > ?').bind(now - 2 * c.windowH * H).all()).results.map((r) => [r.key, r]));
  const events = await loadEvents(env, c, now, articles);
  const todo = events
    .map((ev) => ({ ev, why: force ? (ev.key === force ? 'force' : null) : needsWrite(ev, rows.get(ev.key) || null, now, c) }))
    .filter((x) => x.why)
    .sort((a, b) => Math.max(...b.ev.items.map((i) => i.score || 0)) - Math.max(...a.ev.items.map((i) => i.score || 0)));
  // 写失败的事件 30 分钟内不再试（免得每 5 分钟白花一次钱）
  const ready = todo.filter((x) => force || !(failedUntil.get(x.ev.key) > now));
  for (const { ev, why } of ready.slice(0, force ? 1 : c.perRun)) {
    const r = await writeBrief(env, ev, rows.get(ev.key) || null, c, now);
    if (!r) failedUntil.set(ev.key, now + 30 * 60_000);
    else failedUntil.delete(ev.key);
    report.written.push(r ? { key: ev.key, why, n: ev.items.length, usd: r.usd, uncited: r.uncited } : { key: ev.key, why, failed: true, error: claudeState().last_error });
  }
  report.pending = Math.max(0, todo.length - report.written.length);
  return report;
}

/** 网页用：最近还在窗口内的简报 */
export async function listBriefs(env, { now = Date.now() } = {}) {
  const c = briefConfig(env);
  try {
    const rows = (await env.DB.prepare('SELECT key, title, body, srcs, ids, n, created, updated, writes FROM briefs WHERE updated > ? ORDER BY updated DESC LIMIT 30').bind(now - c.windowH * H).all()).results;
    return rows.map((r) => {
      const srcs = safeJson(r.srcs, []);
      const last = Math.max(0, ...srcs.filter((s) => !s.art).map((s) => s.ts));
      // quiet：这件事 6 小时没有新报道（只是提示，不会停止更新：有新报道照样重写）
      return { ...r, srcs, ids: safeJson(r.ids, []), last, quiet: now - Math.max(last, r.updated - 6 * H) > 6 * H };
    });
  } catch {
    return [];
  }
}
