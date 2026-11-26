// 事件归并：把打分时被起了不同名字、其实是同一件事的“事件”并成一件。
// 打分是一条一条消息看的，同一件事的后续反应常被另起一个名字（“苹果下架 MiniMax”出现三种写法、
// 一份关税计划和各国的回应被拆成八件事）。这里每隔几分钟把还在进行的事件名放在一起看一遍：
// 一个动作，加上对它的回应、表态、它引起的行情，算同一件事；两个不同的动作仍然是两件事。
// 并掉的名字记在 meta 表（story_alias），之后打分再写出旧名字也会自动换成并入的那件。

import { claudeText, claudeUp } from './claude.js';
import { metaGet, metaSet } from './dbguard.js';

const H = 3_600_000;

export function mergeConfig(env) {
  return {
    on: env.EVENT_MERGE !== 'false',
    everyMin: Number(env.EVENT_MERGE_EVERY_MIN || 10), // 每隔几分钟看一遍
    windowH: Number(env.EVENT_MERGE_WINDOW_HOURS || 36), // 只看这段时间里有消息的事件
    maxList: Number(env.EVENT_MERGE_MAX || 90), // 一次最多给模型看多少件事
  };
}

export const MERGE_SYSTEM = `You tidy the event list of a financial news desk. Each numbered line is one event as named by an earlier step: name | topic | tickers | number of reports | time of first report (Beijing) | one sample headline.
The earlier step looked at one headline at a time, so the same event often got several names. Find the lines that are the same event and should be one.

Same event (merge):
- the same action or announcement worded differently (Apple pulls MiniMax's chatbot / Apple removes MiniMax AI app over child safety);
- an action and the direct responses to it within about a day: official statements, protests or retaliation threats by the parties it targets, a defence of it, and the market move it caused (a new US tariff plan, Japan's protest, Singapore's disappointment, China's response and "stocks fall on the tariff plan" are one event; a CEO's reinstatement and a politician defending that reinstatement are one event);
- later re-reports and added detail about the same thing (Musk says every American child gets two SpaceX shares / Musk says SpaceX shares will be transferred to US children).

Different events (keep apart):
- two separate actions about the same company, person or theme (Nvidia halts chip deliveries to Southeast Asia vs Jensen Huang returns as CEO; an FCC licence for SpaceX vs Musk giving SpaceX shares to children);
- the same kind of thing happening to different subjects with no common trigger (two unrelated central bank decisions);
- a general theme or market wrap and a specific event inside it.
- two things that merely share a word, an agency or a person (a judge blocking an FCC review vs another judge blocking a birthright order; a politician's stock trades in a company vs that company's export halt).
When unsure, keep them apart.

Put an action and ALL of its responses in ONE group, not several: if a tariff plan drew protests from four countries, that is one group of five or more lines, not pairs. Before answering, check each group: could one newspaper article with one headline cover every line in it? If not, split it or drop the odd line.

Second job, display titles. Lines whose number is followed by * are new. For each of them write a short display title an editor can scan in a list: "zh" in Simplified Chinese, at most 16 characters, a complete phrase that says who did what (never cut off mid-word, no trailing punctuation); "en" in English, at most 9 words, headline style. Base them on the name and the sample headline only; add no facts.

Reply with JSON only: {"groups": [[numbers of one event], ...], "titles": [[number, "zh title", "English title"], ...]}. In "groups" list only groups of two or more lines; every number at most once; "groups": [] when nothing should merge. In "titles" give one entry per * line.`;

const squash = (s) => String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const topicKey = (t) => String(t || '').split('|')[0].trim().toLowerCase();
const tickerSet = (t) => new Set(String(t || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
function grams(s) {
  const out = new Set();
  // 英文按词，中文按相邻两字
  for (const w of String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!w) continue;
    if (/\p{Script=Han}/u.test(w)) {
      for (const part of w.split(/(?<=\p{Script=Han})(?=[^\p{Script=Han}])|(?<=[^\p{Script=Han}])(?=\p{Script=Han})/u)) {
        if (/\p{Script=Han}/u.test(part)) for (let i = 0; i + 1 < part.length; i++) out.add(part.slice(i, i + 2));
        else if (part.length >= 3) out.add(part);
      }
    } else if (w.length >= 3) out.add(w);
  }
  return out;
}

/** 把最近的消息行归成事件清单：[{ name, n, first, last, max, topic, tickers, sample }]，最近有消息的排前面 */
export function storyList(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!r.story) continue;
    let o = m.get(r.story);
    if (!o) m.set(r.story, (o = { name: r.story, n: 0, first: r.ts, last: r.ts, max: 0, topics: new Map(), tickers: new Set(), sample: '', sampleScore: -1 }));
    o.n++;
    o.first = Math.min(o.first, r.ts);
    o.last = Math.max(o.last, r.ts);
    o.max = Math.max(o.max, r.score || 0);
    const tk = String(r.topic || '').split('|')[0].trim();
    if (tk) o.topics.set(tk, (o.topics.get(tk) || 0) + 1);
    for (const t of tickerSet(r.tickers)) o.tickers.add(t);
    if ((r.score || 0) > o.sampleScore) {
      o.sampleScore = r.score || 0;
      o.sample = String(r.title || '').replace(/\s+/g, ' ').slice(0, 110);
    }
  }
  return [...m.values()]
    .map((o) => ({ name: o.name, n: o.n, first: o.first, last: o.last, max: o.max, topic: [...o.topics].sort((a, b) => b[1] - a[1])[0]?.[0] || '', tickers: [...o.tickers].slice(0, 4), sample: o.sample }))
    .sort((a, b) => b.last - a.last);
}

/** 两件事有没有一点共同之处（同话题、同股票，或名字和样例标题里有共同的词）。模型说要并、这里却一点都对不上的，不并 */
export function plausible(a, b, common = () => false) {
  if (a.topic && topicKey(a.topic) === topicKey(b.topic) && !/^(other|market|markets|stocks|economy)$/.test(topicKey(a.topic))) return true;
  if (a.tickers.some((t) => b.tickers.includes(t))) return true;
  const ga = grams(a.name + ' ' + a.sample);
  const gb = grams(b.name + ' ' + b.sample);
  let n = 0;
  // 清单里到处都是的词（特朗普、法官、关税）不算共同之处
  for (const g of ga) if (gb.has(g) && !common(g)) n++;
  return n >= 2;
}

/** 清单里出现在 5 件以上事件中的词算“到处都是” */
export function commonGrams(list) {
  const df = new Map();
  for (const s of list) for (const g of grams(s.name + ' ' + s.sample)) df.set(g, (df.get(g) || 0) + 1);
  return (g) => (df.get(g) || 0) >= 5;
}

const bj = (ts) => new Date(ts + 8 * H).toISOString().slice(5, 16).replace('T', ' ');
export const listText = (list, fresh = null) =>
  list.map((s, i) => `${i + 1}${fresh && fresh.has(s.name) ? '*' : ''}. ${s.name} | ${s.topic || '-'} | ${s.tickers.join(',') || '-'} | ${s.n} | ${bj(s.first)} | ${s.sample}`).join('\n');

/** 解析模型给的显示标题：{ 事件名: { zh, en } } */
export function parseTitles(text, list) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  const out = {};
  if (!m) return out;
  try {
    const j = JSON.parse(m[0]);
    for (const t of Array.isArray(j.titles) ? j.titles : []) {
      const s = Array.isArray(t) ? list[Number(t[0]) - 1] : null;
      const tidy = (x, n) => String(x || '').replace(/[<>|]/g, '').replace(/\s+/g, ' ').replace(/[。.，,；;：:]+$/, '').trim().slice(0, n);
      const zh = tidy(t?.[1], 22);
      const en = tidy(t?.[2], 90);
      if (s && (zh.length >= 4 || en.length >= 6)) out[s.name] = { zh: zh.length >= 4 ? zh : undefined, en: en.length >= 6 ? en : undefined };
    }
  } catch {}
  return out;
}

/** 解析模型的回答：[[1,3],[2,5,6]]；编号越界、重复的丢掉，只剩一个的组丢掉 */
export function parseGroups(text, n) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(j.groups)) return null;
  const used = new Set();
  const out = [];
  for (const g of j.groups) {
    if (!Array.isArray(g)) continue;
    const ids = [];
    for (const x of g) {
      const k = Number(x);
      if (Number.isInteger(k) && k >= 1 && k <= n && !used.has(k)) {
        used.add(k);
        ids.push(k - 1);
      }
    }
    if (ids.length >= 2) out.push(ids);
  }
  return out;
}

/**
 * 把模型给的分组变成“谁并进谁”：每组里消息最多的那件留下（一样多就留最早的），其余并进去。
 * 和留下的那件一点共同之处都没有的不并。返回 [{ canon, aliases: [name] }]
 */
export function planMerges(list, groups) {
  const out = [];
  const common = commonGrams(list);
  for (const g of groups) {
    const items = g.map((i) => list[i]);
    const canon = items.slice().sort((a, b) => b.n - a.n || b.max - a.max || a.first - b.first)[0];
    const aliases = items.filter((s) => s !== canon && plausible(canon, s, common)).map((s) => s.name);
    if (aliases.length) out.push({ canon: canon.name, aliases });
  }
  return out;
}

/** 旧名字 → 并入的事件名（连着并了几次的一路追到底） */
export function resolveAlias(name, alias) {
  let x = name;
  for (let i = 0; i < 6 && alias && alias[x] && alias[x].to !== x; i++) x = alias[x].to;
  return x;
}

let aliasMemo = { at: 0, map: {} };
/** 读并名表（本实例缓存 3 分钟） */
export async function storyAlias(env, now = Date.now()) {
  if (now - aliasMemo.at < 3 * 60_000) return aliasMemo.map;
  const r = await metaGet(env, 'story_alias');
  aliasMemo = { at: now, map: r?.v?.alias || {} };
  return aliasMemo.map;
}
export function _resetAlias() {
  aliasMemo = { at: 0, map: {} };
}

/**
 * 事件并了以后，事件榜上的那一行也跟着并：留下的那件还没有编号时，直接把并掉的那行改名（状态、深读、稿件都跟过来）；
 * 两边都有编号时，留下状态更靠后的那个（用户动过的），另一行隐藏。事件榜的表还没建时什么都不做。
 */
async function followMerge(env, canon, aliases) {
  const order = ['new', 'skip', 'follow', 'write', 'drafted', 'published'];
  try {
    for (const a of aliases) {
      const from = (await env.DB.prepare('SELECT id, state FROM events WHERE name = ? AND gone = 0').bind(a).all()).results?.[0];
      if (!from) continue;
      const to = (await env.DB.prepare('SELECT id, state, gone FROM events WHERE name = ?').bind(canon).all()).results?.[0];
      if (!to) await env.DB.prepare('UPDATE events SET name = ? WHERE id = ?').bind(canon, from.id).run();
      else if (to.gone || order.indexOf(from.state) > order.indexOf(to.state)) {
        // 用户动过的是并掉的那行：让它接着用留下的名字，原来那行隐藏
        await env.DB.prepare('UPDATE events SET name = ?, gone = 1 WHERE id = ?').bind('x:' + to.id + ':' + canon, to.id).run();
        await env.DB.prepare('UPDATE events SET name = ? WHERE id = ?').bind(canon, from.id).run();
      } else await env.DB.prepare('UPDATE events SET gone = 1 WHERE id = ?').bind(from.id).run();
    }
  } catch {}
}

/**
 * 看一遍还在进行的事件，把同一件事的并起来。
 * dry=true 只返回打算怎么并，不改数据库。force=true 即使没有新事件也看一遍。
 * 返回 { ok, list: 件数, fresh: 新事件数, merges: [{ canon, aliases }], moved: 改了几条消息 }
 */
export async function mergeStories(env, { now = Date.now(), dry = false, force = false } = {}) {
  const c = mergeConfig(env);
  const since = now - c.windowH * H;
  // 走 5 分以上消息的部分索引（idx_items_brief），一次几百行
  const rows = (await env.DB.prepare('SELECT story, title, ts, score, topic, tickers FROM items WHERE ts > ? AND score >= 5 AND dup_of IS NULL AND story IS NOT NULL ORDER BY ts DESC LIMIT 1500').bind(since).all()).results;
  const list = storyList(rows).slice(0, c.maxList);
  const st = (await metaGet(env, 'story_alias'))?.v || {};
  const seen = st.seen || {};
  const alias = st.alias || {};
  const titles = st.titles || {};
  // 新事件，加上还没有显示标题的旧事件（一次最多补 30 个）
  const fresh = list.filter((s) => !seen[s.name]);
  const untitled = new Set(fresh.map((s) => s.name));
  for (const s of list) if (untitled.size < 30 && !titles[s.name]) untitled.add(s.name);
  if (list.length < 2 || (!fresh.length && !force)) return { ok: true, list: list.length, fresh: 0, merges: [], moved: 0 };
  if (!claudeUp(env)) return { ok: false, error: 'claude_down', list: list.length, fresh: fresh.length };
  const res = await claudeText(env, { system: MERGE_SYSTEM, user: listText(list, untitled), maxTokens: 7000, kind: 'merge', think: true, effort: 'medium', timeout: 60_000 });
  const groups = res && parseGroups(res.text, list.length);
  if (!groups) return { ok: false, error: 'no_answer', list: list.length, fresh: fresh.length };
  const merges = planMerges(list, groups);
  const got = parseTitles(res.text, list);
  if (dry) return { ok: true, dry: true, list: list.length, fresh: fresh.length, merges, titles: got, names: list.map((s) => `${s.name} (${s.n})`) };
  for (const k of Object.keys(got)) titles[k] = { ...got[k], at: now };

  let moved = 0;
  for (const m of merges) {
    // 把并掉的名字下面的消息改到留下的那件上（包括 5 分以下、靠选题分或吸睛度归进来的）
    const ids = (await env.DB.prepare(`SELECT id FROM items WHERE ts > ? AND story IN (${m.aliases.map(() => '?').join(',')}) LIMIT 400`).bind(since - 12 * H, ...m.aliases).all()).results.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 50) {
      const part = ids.slice(i, i + 50);
      await env.DB.prepare(`UPDATE items SET story = ? WHERE id IN (${part.map(() => '?').join(',')})`).bind(m.canon, ...part).run();
    }
    moved += ids.length;
    for (const a of m.aliases) alias[a] = { to: m.canon, at: now };
    await followMerge(env, m.canon, m.aliases);
    // 留下的那件还没有简报、并掉的有：把简报挪过去，免得重写一遍
    try {
      const have = (await env.DB.prepare('SELECT key FROM briefs WHERE key = ?').bind('~' + m.canon).all()).results.length;
      if (!have) await env.DB.prepare('UPDATE briefs SET key = ? WHERE key = ?').bind('~' + m.canon, '~' + m.aliases[0]).run();
    } catch {}
  }
  for (const s of list) seen[s.name] = now;
  for (const k of Object.keys(seen)) if (now - seen[k] > (c.windowH + 12) * H) delete seen[k];
  for (const k of Object.keys(alias)) if (now - alias[k].at > 72 * H) delete alias[k];
  for (const k of Object.keys(titles)) if (now - (titles[k].at || 0) > 96 * H) delete titles[k];
  await metaSet(env, 'story_alias', { seen, alias, titles }, now);
  aliasMemo = { at: now, map: alias };
  return { ok: true, list: list.length, fresh: fresh.length, merges, moved };
}
