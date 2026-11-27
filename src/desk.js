// 选题台（小试）：
// 1) “选题会”：每天两次（沙特开盘前、美股开盘前）加上随时手动，用更强的模型把最近 12 小时的要闻放在一起看，
//    给出前 5 个选题和理由，显示在首页最上面；
// 2) 用户点“就写这个 / 这个不对”，选择记进数据库，以后用来校准排序；
// 3) 选中的选题按需生成“专题档案”：固定的几个部分，每句标来源，网页上标明每部分是基于正文还是只有标题。
//    用户可以把自己读得到的全文贴进来，档案会更扎实。
// 读者设定：交易美股或沙特股的人（不一定是沙特人）（只涉及其中一个市场的事也可以入选）；app 里的文章用英语，每天 1 到 2 篇。

import { claudeText, claudeUp, claudeUsd, claudeState } from './claude.js';
import { storyAlias, resolveAlias } from './events.js';
import { attachFullText, fullTextPlan, fullTextConfig } from './fulltext.js';
import { bjTime, eventKeys } from './brief.js';
import { metaGet, metaSet } from './dbguard.js';
import { eventTopic, evDrafted, applyDeskRun } from './board.js';
import { countedAs, originOf } from './origin.js';

const H = 3_600_000;

export const DESK_TABLES = [
  'CREATE TABLE IF NOT EXISTS desk_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, slot TEXT, n INTEGER, topics TEXT, usd REAL, model TEXT)',
  'CREATE TABLE IF NOT EXISTS desk_picks (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, run_id INTEGER NOT NULL, rank INTEGER NOT NULL, verdict TEXT NOT NULL, title TEXT, note TEXT)',
  'CREATE TABLE IF NOT EXISTS desk_dossiers (run_id INTEGER NOT NULL, rank INTEGER NOT NULL, title TEXT, body TEXT, srcs TEXT, pasted TEXT, created INTEGER, updated INTEGER, writes INTEGER NOT NULL DEFAULT 0, usd REAL, PRIMARY KEY (run_id, rank))',
  // 已写记录：榜上的选题点“标为已写”，或者手动记一条榜外的题（off = 1）
  'CREATE TABLE IF NOT EXISTS desk_written (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, title TEXT, run_id INTEGER, rank INTEGER, ids TEXT, stories TEXT, off INTEGER NOT NULL DEFAULT 0, note TEXT, gone INTEGER NOT NULL DEFAULT 0)',
  // 候选新信源：调研时发现常出好内容的来源，先记下来，用户确认后再加进抓取
  'CREATE TABLE IF NOT EXISTS desk_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, name TEXT, note TEXT, gone INTEGER NOT NULL DEFAULT 0)',
  // 英文稿：标题、摘要、正文、形式卡片、发稿前要核对的地方
  'CREATE TABLE IF NOT EXISTS desk_drafts (run_id INTEGER NOT NULL, rank INTEGER NOT NULL, format TEXT, heads TEXT, summary TEXT, body TEXT, cards TEXT, checks TEXT, created INTEGER, updated INTEGER, writes INTEGER NOT NULL DEFAULT 0, usd REAL, PRIMARY KEY (run_id, rank))',
];

export function deskConfig(env) {
  return {
    on: env.DESK !== 'false',
    auto: env.DESK_AUTO !== 'false', // "false"：不按时间自动开会，只在用户点“现在开一次”时开
    monthUsd: Number(env.CLAUDE_MONTHLY_USD || 100), // 每月的 Claude 额度，只用来在页面上显示占了多少
    model: env.DESK_MODEL || 'claude-sonnet-5-5',
    windowH: Number(env.DESK_WINDOW_HOURS || 24), // 选题会看最近多少小时
    minScore: Number(env.DESK_ITEM_MIN || 6), // 突发分多少以上的快讯进选题会
    minPick: Number(env.DESK_PICK_MIN || 6), // 选题分多少以上的（观点、深度分析）也进选题会，哪怕突发分很低
    maxTopics: Number(env.DESK_MAX_TOPICS || 8),
    maxItems: Number(env.DESK_MAX_ITEMS || 220), // 一次最多给模型看多少条
    dailyUsd: Number(env.DESK_DAILY_USD || 0.5), // 选题会 + 档案 + 英文稿每天最多花多少美元
    draftModel: env.DESK_DRAFT_MODEL || env.DESK_MODEL || 'claude-sonnet-5-5',
    draftMin: Number(env.DESK_DRAFT_MIN || 5), // 同一篇稿至少隔多少分钟才重写
    closeSlot: env.DESK_CLOSE_SLOT === 'true', // 美股收盘后再开一场（位置留好，默认不开）
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
  // 美股收盘后一场：位置先留好，DESK_CLOSE_SLOT="true" 才开；具体几点等用户定
  { slot: 'close', tz: 'America/New_York', at: 16 * 60 + 30, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], opt: true },
];
/** 现在是不是在某一场选题会的时间窗里（开始后 25 分钟内）；是则返回 { slot, day } */
export function deskSlot(now, close = false) {
  for (const s of SLOTS) {
    if (s.opt && !close) continue;
    const p = parts(now, s.tz);
    if (s.days.includes(p.wd) && p.min >= s.at && p.min < s.at + 25) return { slot: s.slot, day: p.day };
  }
  return null;
}
/** 下一场定时选题会 { slot, ts } */
export function nextSlot(now, close = false) {
  let t = Math.ceil(now / (30 * 60_000)) * 30 * 60_000;
  for (let k = 0; k < 6 * 48; k++, t += 30 * 60_000) {
    for (const s of SLOTS) {
      if (s.opt && !close) continue;
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
    return `[${list.length}] ${bjTime(i.ts)} | ${i.source}${articles.has(i.source) ? '（深度文章）' : ''} | 突发${Math.round((i.score || 0) * 10) / 10}${i.pick != null ? ' 选题' + Math.round(i.pick * 10) / 10 : ''}${(i.hook || 0) >= 2 ? ' 吸睛' + i.hook : ''}${who ? ' | 观点方：' + who : ''}${i.tickers ? ' | ' + i.tickers : ''} | ${clean(i.title).slice(0, 260)}${b.length >= 40 ? '\n     摘要：' + b.slice(0, 240) : ''}`;
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
  // 吸睛资讯：上面没列到的也在这里列出来，保证选题会看得见
  const seen = new Set(list.map((i) => i.id));
  const hooks = rows.filter((r) => (r.hook || 0) >= 2 && !seen.has(r.id)).sort((a, b) => (b.hook || 0) - (a.hook || 0) || b.ts - a.ts).slice(0, 30);
  if (hooks.length) {
    out.push('## 吸睛资讯：标题本身很抓眼球的消息（大数字、名人、惊人说法），分量不一定大');
    for (const i of hooks) out.push(line(i) + (i.story ? `\n     所属事件：${i.story}` : ''));
  }
  return { text: out.join('\n'), list, groups: gs, views: isView.size };
}

export const DESK_SYSTEM = `你是一家财经 app 的选题主编。读者是交易美股或沙特股（Tadawul）的人，不一定是沙特人，只交易其中一个市场的也很多，文章用英语发布，每天只做 1 到 2 篇有分量的稿子。

用户消息是一个新闻看板在过去 24 小时里收集到的材料，分两部分：前面是突发事实，已经按"同一件事"粗略归好；最后一节是"观点线索"，是机构、知名人物和深度媒体对市场的看法。有的条目带“吸睛N”（2 或 3），表示标题本身很抓眼球（大数字、名人、惊人说法），最后可能还有一节“吸睛资讯”。每条前面有编号 [n]，时间是北京时间。"突发N"是这条消息有多突发、多重大，"选题N"是它作为写稿原料的价值（都是 10 分最高）。大部分只有标题，少数带一两句摘要。

你的任务：开一次选题会，从中选出最值得做成文章的 5 到 8 个选题，按值得做的程度从高到低排列。

选题有两种来路，都要考虑：
- 一件大事本身。这时把观点线索里和它有关的看法并进来，文章才有深度（比如"加息预期升温"这件事，并入高盛、摩根大通的两条看法）。
- 几条观点线索合成的一个题（比如几家机构对同一个问题的分歧，或者一个有分量的反常识判断）。单条观点通常不够，但有具体数字或大胆判断、又切中当前市场焦点的，可以单独成题。

吸睛资讯怎么用：
- 它本身分量可能不大，但读者爱点。先看它能不能挂到一个已经够强的选题上，当补充材料，甚至当发布标题的一部分；能就写进那个选题的 "hooks"。
- 几条吸睛资讯加上清单里的其他材料，如果能合成一个说得通的题，也可以单独成题，在理由里说明是靠哪条吸睛资讯立起来的。
- 只有噱头、和读者能买卖的东西没有关系的，不用。

编辑部的禁区（用户定的，必须遵守）：
- 不做以“沙特境内遭到袭击”（导弹、无人机、武装组织袭击沙特的城市或设施）为主题的选题，这类事件太敏感。相关消息不要单独成题，也不要作为别的选题的主事实；如果它带动了油价或大盘，可以只在讲油价或大盘的选题里一句带过市场反应。
- 这条禁区只管“沙特境内遭袭”这类负面事件。发生在沙特境外、但影响油价或航运的事（比如霍尔木兹海峡的油轮事故）照常选。有沙特参与的正面事件（成功拦截或防御、出席或主办会议、达成协议等），只要分量够得上上面的标准，也照常选，角度放在正面的结果和对市场的意义上。

怎么判断"值得做"（按重要性排列）：
1. 市场分量：这件事会不会真的影响价格和资金流向（指数级别、大市值公司、油价、美联储和利率、美元、沙特本地的阿美 / PIF / 银行 / 交易所规则 / 大型 IPO）。
2. 对这位读者的相关性：这些读者为什么要关心。常见的连接点：油价和 OPEC+；美联储利率（里亚尔盯住美元，沙特央行跟随加减息）；海湾主权基金和沙特企业参与的交易；海湾散户重仓的美股大公司；Tadawul 上市公司的公告和业绩。一件事只涉及美股或只涉及沙特股都可以入选，不要求两个市场都沾边；但和这位读者能买卖的东西完全没有连接点的事（比如纯粹的美国地方新闻）要降级。
3. 还在发展、有悬念：正在推进、接下来有明确节点的事，比已经尘埃落定的事更值得做。
4. 能不能写出一篇像样的文章：有没有清楚的角度，材料够不够。只有一两条标题的事可以入选，但要在理由里直说材料很薄。

注意：
- 报道条数多不等于市场更关注，媒体之间大量互相转载。条数和"几家媒体"只是很弱的参考。
- 看板的归类不一定对：同一件事可能被分在几个"事件"下，要合并成一个选题；一个"事件"下如果混了几件事，只取你要的那几条。5 个选题不能有两个讲的是同一件事。
- 只能依据清单里的内容。理由里可以有你的判断（为什么重要、可以从哪个角度写），但不准补充清单里没有的事实、数字或背景，也不预测涨跌。
- 例行的行情综述（"美股收高""早盘要闻汇总"）不算选题，除非背后有一件具体的事。
- 清单里够格的事不足 5 件时，有几件写几件，不要凑数。
- "facts" 是让主编不点开也能看懂这件事的三条关键事实：每条一句话（不超过 40 个字），必须出自清单里的某一条，并给出那条的编号。
- "hooks" 是挂在这个选题上的吸睛资讯，最多 3 条，只能用带“吸睛”标记的条目，没有就给空数组，不要硬凑。
- "write" 标出今天最值得动笔的选题：最多 2 个，通常就是排在最前面的 1 到 2 个；如果今天没有真正够分量的，可以一个都不标。

只输出一个 JSON 对象，不要任何别的文字，不要代码块标记：
{"topics":[{"title_zh":"不超过 26 个字的中文选题名，说清是哪件事","title_en":"English topic name, at most 12 words","why_zh":"两句话。第一句：发生了什么、市场为什么在意。第二句：这些读者为什么要关心、可以从哪个角度写；材料很薄时在这里直说。","why_en":"The same two sentences in English.","angle_en":"A working English headline for the article, at most 14 words","market":"US 或 Saudi 或 Both","tickers":["最相关的股票代码，最多 4 个，没有就空数组"],"facts":[["一句话事实",清单编号],["一句话事实",清单编号],["一句话事实",清单编号]],"hooks":[["这条为什么吸睛、可以怎么用（不超过 30 个字）",清单编号]],"items":[这个选题用到的清单编号（事实和观点线索都算），最多 18 个],"write":true}]}`;

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
    const sc = new Map();
    items.forEach((i) => i.story && sc.set(i.story, (sc.get(i.story) || 0) + 1));
    const stories = [...sc.keys()].sort((a, b) => sc.get(b) - sc.get(a)); // 报道最多的事件排前面
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
      tsl: items.map((i) => i.ts),
      pk: Math.max(0, ...items.map((i) => i.pick || 0)) || undefined,
      dirs: items.reduce((a, i) => a + (i.dir > 0 ? 1 : i.dir < 0 ? -1 : 0), 0),
      // 三条关键事实（各带出处）和并进来的观点线索：选题卡上直接显示
      facts: (Array.isArray(t.facts) ? t.facts : [])
        .map((f) => (Array.isArray(f) ? { t: str(f[0], 120), i: list[Number(f[1]) - 1] } : null))
        .filter((f) => f && f.t && f.i)
        .slice(0, 3)
        .map((f) => ({ t: f.t, id: f.i.id, src: outlet(f.i.source), url: f.i.url || undefined })),
      // 挂在这个选题上的吸睛资讯：卡片上作为“写这个的理由之一”列出来
      hooks: (Array.isArray(t.hooks) ? t.hooks : [])
        .map((f) => (Array.isArray(f) ? { t: str(f[0], 90), i: list[Number(f[1]) - 1] } : null))
        .filter((f) => f && f.i && (f.i.hook || 0) >= 2)
        .slice(0, 3)
        .map((f) => ({ t: f.t, title: clean(f.i.title).slice(0, 140), id: f.i.id, src: outlet(f.i.source), url: f.i.url || undefined })),
      views: items
        .filter((i) => i.kind === 'v')
        .slice(0, 6)
        .map((i) => ({ who: realWho(i.who, i.source), t: clean(i.title).slice(0, 120), dir: i.dir || 0, id: i.id, url: i.url || undefined })),
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
    const rows = (await env.DB.prepare("SELECT input_tokens, output_tokens FROM claude_usage WHERE day = ? AND kind IN ('desk', 'dossier', 'draft')").bind(new Date(now).toISOString().slice(0, 10)).all()).results;
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
  try {
    await env.DB.prepare('ALTER TABLE desk_runs ADD COLUMN mood TEXT').run();
  } catch {} // 已经有这一列
  tablesOk = true;
}

/** 开一次选题会。返回 { ok, run } 或 { ok: false, error } */
export async function runDesk(env, { now = Date.now(), slot = 'manual', articles = new Set() } = {}) {
  const c = deskConfig(env);
  if (!c.on) return { ok: false, error: 'off' };
  if (!claudeUp(env)) return { ok: false, error: 'claude_down' };
  await ensureTables(env);
  const spent = await spentToday(env, now);
  // 定时的选题会比临时写稿要紧：白天写稿把额度用到上限后，定时会还能再用半份额度
  if (spent >= c.dailyUsd * (slot === 'manual' ? 1 : 1.5)) return { ok: false, error: 'budget', spent };
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
  // 吸睛的资讯（标题党的大数字、惊人说法）：不管突发分和选题分高低都留住，走部分索引 idx_items_hook；v15 之前没有这一列时跳过
  try {
    const have = new Map(rows.map((r) => [r.id, r]));
    const hooks = (
      await env.DB.prepare('SELECT id, source, title, body, url, ts, score, confirms, dir, tickers, topic, story, pick, kind, who, hook FROM items WHERE ts > ? AND hook >= 2 AND dup_of IS NULL ORDER BY ts DESC LIMIT 200')
        .bind(now - c.windowH * H)
        .all()
    ).results;
    for (const p of hooks) {
      const o = have.get(p.id);
      if (o) o.hook = p.hook;
      else rows.push(p);
    }
  } catch {}
  if (rows.length < 5) return { ok: false, error: 'too_few', n: rows.length };
  const inp = deskInput(rows, articles, c.maxItems);
  const user = `现在是北京时间 ${bjTime(now)}。过去 ${c.windowH} 小时里够格的材料共 ${rows.length} 条（其中观点线索 ${inp.views} 条），下面列出 ${inp.list.length} 条：\n\n${inp.text}`;
  // 编辑在事件榜上已经表过态的事：告诉选题会，免得把否掉的、发过的又推荐一遍
  let marks = '';
  try {
    const ev = (await env.DB.prepare("SELECT name, title, state, note FROM events WHERE gone = 0 AND state != 'new' AND state_ts > ? ORDER BY state_ts DESC LIMIT 40").bind(now - 72 * H).all()).results;
    const nm = (e) => clean(/^[gi]:/.test(e.name) ? e.title || '' : e.name).slice(0, 40);
    const ok = (e) => nm(e).length > 1;
    const grp = (st) => ev.filter((e) => st.includes(e.state) && ok(e));
    const line = (label, list, withNote) => (list.length ? `${label}：${list.map((e) => nm(e) + (withNote && e.note ? `（理由：${clean(e.note).slice(0, 40)}）` : '')).join('；')}\n` : '');
    marks = line('编辑决定不写', grp(['skip']), true) + line('编辑已经发布过', grp(['published'])) + line('编辑决定要写或已经在写', grp(['write', 'drafted'])) + line('编辑在关注', grp(['follow']));
    if (marks) marks = `\n\n编辑已经表过态的事件（按事件名对应材料里的“事件”）：\n${marks}规则：“决定不写”和“已经发布过”的不要再推荐，除非之后出现了足以改变判断的重大新进展，这时在理由里写明新进展是什么；“决定要写”和“在关注”的说明编辑对这类题感兴趣，够格就可以推荐，但不要因此降低标准。`;
  } catch {}
  const res = await claudeText(env, { system: DESK_SYSTEM, user: user + marks, maxTokens: 16000, kind: 'desk', effort: 'medium', model: c.model, timeout: 150_000 });
  if (!res) return { ok: false, error: 'model', detail: claudeState().last_error };
  const topics = parseDesk(res.text, inp.list, c.maxTopics);
  if (!topics) return { ok: false, error: 'parse' };
  const usd = claudeUsd(res.usage.input, res.usage.output);
  let prev = [];
  try {
    prev = (await env.DB.prepare('SELECT id, ts, topics, mood FROM desk_runs WHERE ts > ? ORDER BY id DESC LIMIT 8').bind(now - 96 * H).all()).results.map((x) => ({ id: x.id, ts: x.ts, topics: safeJson(x.topics, []), mood: safeJson(x.mood, null) }));
  } catch {}
  topicStatus(topics, prev, now);
  const mood = deskMood(rows, prev[0]?.mood || null);
  mood.loose = looseHooks(rows, topics);
  const r = await env.DB.prepare('INSERT INTO desk_runs (ts, slot, n, topics, usd, model, mood) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(now, slot, rows.length, JSON.stringify(topics), usd, c.model, JSON.stringify(mood)).run();
  const id = r.meta?.last_row_id;
  try {
    if (prev[0] && id) await carryOver(env, prev[0], id, topics);
  } catch {}
  try {
    if (id) await applyDeskRun(env, { id, topics }, { now });
  } catch {}
  return { ok: true, run: { id, ts: now, slot, n: rows.length, topics, usd, mood } };
}

/**
 * 新开一场选题会后，上一场已经做的事不能丢：同一件事的选择（就写这个 / 这个不对）、档案、英文稿都带到新一场对应的选题上。
 * 每个旧选题最多带给一个新选题（重合最多的那个）。带过来的选择保留原来的时间，校准时按时间去重。
 */
async function carryOver(env, old, newId, topics) {
  const used = new Set();
  const map = [];
  for (const t of topics) {
    const m = (old.topics || []).filter((o) => !used.has(o.rank) && sameTopic(t, o)).sort((a, b) => closeness(t, b) - closeness(t, a))[0];
    if (m) {
      used.add(m.rank);
      map.push([m.rank, t.rank]);
    }
  }
  if (!map.length) return 0;
  const last = {};
  for (const p of (await env.DB.prepare('SELECT rank, verdict, ts, title, note FROM desk_picks WHERE run_id = ? ORDER BY id').bind(old.id).all()).results) {
    if (p.verdict === 'pick' || p.verdict === 'pass') last[p.rank] = p;
    else if (p.verdict === 'clear') delete last[p.rank];
  }
  for (const [from, to] of map) {
    await env.DB.prepare('INSERT OR IGNORE INTO desk_dossiers (run_id, rank, title, body, srcs, pasted, created, updated, writes, usd) SELECT ?, ?, title, body, srcs, pasted, created, updated, writes, 0 FROM desk_dossiers WHERE run_id = ? AND rank = ?').bind(newId, to, old.id, from).run();
    await env.DB.prepare('INSERT OR IGNORE INTO desk_drafts (run_id, rank, format, heads, summary, body, cards, checks, created, updated, writes, usd) SELECT ?, ?, format, heads, summary, body, cards, checks, created, updated, writes, 0 FROM desk_drafts WHERE run_id = ? AND rank = ?').bind(newId, to, old.id, from).run();
    const p = last[from];
    if (p) await env.DB.prepare('INSERT INTO desk_picks (ts, run_id, rank, verdict, title, note) VALUES (?, ?, ?, ?, ?, ?)').bind(p.ts, newId, to, p.verdict, p.title, p.note || '').run();
  }
  return map.length;
}

const mem = { done: '', busy: false };
/** 每分钟的定时任务里调用：到点了（且今天这一场还没开过）就开一次。不在时间窗里时不碰数据库。 */
export async function deskCron(env, { now = Date.now(), articles = new Set() } = {}) {
  const c = deskConfig(env);
  const s = c.on && c.auto && deskSlot(now, c.closeSlot);
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
  const out = { now, on: c.on, run: null, picks: {}, dossiers: {}, pasted: {}, next: c.auto ? nextSlot(now, c.closeSlot) : null, manual_min: c.manualMin, drafts: {}, written: [], follow: {}, mood: null, sources: [] };
  if (!c.on) return out;
  try {
    let r;
    try {
      r = (await env.DB.prepare('SELECT id, ts, slot, n, topics, mood FROM desk_runs ORDER BY id DESC LIMIT 1').all()).results?.[0];
    } catch {
      r = (await env.DB.prepare('SELECT id, ts, slot, n, topics FROM desk_runs ORDER BY id DESC LIMIT 1').all()).results?.[0]; // 还没有 mood 列
    }
    if (!r) return out;
    out.run = { id: r.id, ts: r.ts, slot: r.slot, n: r.n, topics: safeJson(r.topics, []) };
    out.mood = safeJson(r.mood, null);
    const picks = (await env.DB.prepare('SELECT rank, verdict, ts, note FROM desk_picks WHERE run_id = ? ORDER BY id').bind(r.id).all()).results;
    for (const p of picks) {
      if (p.verdict === 'fu_clear') delete out.follow[p.rank];
      else if (p.verdict === 'fu_yes' || p.verdict === 'fu_no') out.follow[p.rank] = { id: Number(p.note) || 0, yes: p.verdict === 'fu_yes' };
      else if (p.verdict === 'clear') delete out.picks[p.rank];
      else out.picks[p.rank] = { verdict: p.verdict, ts: p.ts, note: p.note || undefined };
    }
    const ds = (await env.DB.prepare('SELECT rank, title, body, srcs, pasted, created, updated, writes FROM desk_dossiers WHERE run_id = ?').bind(r.id).all()).results;
    for (const d of ds) {
      const pasted = safeJson(d.pasted, []).map((p) => ({ label: p.label, len: p.text.length }));
      // 只贴了全文、还没生成档案的：只记贴了什么
      if (pasted.length) out.pasted[d.rank] = pasted;
      if (d.body) out.dossiers[d.rank] = { title: d.title, body: d.body, srcs: safeJson(d.srcs, []), updated: d.updated, writes: d.writes, pasted };
    }
  } catch {
    // 表还没建（还没开过选题会）
  }
  try {
    const dr = (await env.DB.prepare('SELECT rank, format, heads, summary, body, cards, checks, updated, writes FROM desk_drafts WHERE run_id = ?').bind(out.run.id).all()).results;
    for (const d of dr) out.drafts[d.rank] = { format: d.format, heads: safeJson(d.heads, []), summary: d.summary, body: d.body, cards: safeJson(d.cards, []), checks: safeJson(d.checks, []), updated: d.updated, writes: d.writes };
    const wr = (await env.DB.prepare('SELECT id, ts, title, run_id, rank, ids, stories, off, note FROM desk_written WHERE gone = 0 AND ts > ? ORDER BY id DESC LIMIT 40').bind(now - 21 * 24 * H).all()).results;
    out.written = wr.map((w) => ({ id: w.id, ts: w.ts, title: w.title, run: w.run_id, rank: w.rank, off: !!w.off, note: w.note || undefined }));
    // 每个选题对一下已写记录：就是这一场标的 → written；和以前写过的重合 → maybe（只是“可能是后续”，由用户确认）
    for (const t of out.run.topics) {
      const m = matchWritten(t, out.run.id, wr);
      if (m) t.wr = m;
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
  return out;
}

/**
 * 给没带管理密码的访客看的版本：选题榜本身可以看，没发表的稿子、档案、已写记录、否决理由都不给。
 */
export function deskPublic(st) {
  if (!st) return st;
  const picks = {};
  for (const k of Object.keys(st.picks || {})) picks[k] = { verdict: st.picks[k].verdict, ts: st.picks[k].ts };
  const run = st.run && { ...st.run, topics: st.run.topics.map(({ wr, ...t }) => t) };
  return { ...st, run, picks, dossiers: {}, drafts: {}, pasted: {}, written: [], follow: {}, sources: [], cost: undefined, fulltext: undefined, guest: true };
}

/** 取出一个选题：run = 0 时是事件榜上的一件事（rank = 事件编号），否则是某一场选题会里的第几个。返回 { r: { id }, t } 或 null */
async function topicOf(env, run, rank, now) {
  if (Number(run) === 0) {
    const t = await eventTopic(env, rank, now);
    return t ? { r: { id: 0, ts: now }, t } : null;
  }
  const r = (await env.DB.prepare('SELECT id, ts, topics FROM desk_runs WHERE id = ?').bind(Number(run) || 0).all()).results?.[0];
  const t = r && safeJson(r.topics, []).find((x) => x.rank === Number(rank));
  return t ? { r, t } : null;
}

/** 记下用户的选择：pick = 就写这个，pass = 这个不对，clear = 撤销 */
export async function deskPick(env, { run, rank, verdict, note = '', now = Date.now() }) {
  if (!['pick', 'pass', 'clear', 'fu_yes', 'fu_no', 'fu_clear'].includes(verdict)) return { ok: false, error: 'bad_verdict' };
  await ensureTables(env);
  const r = (await env.DB.prepare('SELECT id, topics FROM desk_runs WHERE id = ?').bind(Number(run) || 0).all()).results?.[0];
  const t = r && safeJson(r.topics, []).find((x) => x.rank === Number(rank));
  if (!t) return { ok: false, error: 'no_topic' };
  await env.DB.prepare('INSERT INTO desk_picks (ts, run_id, rank, verdict, title, note) VALUES (?, ?, ?, ?, ?, ?)').bind(now, r.id, t.rank, verdict, t.title_zh, String(note || '').slice(0, 300)).run();
  return { ok: true };
}

/* ---------- 专题档案 ---------- */

export const DOSSIER_SYSTEM = `你是一家财经 app 的资深编辑。读者是交易美股或沙特股（Tadawul）的人，不一定是沙特人，只交易其中一个市场的也很多。你要为主编选定的一个选题整理一份"专题档案"：先让主编几分钟内看懂这件事，再作为写英文稿的底稿。

用户消息里是这个选题目前收集到的全部材料。每条前面有编号 [S1]、[S2]…，时间为北京时间；每条标明了材料的厚度：〔正文〕有成段原文，〔摘要〕只有一两句，〔仅标题〕只有标题。主编贴进来的全文编号是 [P1]、[P2]…。

硬性规则（准确性第一）：
1. 事实、数字、引语只能来自材料里明确写出的内容。材料大多是中文转述：英文部分只有当英文原话出现在材料或用户贴入的全文里时才能加引号，其余一律转述，不要把中文转述翻回英文再加引号。不准补充任何你自己知道的背景、数字、人物身份、历史对比。材料没说的，就不写。
2. 除"为什么重要"里的推断、"还不知道什么"和"可以怎么写"之外，每一句话结尾都用方括号标来源编号，如 [S3] 或 [S3][P1]。一句话里的每个事实都要能在所标来源里找到。
3. 〔仅标题〕的材料只能支持标题字面上说的那一点，不能从标题推出细节。评论、分析文章的标题只是作者观点，要写成"某某文章认为……"。
4. "据某某报道""知情人士称"这类未经证实的消息，保留消息来源的措辞，不写成既成事实。标了“转述 X 的报道”的材料，说法算 X 的，不算转述它的那家媒体的；几条材料转述的是同一家的同一篇报道时，只算一个来源，不能当成互相印证。来源之间数字不一致时写明分歧并分别标注。
5. 观点要写明是谁的观点。档案本身不给投资建议、不预测涨跌。
6. 你自己的分析只允许出现在"为什么重要"里，并且每一句都以"推断："开头，推断必须建立在前面已标注来源的事实上。
7. 材料里混进了和这个选题无关的消息，忽略它们。
8. 材料不够支撑某个部分时，那个部分就写短，或者直接写"材料里没有"。宁可空着，不要凑。

结构固定为以下小标题，顺序不变：
## 一句话
（不超过 45 个字，说清发生了什么）
## 为什么重要
（2 到 4 句。先写有来源的事实：这件事的分量在哪里；再写对这些读者的意义。材料里没有直接讲到沙特或海湾的，用"推断："写出你认为的连接点，例如油价、利率与里亚尔盯住美元、海湾资金的持仓，没有合理的连接点就直说关系不大。）
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
- Angle: 一句话说明这篇文章对这些读者的切入点
- Outline: 4 到 5 条提纲，每条一行
- Before publishing: 发稿前必须先核实或补齐的 1 到 3 件事）

写作要求：前六个部分用简体中文，书面、凝练，不重复同一事实；外国人名、公司名用通行中文译名，没有通行译名的保留原文。只输出档案正文（Markdown），不要前言后语。`;

// 观点方必须是说话的机构或人；转载它的媒体（格隆汇、华尔街见闻、路透等）不算，遇到就留空
const RELAY = /格隆汇|华尔街见闻|智通|金十|财联社|Gelonghui|Wallstreetcn|Zhitong|Jin10|Reuters|Bloomberg|CNBC|WSJ|Wall Street Journal|Financial Times|Investing\.com/i;
export function realWho(who, source) {
  const w = String(who || '').trim();
  if (!w || RELAY.test(w)) return '';
  const o = outlet(source || '');
  return o && w.split('|').some((x) => x.trim() === o) ? '' : w;
}

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
  return all.map((i, k) => ({ n: k + 1, id: i.id, source: i.source, title: clean(i.title), body: bodyOf(i), ts: i.ts, url: i.url, score: i.score, k: thickness(i), art: i.art, from: originOf(i) || undefined }));
}

export function dossierText(srcs, pasted) {
  const a = srcs.map((s) => {
    const head = `[S${s.n}] ${bjTime(s.ts)} | ${s.source}${s.from ? '（转述 ' + s.from + ' 的报道）' : ''}${s.art ? '（深度文章）' : ''} | 〔${THICK[s.k]}〕${s.score != null && !s.art ? ` | ${Math.round(s.score * 10) / 10}分` : ''} | ${s.title}`;
    return s.k === 'h' ? head : `${head}\n    ${s.body.slice(0, s.full ? 3200 : 1800)}`;
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
  // 选题会之后被并进别的事件的名字：换成并入的那件
  const alias = await storyAlias(env, now).catch(() => ({}));
  const stories = [...new Set((t.stories || []).slice(0, 8).map((x) => resolveAlias(x, alias)))];
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

/** 编辑在事件页点了“这次不用”的消息（只对事件有效，记在 meta 表） */
async function exclOf(env, r, t) {
  if (!r || r.id !== 0) return new Set();
  try {
    const v = (await metaGet(env, 'ev_excl_' + t.rank))?.v;
    return new Set(Array.isArray(v) ? v : []);
  } catch {
    return new Set();
  }
}

/**
 * 写稿或深读之前先告诉编辑：会读哪些全文、哪些分量重但我们读不到（可以自己去拿来贴）、哪些被标了“这次不用”。
 * 全是按规则算的，不调用 AI，不去读外面的网页。
 */
export async function readPlan(env, { run = 0, rank, now = Date.now() }) {
  const c = deskConfig(env);
  await ensureTables(env);
  const { r, t } = (await topicOf(env, run, rank, now)) || {};
  if (!t) return { ok: false, error: 'no_topic' };
  const excl = await exclOf(env, r, t);
  const all = await topicItems(env, t, c, now);
  const items = all.filter((i) => !excl.has(i.id));
  const have = new Set(all.map((i) => i.id));
  const artsAll = (await topicArticles(env, all.filter((i) => !i.dup_of).map((i) => i.id))).filter((a) => !have.has(a.id));
  const srcs = dossierSources(items, artsAll.filter((a) => !excl.has(a.id)), c.maxSrc);
  const read = await fullTextPlan(env, srcs, { now });
  const inRead = new Set(read.map((x) => x.id));
  const fc = fullTextConfig(env);
  const want = [];
  const seen = new Set();
  const heavy = srcs.filter((s) => s.k !== 'f' && !inRead.has(s.id) && !fc.sources.has(s.source) && (s.score || 0) >= 8).sort((a, b) => (a.from ? 1 : 0) - (b.from ? 1 : 0) || (b.score || 0) - (a.score || 0) || b.ts - a.ts); // 原始报道排在转述前面
  for (const s of heavy) {
    const who = countedAs(s);
    if (seen.has(who)) continue;
    seen.add(who);
    want.push({ id: s.id, source: s.source, title: s.title, url: s.url, from: s.from, score: s.score });
    if (want.length >= 3) break;
  }
  const body = srcs.filter((s) => s.k === 'f').length;
  const willRead = read.filter((x) => x.st === 'have' || x.st === 'new').length;
  const out = [...all, ...artsAll].filter((i) => excl.has(i.id)).map((i) => ({ id: i.id, source: i.source, title: clean(i.title).slice(0, 200) }));
  return { ok: true, total: srcs.length, read, want, body, rest: Math.max(0, srcs.length - body - willRead), excl: out, max: fc.max };
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
  const { r, t } = (await topicOf(env, run, rank, now)) || {};
  if (!t) return { ok: false, error: 'no_topic' };
  const old = (await env.DB.prepare('SELECT * FROM desk_dossiers WHERE run_id = ? AND rank = ?').bind(r.id, t.rank).all()).results?.[0] || null;
  const pasted = safeJson(old?.pasted, []);
  const text = paste ? clean(String(paste.text || '').slice(0, c.pasteMax * 2)).slice(0, c.pasteMax) : '';
  if (text.length >= 200) {
    pasted.push({ label: clean(paste.label).slice(0, 80), text, ts: now });
    while (pasted.length > 6) pasted.shift(); // 每件事最多留 6 段（2026-11-27 用户同意从 3 段放宽）
  } else if (paste) return { ok: false, error: 'paste_short' };
  else if (old && now - old.updated < c.dossierMin * 60_000) return { ok: true, cached: true, wait_min: Math.ceil((c.dossierMin * 60_000 - (now - old.updated)) / 60_000) };
  if (!claudeUp(env)) return { ok: false, error: 'claude_down' };
  const spent = await spentToday(env, now);
  if (spent >= c.dailyUsd) return { ok: false, error: 'budget', spent };
  const excl = await exclOf(env, r, t);
  const items = (await topicItems(env, t, c, now)).filter((i) => !excl.has(i.id));
  if (!items.length && !pasted.length) return { ok: false, error: 'no_items' };
  const arts = await topicArticles(env, items.filter((i) => !i.dup_of).map((i) => i.id));
  const have = new Set(items.map((i) => i.id));
  const srcs = dossierSources(items, arts.filter((a) => !have.has(a.id) && !excl.has(a.id)), c.maxSrc);
  const ft = await attachFullText(env, srcs, { now }).catch(() => null);
  const user = `选题：${t.title_zh}（${t.title_en}）\n选题会给的理由：${t.why_zh}\n现在是北京时间 ${bjTime(now)}。以下是这个选题的 ${srcs.length + pasted.length} 条材料：\n\n${dossierText(srcs, pasted)}`;
  const res = await claudeText(env, { system: DOSSIER_SYSTEM, user, maxTokens: 14000, kind: 'dossier', effort: 'medium', model: c.model, timeout: 170_000 });
  if (!res) return { ok: false, error: 'model', detail: claudeState().last_error };
  const out = tidyDossier(res.text, srcs.length, pasted.length);
  if (!out) return { ok: false, error: 'parse' };
  const usd = claudeUsd(res.usage.input, res.usage.output);
  const map = srcs.map((s) => ({ n: s.n, id: s.id, src: s.source, ts: s.ts, url: s.url, t: s.title.slice(0, 140), k: s.k, art: s.art || undefined, from: s.from, full: s.full || undefined }));
  await env.DB.prepare(
    `INSERT INTO desk_dossiers (run_id, rank, title, body, srcs, pasted, created, updated, writes, usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(run_id, rank) DO UPDATE SET title = excluded.title, body = excluded.body, srcs = excluded.srcs, pasted = excluded.pasted, updated = excluded.updated, writes = writes + 1, usd = COALESCE(usd, 0) + excluded.usd`
  )
    .bind(r.id, t.rank, out.title, out.body, JSON.stringify(map), JSON.stringify(pasted), now, now, usd)
    .run();
  return { ok: true, usd, uncited: out.uncited, n: srcs.length, fulltext: ft || undefined };
}

/**
 * 只把用户贴进来的全文存起来，不调模型、不花钱。之后生成档案或写英文稿时会用上。
 * paste = { label, text }；{ drop: 序号 } 删掉已贴的某一段。返回 { ok, n: 现在存了几段 }
 */
export async function deskPaste(env, { run, rank, paste = null, drop = null, now = Date.now() }) {
  const c = deskConfig(env);
  await ensureTables(env);
  const { r, t } = (await topicOf(env, run, rank, now)) || {};
  if (!t) return { ok: false, error: 'no_topic' };
  const old = (await env.DB.prepare('SELECT pasted FROM desk_dossiers WHERE run_id = ? AND rank = ?').bind(r.id, t.rank).all()).results?.[0] || null;
  const pasted = safeJson(old?.pasted, []);
  if (drop != null) pasted.splice(Number(drop) || 0, 1);
  else {
    const text = clean(String(paste?.text || '').slice(0, c.pasteMax * 2)).slice(0, c.pasteMax);
    if (text.length < 200) return { ok: false, error: 'paste_short' };
    pasted.push({ label: clean(paste.label).slice(0, 80), text, ts: now });
    while (pasted.length > 6) pasted.shift(); // 每件事最多留 6 段（2026-11-27 用户同意从 3 段放宽）
  }
  if (old) await env.DB.prepare('UPDATE desk_dossiers SET pasted = ? WHERE run_id = ? AND rank = ?').bind(JSON.stringify(pasted), r.id, t.rank).run();
  else await env.DB.prepare('INSERT INTO desk_dossiers (run_id, rank, title, body, srcs, pasted, created, updated, writes, usd) VALUES (?, ?, ?, NULL, ?, ?, ?, 0, 0, 0)').bind(r.id, t.rank, '', '[]', JSON.stringify(pasted), now).run();
  return { ok: true, n: pasted.length };
}

/**
 * 一个选题的全部资料，整理成一份 Markdown：给用户一键复制，拿去别处（别的对话、别的模型）接着写。
 * 含选题会的理由、关键事实、观点线索、按时间排的全部报道（标题、摘要、链接）、已生成的档案、用户贴进来的全文。
 */
export async function deskPack(env, { run, rank, now = Date.now() }) {
  const c = deskConfig(env);
  await ensureTables(env);
  const { r, t } = (await topicOf(env, run, rank, now)) || {};
  if (!t) return { ok: false, error: 'no_topic' };
  const items = (await topicItems(env, t, c, now)).sort((a, b) => a.ts - b.ts);
  const arts = await topicArticles(env, items.filter((i) => !i.dup_of).map((i) => i.id));
  const have = new Set(items.map((i) => i.id));
  const d = (await env.DB.prepare('SELECT body, pasted, updated FROM desk_dossiers WHERE run_id = ? AND rank = ?').bind(r.id, t.rank).all()).results?.[0];
  const L = [`# ${t.title_zh}`, `${t.title_en}`, '', `导出时间：北京时间 ${bjTime(now)}`, '',
    '这是一件新闻事件的整包资料，分两类。标题带【原始材料】的是媒体报道和原文，可以当事实依据；标题带【AI 生成】的是我们系统自己写的选题理由、深读、英文稿和检查清单，可能有错，只能当参考，不能当事实来源。每条报道都带北京时间、来源和链接。',
    '', '## 【AI 生成】为什么值得写', t.why_zh, '', t.why_en, '', `Working headline: ${t.angle_en}`];
  if (t.tickers?.length) L.push('', `相关股票：${t.tickers.join(', ')}`);
  if (t.facts?.length) L.push('', '## 【AI 生成】关键事实（从报道里摘的）', ...t.facts.map((f) => `- ${f.t}（${f.src}）`));
  if (t.hooks?.length) L.push('', '## 【原始材料】吸睛资讯（可以当标题或开头的钩子）', ...t.hooks.map((h) => `- ${h.title}（${h.src}）：${h.t}${h.url ? ' ' + h.url : ''}`));
  if (t.views?.length) L.push('', '## 【原始材料】观点线索', ...t.views.map((v) => `- ${v.who ? String(v.who).split('|')[0] + '：' : ''}${v.t}${v.url ? ' ' + v.url : ''}`));
  // 真的全部：每条消息都带上；系统读到过的原文全文整篇放进来（不截短）；标出“这次不用”的
  const all = items.concat(arts.filter((a) => !have.has(a.id)));
  const excl = await exclOf(env, r, t).catch(() => new Set());
  const full = new Map();
  try {
    for (let k = 0; k < all.length; k += 80) {
      const part = all.slice(k, k + 80).map((i) => i.id);
      for (const x of (await env.DB.prepare(`SELECT id, text FROM fulltext WHERE ok = 1 AND id IN (${part.map(() => '?').join(',')})`).bind(...part).all()).results) if (x.text) full.set(x.id, x.text);
    }
  } catch {}
  L.push('', `## 【原始材料】全部报道（${all.length} 条，按时间；其中 ${full.size} 条带系统读到的原文全文）`);
  for (const i of all) {
    const b = full.get(i.id) || bodyOf(i);
    L.push(`- ${bjTime(i.ts)} | ${i.source}${i.who ? ' | ' + String(i.who).split('|')[0] : ''} | ${clean(i.title)}${excl.has(i.id) ? ' | （你点了“这次不用”，写稿时不会读）' : ''}${i.url ? '\n  ' + i.url : ''}${b.length >= 40 ? '\n  ' + (full.has(i.id) ? '〔原文全文〕' + b : b.slice(0, 1800)) : ''}`);
  }
  if (d?.body) L.push('', `## 【AI 生成】深读（北京时间 ${bjTime(d.updated)}；方括号里的 S 编号对应生成档案时的材料顺序）`, d.body);
  for (const p of safeJson(d?.pasted, [])) L.push('', `## 【原始材料】主编贴入的原文全文：${p.label || '未注明出处'}`, p.text);
  try {
    const f = (await env.DB.prepare('SELECT format, heads, summary, body, cards, checks, updated FROM desk_drafts WHERE run_id = ? AND rank = ?').bind(r.id, t.rank).all()).results?.[0];
    if (f?.body) {
      L.push('', `## 【AI 生成】英文稿（北京时间 ${bjTime(f.updated)}）`, '### 备选标题', ...safeJson(f.heads, []).map((h) => '- ' + h), '', '### 摘要', f.summary || '', '', '### 正文', f.body);
      const cards = safeJson(f.cards, []);
      if (cards.length) L.push('', '### 截图卡片内容（英文和阿语）', JSON.stringify(cards, null, 1));
      const ck = safeJson(f.checks, []);
      if (ck.length) L.push('', '## 【AI 生成】发稿前检查清单（针对上面这篇英文稿）', ...ck.map((x) => '- ' + x));
    }
  } catch {}
  return { ok: true, text: L.join('\n'), n: all.length, full: full.size, pasted: safeJson(d?.pasted, []).length };
}

/* ---------- 选题状态：新出现 / 在升温 / 在降温 / 持续 ---------- */

const shared = (a, b) => {
  const A = new Set(a || []);
  return (b || []).filter((x) => A.has(x)).length;
};
/**
 * 两个选题是不是同一件事。只共用一个事件名不算（“黄仁勋复职”会同时出现在 AI 抛售和英伟达治理两个选题里）：
 * 要么共同的报道有两条以上（或占较小一方的一半），要么共同的事件名占较小一方的一半以上。
 */
export function sameTopic(a, b) {
  const ni = shared(a.ids, b.ids);
  const mi = Math.min((a.ids || []).length, (b.ids || []).length);
  if (ni >= 2 || (ni >= 1 && ni * 2 >= mi)) return true;
  const ns = shared(a.stories, b.stories);
  const ms = Math.min((a.stories || []).length, (b.stories || []).length);
  return ns >= 1 && ns * 2 >= ms;
}
const closeness = (a, b) => shared(a.ids, b.ids) * 2 + shared(a.stories, b.stories);

/**
 * 给这一场的每个选题标状态（直接写在选题上）：
 * st = 'new' 以前的选题会里没出现过；'up' 最近 6 小时的报道比之前明显多；'down' 明显少；'flat' 持续。
 * since = 最早在哪一场选题会上榜的时间；was = 上一场排第几；h6 / h24 = 最近 6 小时、24 小时的报道数。
 * 全部由数据算出来，不让模型判断。
 */
export function topicStatus(topics, prev, now) {
  for (const t of topics) {
    const ts = t.tsl || [];
    const h6 = ts.filter((x) => now - x <= 6 * H).length;
    const h24 = ts.filter((x) => now - x <= 24 * H).length;
    const h12 = ts.filter((x) => now - x > 6 * H && now - x <= 12 * H).length; // 再往前 6 小时
    let since = 0;
    let was = 0;
    prev.forEach((r, k) => {
      const m = (r.topics || []).find((x) => sameTopic(t, x));
      if (!m) return;
      if (!since || r.ts < since) since = r.ts;
      if (k === 0) was = m.rank;
    });
    let st = 'flat';
    if (!since) st = 'new';
    else if (h6 >= 4 && h6 >= h12 * 2) st = 'up';
    else if (h6 === 0 || h6 * 2 <= h12) st = 'down';
    Object.assign(t, { st, h6, h24, since: since || undefined, was: was || undefined });
  }
  return topics;
}

/** 选题和已写记录对一下。返回 { id, ts, title, same, fresh }：same = 就是这一场这个选题标的；fresh = 写完之后新增的报道数 */
export function matchWritten(t, runId, written) {
  let best = null;
  for (const w of written) {
    const same = w.run_id === runId && w.rank === t.rank;
    if (!same && (w.off || !sameTopic(t, { ids: safeJson(w.ids, []), stories: safeJson(w.stories, []) }))) continue;
    if (same || !best) best = { id: w.id, ts: w.ts, title: w.title, same, fresh: (t.tsl || []).filter((x) => x > w.ts).length };
    if (same) break;
  }
  return best;
}

/**
 * 市场情绪（不靠单一事件）：用这 24 小时进了选题会的全部材料算三样：
 * 1) 要闻的多空：标了利好 / 利空的重要快讯各多少条；2) 机构和名人观点的多空；3) 和上一场比是变乐观还是变悲观。
 * 价格类的信号（指数、油、金）在接了行情之后由 /api/desk/quotes 另外给，只在管理模式下显示。
 */
export function deskMood(rows, prev) {
  const cnt = (list) => ({ up: list.filter((r) => r.dir > 0).length, down: list.filter((r) => r.dir < 0).length, n: list.length });
  // 要闻按“事”算，不按条数算：同一件事报了 18 条也只算一票，方向取多数
  const ev = new Map();
  for (const r of rows) {
    if (r.kind === 'v' || (r.score || 0) < 6) continue;
    const k = r.story || 'id:' + r.id;
    ev.set(k, (ev.get(k) || 0) + (r.dir > 0 ? 1 : r.dir < 0 ? -1 : 0));
  }
  const news = cnt([...ev.values()].map((v) => ({ dir: v })));
  const views = cnt(rows.filter((r) => r.kind === 'v'));
  const lean = (c) => (c.up + c.down >= 4 ? Math.round(((c.up - c.down) / (c.up + c.down)) * 100) : null);
  const out = { news, views, lean: lean(news), vlean: lean(views) };
  if (prev && prev.lean != null && out.lean != null) out.delta = out.lean - prev.lean;
  const top = (d) =>
    rows
      .filter((r) => r.kind === 'v' && realWho(r.who, r.source) && (d > 0 ? r.dir > 0 : r.dir < 0))
      .sort((a, b) => (b.pick || 0) - (a.pick || 0))
      .slice(0, 3)
      .map((r) => ({ who: r.who, t: clean(r.title).slice(0, 110), id: r.id, url: r.url || undefined }));
  out.bulls = top(1);
  out.bears = top(-1);
  return out;
}

/** 没有挂到任何选题上的吸睛资讯：还缺支撑材料，列在榜单下面，等用户决定要不要去调研 */
export function looseHooks(rows, topics) {
  const used = new Set();
  for (const t of topics) {
    (t.ids || []).forEach((x) => used.add(x));
    (t.hooks || []).forEach((h) => used.add(h.id));
  }
  return rows
    .filter((r) => (r.hook || 0) >= 2 && !used.has(r.id))
    .sort((a, b) => (b.hook || 0) - (a.hook || 0) || b.ts - a.ts)
    .slice(0, 8)
    .map((r) => ({ id: r.id, title: clean(r.title).slice(0, 160), src: outlet(r.source), url: r.url || undefined, ts: r.ts, hook: r.hook }));
}

/**
 * 花费一览（只给管理模式）：今天各项花了多少、选题台离每日上限多远、本月累计、照这个速度月底大约多少。
 * “日”和“月”都按 UTC 算（北京时间早上 8 点切换），和每日上限的算法一致。
 */
export async function deskCost(env, c, now) {
  const day = new Date(now).toISOString().slice(0, 10);
  const rows = (await env.DB.prepare('SELECT day, kind, input_tokens, output_tokens FROM claude_usage WHERE day >= ?').bind(day.slice(0, 8) + '01').all()).results;
  const r2 = (x) => Math.round(x * 1000) / 1000;
  const today = {};
  let month = 0;
  let before = 0;
  for (const r of rows) {
    const usd = claudeUsd(r.input_tokens, r.output_tokens);
    month += usd;
    if (r.day === day) today[r.kind] = (today[r.kind] || 0) + usd;
    else before += usd;
  }
  const d = new Date(now);
  const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const days = new Set(rows.filter((r) => r.day !== day).map((r) => r.day)).size;
  const desk = (today.desk || 0) + (today.dossier || 0) + (today.draft || 0);
  const all = Object.values(today).reduce((a, b) => a + b, 0);
  return {
    day,
    today: r2(all),
    desk: r2(desk),
    fixed: r2(all - desk),
    cap: c.dailyUsd,
    month: r2(month),
    credit: c.monthUsd,
    // 月底估算：已过完的日子的日均 × 剩下的天数；不足 2 个整天时不估
    est: days >= 2 ? r2(month + (before / days) * (dim - d.getUTCDate())) : null,
  };
}

/** 候选新信源：{ name, note } 记一条；{ id, undo: true } 删掉 */
export async function deskSource(env, { name, note = '', id, undo = false, now = Date.now() }) {
  await ensureTables(env);
  if (undo) {
    await env.DB.prepare('UPDATE desk_sources SET gone = 1 WHERE id = ?').bind(Number(id) || 0).run();
    return { ok: true };
  }
  const n = String(name || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (n.length < 3) return { ok: false, error: 'title_short' };
  await env.DB.prepare('INSERT INTO desk_sources (ts, name, note) VALUES (?, ?, ?)').bind(now, n, clean(note).slice(0, 300)).run();
  return { ok: true };
}

/* ---------- 已写记录 ---------- */

/** 标为已写：{ run, rank } 榜上的选题；{ title, note } 榜外的题；{ id, undo: true } 撤销 */
export async function deskWritten(env, { run, rank, title, note = '', id, undo = false, now = Date.now() }) {
  await ensureTables(env);
  if (undo) {
    await env.DB.prepare('UPDATE desk_written SET gone = 1 WHERE id = ?').bind(Number(id) || 0).run();
    return { ok: true };
  }
  if (run != null && rank != null) {
    const r = (await env.DB.prepare('SELECT id, topics FROM desk_runs WHERE id = ?').bind(Number(run) || 0).all()).results?.[0];
    const t = r && safeJson(r.topics, []).find((x) => x.rank === Number(rank));
    if (!t) return { ok: false, error: 'no_topic' };
    const had = (await env.DB.prepare('SELECT id FROM desk_written WHERE run_id = ? AND rank = ? AND gone = 0 LIMIT 1').bind(r.id, t.rank).all()).results?.[0];
    if (had) return { ok: true, dup: true };
    await env.DB.prepare('INSERT INTO desk_written (ts, title, run_id, rank, ids, stories, off, note) VALUES (?, ?, ?, ?, ?, ?, 0, ?)').bind(now, t.title_zh, r.id, t.rank, JSON.stringify(t.ids || []), JSON.stringify(t.stories || []), clean(note).slice(0, 300)).run();
    return { ok: true };
  }
  const tt = clean(title).slice(0, 200);
  if (tt.length < 4) return { ok: false, error: 'title_short' };
  await env.DB.prepare('INSERT INTO desk_written (ts, title, off, note) VALUES (?, ?, 1, ?)').bind(now, tt, clean(note).slice(0, 300)).run();
  return { ok: true };
}

/* ---------- 英文稿 ---------- */

export const DRAFT_SYSTEM = `You are a senior markets writer for a retail investing app. Readers trade US stocks or Saudi (Tadawul) stocks; many trade only one of the two markets and many are not Saudi nationals. Write in English. A beginner must be able to follow every sentence, and an experienced investor must still learn something. The editor will polish and publish your draft, so it must be close to publishable.

Hard rules on facts
1. Every fact, number, date and quotation must come from the materials given. Do not add background, history, figures or identities from your own knowledge. If the materials do not say it, do not write it.
2. Most materials are Chinese paraphrases. Use quotation marks only when the exact English words appear in the materials or in the text the editor pasted. Otherwise paraphrase and attribute ("Goldman Sachs said...").
3. Attribute views to the institution or person who holds them (Goldman Sachs, Deutsche Bank, Jeffrey Gundlach). If the materials do not show who originated a fact, state it plainly or write "reports said"; never invent a label such as "Bloomberg-style commentary". Never name the aggregators that relayed them: do not mention Wallstreetcn, Gelonghui, Zhitong, Jin10 or any "Chinese media". Reuters, Bloomberg, WSJ, CNBC, Argaam may be credited only when the material shows they originated the reporting.
4. Keep states apart: an anonymous report is not a confirmation; proposed is not approved; signed is not closed; a forecast is not a result.
4a. Lead with what is new. The materials carry dates and times; build the headline, summary and opening on the most recent developments (roughly the last 24 hours). When the story began days earlier, give the original event one or two sentences of background with its date, and do not present it as today's news.
5. Do not state share prices or percentage moves unless the materials or the "Reference prices" block give them. When you use a figure from "Reference prices", give its time and time zone the way the block does (for example "as of the Nov 25 close, New York time" or "as of 2:45 p.m. Riyadh time on Nov 26"), use only the few that matter to this story, and never describe a move as today's if the block shows an earlier date. Do not imply that the news caused a price move unless the materials say so.
6. The article is for readers, not for the editor. Never write about your materials or process in the headlines, summary, article or cards: no "the materials do not include", "per the reports", "sources reviewed", "nothing in the data tells us", "as this is written". If something is unknown, either leave it out or say plainly what is not yet known in the world ("the closing level was not yet available"), and put the gap under CHECK.
7. Keep figures in their own time frame. A cumulative figure (value lost over a whole selloff) must not be attached to a one-day move, in headlines above all. Do not give the same label ("three-year high") to a different figure than the materials do.
8. If the US or Saudi market is still trading when you write, mark market figures as intraday in the sentence that gives them ("was down 1.2% in midday trading"). Do not open or close the article with a standalone note about when it was written, and if the article gives no market figures say nothing about it.
9. No investment advice, no "buy/sell", no promises. Neutral, professional tone. On Saudi government policy, report what officials said, neutrally.

Style
- 450 to 700 words for the article. No padding, no throat-clearing opening, no summary paragraph that repeats the piece, no rhetorical questions in a row.
- Opening sentence: one point, the newest concrete fact, in about 30 words or fewer and with at most two numbers. Say what happened, not what did not.
- Within the first three paragraphs, tell the reader in plain prose what is at stake for someone who holds US or Saudi stocks: which companies, prices or decisions this touches and through what mechanism. Write it as part of the story, never under a label, and only as far as the materials support it.
- Make three or four points well instead of touching everything in the materials. Leave out what does not help the reader understand this story.
- A number needs a yardstick. When the materials give one (the previous figure, the forecast, the usual size, the share of the total), put it next to the number. Words must match the size of the move: do not call a small move a surge, plunge or soar.
- Report what people and institutions said and did, not what they felt or intended. Not "investors fear" or "the company tried to calm markets", but who said or did what.
- Prefer the concrete word and the short sentence. Cut "however", "despite", "although" and "but" unless the sentence really turns.
- Explain a term in a few plain words the first time it appears (for example: "the Fed's preferred inflation gauge, PCE").
- Structure: decide what this particular story needs and build the piece around that. Useful ways to organise it: around a handful of figures; around two camps that disagree; around the questions a reader would ask; as a sequence of events and what comes next; around what is confirmed and what is still open; around one comparison. A well-built news feature with no device at all is just as good when the story is simple. The device is scaffolding for you, not something to show the reader: never name it or announce it in the article.
- Do not write to a template. Specifically:
  - No signpost sentences that tell the reader what the article is about to do ("Here is what is settled and what is not", "Here's what you need to know", "Here's why it matters", "Let's break it down", "Here are five numbers").
  - Subheadings must say something about this story (a fact, a claim, a number, a name). Never use a category label as a subheading or list header: no "Known", "Unknown", "What we know", "What we don't know", "The bull case", "The bear case", "What to watch", "Why it matters", "The bottom line", "Key takeaways", "The big picture", "By the numbers". Two to four subheadings are enough; a short piece may have none.
  - Open with the news itself in a normal sentence. Do not set the opening paragraph in bold and do not end it with a line that introduces the rest.
  - End on the last real piece of information. No closing paragraph that sums up, draws a moral or looks ahead in general terms ("remains to be seen", "investors will be watching closely", "only time will tell").
  - Avoid stock commentary phrasing: "it's worth noting", "notably", "amid" as a catch-all link, "underscores", "highlights the", "signals a shift", "raises questions", "a perfect storm", "in a nutshell", "not just X but Y", lists of exactly three for rhythm, and dashes used to bolt on an afterthought.
  - Vary sentence length and paragraph shape the way a person does. Use a list or table only where the content really is a list or a comparison, not to make the piece look organised.
- If the user message lists the structures recent drafts used, do not repeat the most recent one unless this story plainly calls for it. If the editor asks for a different structure than last time, choose another one.
- Stocks: mention a listed company only where it is genuinely part of the story. Never add a list of "stocks to watch" just to have one, never write calls to action like "check out" or "keep an eye on".
- Tickers: the editor links every Name (TICKER) to the stock's page in the app, so readers can tap it wherever they are in the piece. Write a listed company as Name (TICKER), e.g. Nvidia (NVDA), Aramco (2222), the first time it appears in EACH paragraph and in each bullet or table row; later mentions inside the same paragraph use the plain name. This applies to every US- or Saudi-listed company in the piece, including ones mentioned once in passing (a rival, a supplier, a customer). Do not put a ticker in headlines, in subheadings, inside a direct quote, or on a possessive (write "shares of Nvidia (NVDA)", not "Nvidia (NVDA)'s shares"). Use only a ticker you are sure of or that the materials give; if unsure, write the name alone and add a CHECK line that starts with the exact words "代码待确认：" followed by the company name.
- Give the reader a reason to tap through, by reporting and not by asking. Next to a company, when the materials have it, put the thing a holder would want to check next: the latest price move with its time, how far the stock is from a recent high or low, how much of its revenue or orders the news touches, and the next dated event (earnings, a lockup expiry, a hearing, a ruling). If the market has not traded on the news yet, say so and say when it next trades. Never invent any of these, and never tell the reader to go and look.

Headlines
- Give 5 headlines, all about this article's main story (not a side item), each taking a different angle (newest fact; the key number; the cause or another concrete fact; the consequence or next step; the counterparty or a surprising detail).
- They should make a reader want to open the piece: use the strongest hook the article has, such as a named person, a vivid term a named strategist used, a sharp contrast between two institutions, or the most striking number. Lead with the most striking number, contrast or named person that the article really contains. It is fine to build a headline on a detail that is only briefly covered, as long as the article does cover it and the headline does not overstate it.
- Clear subject + active verb + key result. 5 to 10 words. Present tense for what happened, "to + verb" for what is planned. Verbs must match the state of the event (Could / Sees / Warns for forecasts). No tickers, no $, no win-rate claims, no question-mark bait without an answer in the piece.

Cards (optional visual blocks the editor can screenshot into the app)
- Give 1 to 3 cards only when the materials support them; give none rather than force one. Every string in a card must be supported by the materials.
- Every card must also carry an Arabic version under the key "ar": an object of the same type and shape with every string translated into clear Modern Standard Arabic as used by Saudi financial media. Keep figures in Western digits (7.4%, $50 billion as 50 مليار دولار), keep tickers in Latin letters, and use the established Arabic name of a company or institution when one exists (أرامكو, الاحتياطي الفيدرالي), otherwise keep the Latin name. Translate meaning, do not add or drop facts.
- Types, as JSON objects:
  {"type":"numbers","title":"...","items":[{"n":"7.4%","label":"what this number is, at most 12 words"}]}  (3 to 5 items)
  {"type":"versus","title":"...","left":{"h":"Bulls say","items":["..."]},"right":{"h":"Bears say","items":["..."]}}  (2 to 4 items a side, each at most 18 words, name who says it)
  {"type":"timeline","title":"...","items":[{"t":"Nov 25","text":"..."}]}  (3 to 6 items)
  {"type":"watch","title":"What to watch","items":["..."]}  (2 to 4 items)

Output exactly these sections, in this order, with these headings and nothing before or after:
## FORMAT
(one line for the editor only: how you organised the piece and, in a few words, why)
## HEADLINES
(5 lines, one headline per line, no numbering)
## SUMMARY
(one paragraph, 2 to 3 short sentences, at most 65 words, with at least two concrete numbers or dates if the materials have them)
## ARTICLE
(Markdown. Use ## subheadings and short paragraphs; lists and one small table are welcome where they carry information.)
## CARDS
(a JSON array of card objects, or [])
## CHECK
(a list of at most 8 lines, most important first, one line each, in Chinese: what the editor must verify or fill in before publishing, e.g. numbers that rest on a headline only, prices to add from licensed data, quotes that need the English original)`;

/** 解析模型写的英文稿。返回 { format, heads, summary, body, cards, checks } 或 null */
export function parseDraft(text) {
  const src = String(text || '');
  const sec = (name) => {
    const m = src.match(new RegExp('(?:^|\\n)##\\s*' + name + '\\s*\\n([\\s\\S]*?)(?=\\n##\\s*(?:FORMAT|HEADLINES|SUMMARY|ARTICLE|CARDS|CHECK)\\s*\\n|$)'));
    return m ? m[1].trim() : '';
  };
  const lines = (t) =>
    t
      .split('\n')
      .map((l) => l.replace(/^\s*(?:[-*]\s+|\d+[.)]\s+)/, '').replace(/^\*\*(.*)\*\*$/, '$1').trim())
      .filter(Boolean);
  const heads = lines(sec('HEADLINES')).slice(0, 5);
  // 正文里自己有 ## 小标题：ARTICLE 一直取到 CARDS 为止
  const am = src.match(/(?:^|\n)##\s*ARTICLE\s*\n/);
  const a = am ? am.index + am[0].length : -1;
  const b = src.search(/\n##\s*(?:CARDS|CHECK)\s*(?:\n|$)/);
  const body = a >= 0 ? src.slice(a, b > a ? b : undefined).trim() : '';
  if (heads.length < 3 || body.length < 400) return null;
  let cards = [];
  try {
    const j = sec('CARDS').match(/\[[\s\S]*\]/);
    cards = (j ? JSON.parse(j[0]) : []).map(tidyCard).filter(Boolean).slice(0, 3);
  } catch {}
  return { format: lines(sec('FORMAT'))[0]?.slice(0, 160) || '', heads, summary: sec('SUMMARY').replace(/\s+/g, ' ').slice(0, 900), body, cards, checks: lines(sec('CHECK')).slice(0, 8) };
}

const cs = (v, n) => String(v ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
function tidyCard(c) {
  const en = tidyCard1(c);
  if (!en) return null;
  // 阿语版：形状要和英文版一样才收，否则只留英文
  const ar = c.ar && typeof c.ar === 'object' ? tidyCard1({ ...c.ar, type: en.type }) : null;
  return ar ? { ...en, ar } : en;
}
function tidyCard1(c) {
  if (!c || typeof c !== 'object') return null;
  const title = cs(c.title, 90);
  const arr = (a, f, max) => (Array.isArray(a) ? a.map(f).filter(Boolean).slice(0, max) : []);
  if (c.type === 'numbers') {
    const items = arr(c.items, (x) => (x && cs(x.n, 14) ? { n: cs(x.n, 14), label: cs(x.label, 110) } : null), 5);
    return items.length >= 2 ? { type: 'numbers', title, items } : null;
  }
  if (c.type === 'versus') {
    const side = (x) => ({ h: cs(x?.h, 30), items: arr(x?.items, (y) => cs(y, 170), 4) });
    const left = side(c.left);
    const right = side(c.right);
    return left.items.length && right.items.length ? { type: 'versus', title, left, right } : null;
  }
  if (c.type === 'timeline') {
    const items = arr(c.items, (x) => (x && cs(x.text, 170) ? { t: cs(x.t, 20), text: cs(x.text, 170) } : null), 6);
    return items.length >= 2 ? { type: 'timeline', title, items } : null;
  }
  if (c.type === 'watch') {
    const items = arr(c.items, (y) => cs(y, 170), 4);
    return items.length ? { type: 'watch', title: title || 'What to watch', items } : null;
  }
  return null;
}

/**
 * 机器再查一遍稿子，查到的问题加在“发稿前要核对”的最前面：
 * 1) 英文引号里的话（三个词以上）不在材料原文里，多半是中文转述翻回英文再加的引号；2) 稿子里出现了讲材料、讲过程的话。
 */
export function draftLint(out, sourceText) {
  const src = String(sourceText || '').toLowerCase().replace(/\s+/g, ' ');
  // 卡片只取里面的文字：JSON 自带的引号不是引语
  const cardText = [];
  JSON.stringify(out.cards, (k, v) => (typeof v === 'string' && k !== 'type' ? (cardText.push(v), v) : k === 'ar' ? undefined : v));
  const text = [out.heads.join('\n'), out.summary, out.body, cardText.join('\n')].join('\n');
  const warn = [];
  const seen = new Set();
  for (const m of text.matchAll(/["“]([^"“”\n]{12,200})["”]/g)) {
    const q = m[1].trim().replace(/[.,;:!?]+$/, '');
    if (q.split(/\s+/).length < 3 || seen.has(q)) continue;
    seen.add(q);
    if (!src.includes(q.toLowerCase().replace(/\s+/g, ' '))) warn.push(`引号里的这句不在材料的英文原文里，发稿前请找到英文原话或去掉引号："${q.slice(0, 90)}"`);
  }
  const meta = text.match(/\b(?:the materials?|per the reports?|sources? reviewed|the dossier|nothing in the data|as this is written)\b[^.\n]{0,60}/i);
  if (meta) warn.push(`稿子里有讲材料或写作过程的话，读者不该看到，请改掉："${meta[0].trim()}"`);
  const body = String(out.body || '');
  const label = body.match(/^(?:#{1,4}\s*|\*\*)\s*(?:known|unknown|what we (?:don['’]t )?know|what(?:['’]s| is) (?:known|not known|unknown|settled)|the bull case|the bear case|what to watch|why it matters|the bottom line|key takeaways|the big picture|by the numbers)\b[^\n]{0,40}$/im);
  if (label) warn.push(`稿子里有栏目式的小标题，读起来像模板，建议改成说具体内容的："${label[0].replace(/[#*]/g, '').trim()}"`);
  const stock = body.match(/\b(?:here(?:['’]s| is| are) (?:what|why|how|the|five|four|three)|let['’]s break (?:it|this) down|it['’]s worth noting|remains to be seen|only time will tell|will be watching closely|in a nutshell)\b[^.\n]{0,50}/i);
  if (stock) warn.push(`稿子里有套话，建议删掉或改写："${stock[0].trim()}"`);
  // 稿子里带了代码的股票列出来，方便编辑逐个关联、顺手核对代码
  const tk = [...new Set([...body.matchAll(/\(([A-Z]{1,5}|\d{4})\)/g)].map((m) => m[1]))].slice(0, 12);
  const out5 = warn.slice(0, 5);
  // 数字核对：正文里的数字在材料里找不到原样（换算成亿、万后也找不到）的，列出来请编辑重点核对
  const srcN = src.replace(/(\d),(?=\d{3})/g, '$1');
  const miss = [];
  for (const m of body.replace(/(\d),(?=\d{3})/g, '$1').matchAll(/\$?\d+(?:\.\d+)?%?/g)) {
    const raw = m[0].replace('$', ''), pct = raw.endsWith('%'), n = parseFloat(raw);
    if (!Number.isFinite(n) || miss.includes(raw)) continue;
    if (!pct && Number.isInteger(n) && (n < 100 || (n >= 1900 && n <= 2100))) continue; // 日期、年份、小计数不查
    const forms = [n, n / 100, n * 10, n / 10, n * 100, n / 1000, n * 1000].map((x) => String(Math.round(x * 1e6) / 1e6));
    const hit = forms.some((f, i) => new RegExp('(^|[^\\d.])' + f.replace('.', '\\.') + (f.includes('.') ? '0*' : '(?:\\.0+)?') + (i === 0 && pct ? '\\s*(%|％|percent|个百分点)' : '(?![\\d]|\\.\\d)')).test(srcN));
    const cheng = pct && n % 10 === 0 && n >= 10 && n <= 90 && srcN.includes('一二三四五六七八九'[n / 10 - 1] + '成');
    if (!hit && !cheng) miss.push(raw);
  }
  if (miss.length) out5.push(`这 ${miss.length} 个数字在材料里找不到原样，可能是 AI 换算、四舍五入或写错的，发稿前请重点核对：${miss.slice(0, 10).join('、')}${miss.length > 10 ? ' 等' : ''}`);
  if (tk.length) out5.push(`稿子里带代码的股票有 ${tk.length} 只：${tk.join('、')}。关联前请核对代码。`);
  return out5;
}

/** 现在美股是不是在交易（周一到周五 9:30 到 16:00，纽约时间；不含节假日） */
export function usOpen(now) {
  const p = parts(now, 'America/New_York');
  return !['Sat', 'Sun'].includes(p.wd) && p.min >= 9 * 60 + 30 && p.min < 16 * 60;
}

const Q_FMT = {};
function qWhen(ts, tz) {
  const f = (Q_FMT[tz] ||= new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }));
  return f.format(new Date(ts));
}
/**
 * 给英文稿用的参考价：这个选题的股票 + 所在市场的大盘，带上数据时间和时区。
 * 没有行情、数据太旧（超过 4 天）或没有时间戳的不给。返回 { text, at } 或 null。
 */
export function draftQuotes(t, quotes, now) {
  const want = new Set((t.tickers || []).filter((k) => /^([A-Z]{1,5}|\d{4})$/.test(k)));
  if (t.market !== 'Saudi') ['SPY', 'QQQ'].forEach((k) => want.add(k));
  if (t.market !== 'US') want.add('TASI');
  const NAMES = { SPY: 'S&P 500 ETF (SPY)', QQQ: 'Nasdaq 100 ETF (QQQ)', TASI: 'Tadawul All Share Index (TASI)' };
  const rows = (quotes || []).filter((q) => q && want.has(q.t) && q.at && now - q.at < 4 * 86_400_000 && now >= q.at - 3_600_000);
  if (!rows.length) return null;
  const lines = rows.map((q) => {
    const sa = q.t === 'TASI' || /^\d{4}$/.test(q.t);
    const ext = q.ext && now - q.ext.at < 3 * 3_600_000 ? `; in ${q.ext.s === 'pre' ? 'pre-market' : 'after-hours'} trading ${q.ext.p}, ${q.ext.chg > 0 ? '+' : ''}${q.ext.chg}% versus that close, as of ${qWhen(q.ext.at, 'America/New_York')} New York time (thin trading, say so if you use it)` : '';
    return `- ${NAMES[q.t] || q.t}: ${q.p}, ${q.chg > 0 ? '+' : ''}${q.chg}% versus the previous close, as of ${qWhen(q.at, sa ? 'Asia/Riyadh' : 'America/New_York')} ${sa ? 'Riyadh' : 'New York'} time${sa ? ' (delayed about 15 minutes)' : ''}${ext}`;
  });
  return { text: lines.join('\n'), at: Math.max(...rows.map((q) => q.at)) };
}

/** 写（或重写）一个选题的英文稿。alt = true：换一种形式重写 */
export async function writeDraft(env, { run, rank, alt = false, now = Date.now() }) {
  const c = deskConfig(env);
  if (!c.on) return { ok: false, error: 'off' };
  await ensureTables(env);
  const { r, t } = (await topicOf(env, run, rank, now)) || {};
  if (!t) return { ok: false, error: 'no_topic' };
  const old = (await env.DB.prepare('SELECT format, updated FROM desk_drafts WHERE run_id = ? AND rank = ?').bind(r.id, t.rank).all()).results?.[0] || null;
  if (old && now - old.updated < c.draftMin * 60_000) return { ok: true, cached: true, wait_min: Math.ceil((c.draftMin * 60_000 - (now - old.updated)) / 60_000) };
  if (!claudeUp(env)) return { ok: false, error: 'claude_down' };
  const spent = await spentToday(env, now);
  if (spent >= c.dailyUsd) return { ok: false, error: 'budget', spent };
  const excl = await exclOf(env, r, t);
  const items = (await topicItems(env, t, c, now)).filter((i) => !excl.has(i.id));
  const d = (await env.DB.prepare('SELECT body, pasted FROM desk_dossiers WHERE run_id = ? AND rank = ?').bind(r.id, t.rank).all()).results?.[0];
  const pasted = safeJson(d?.pasted, []);
  if (!items.length && !pasted.length) return { ok: false, error: 'no_items' };
  const arts = await topicArticles(env, items.filter((i) => !i.dup_of).map((i) => i.id));
  const have = new Set(items.map((i) => i.id));
  const srcs = dossierSources(items, arts.filter((a) => !have.has(a.id) && !excl.has(a.id)), c.maxSrc);
  const ft = await attachFullText(env, srcs, { now }).catch(() => null);
  const views = (t.views || []).map((v) => `- ${v.who ? String(v.who).split('|')[0] + ': ' : ''}${v.t}`).join('\n');
  // 参考价：用缓存里最近一次拿到的行情（10 分钟内不重复请求，Yahoo 被拒时自动歇 6 小时）；拿不到就照旧不写价格
  let px = null;
  try {
    const q = await deskQuotes(env, { now });
    if (q.ok) px = draftQuotes(t, q.quotes, now);
  } catch {}
  let recent = [];
  try {
    recent = (await env.DB.prepare('SELECT format FROM desk_drafts WHERE NOT (run_id = ? AND rank = ?) AND format IS NOT NULL ORDER BY updated DESC LIMIT 4').bind(r.id, t.rank).all()).results.map((x) => String(x.format || '').slice(0, 120)).filter(Boolean);
  } catch {}
  const user =
    `${usOpen(now) ? 'The US market is open right now: figures in the materials are intraday.\n' : ''}Topic: ${t.title_en} (${t.title_zh})\nWhy the desk picked it: ${t.why_en || t.why_zh}\nWorking headline from the story meeting: ${t.angle_en}\nMarket: ${t.market}. Tickers the desk tagged: ${(t.tickers || []).join(', ') || 'none'}\nNow: ${bjTime(now)} Beijing time.\n` +
    (alt && old?.format ? `The previous draft of this topic was organised this way: "${old.format}". Organise it in a clearly different way this time.\n` : '') +
    (recent.length ? `How the desk's most recent drafts on other topics were organised (newest first), so this one does not read like a copy of them:\n${recent.map((x) => '- ' + x).join('\n')}\n` : '') +
    (views ? `\nInstitution and expert views attached to this topic:\n${views}\n` : '') +
    (px ? `\nReference prices (the latest the desk has; each line carries its own time):\n${px.text}\n` : '') +
    ((t.hooks || []).length ? `\nEye-catching items the desk attached to this topic (good headline material if, and only if, the article covers them accurately):\n${t.hooks.map((h) => '- ' + h.title).join('\n')}\n` : '') +
    `\nMaterials (〔正文〕 = full text, 〔摘要〕 = a sentence or two, 〔仅标题〕 = headline only; treat headline-only items as thin and list what rests on them under CHECK):\n\n${dossierText(srcs, pasted)}` +
    (d?.body ? `\n\nThe desk's own dossier on this topic (Chinese, built from the same materials; lines starting with 推断 are the desk's inference, not fact):\n${String(d.body).slice(0, 6000)}` : '');
  const res = await claudeText(env, { system: DRAFT_SYSTEM, user, maxTokens: 16000, kind: 'draft', effort: 'medium', model: c.draftModel, timeout: 170_000 });
  if (!res) return { ok: false, error: 'model', detail: claudeState().last_error };
  const out = parseDraft(res.text);
  if (!out) return { ok: false, error: 'parse' };
  const pre = draftLint(out, user);
  if (usOpen(now) && t.market !== 'Saudi') pre.unshift('这篇写于美股盘中，里面的涨跌都是盘中数字，没有收盘数据。收盘后请点“用最新材料重写”，或手动更新数字。');
  if (px) pre.push(`稿子里的股价和涨跌来自内部参考行情（截至北京时间 ${bjTime(px.at)}），发布前请用你们自己的行情数据核对一遍，对外来源写 Sahm Data。`);
  if (out.cards.some((c) => c.ar)) pre.push('卡片的阿语是机器翻译，发布前请懂阿语的同事看一遍。');
  out.checks = pre.concat(out.checks).slice(0, 10);
  const usd = claudeUsd(res.usage.input, res.usage.output);
  await env.DB.prepare(
    `INSERT INTO desk_drafts (run_id, rank, format, heads, summary, body, cards, checks, created, updated, writes, usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(run_id, rank) DO UPDATE SET format = excluded.format, heads = excluded.heads, summary = excluded.summary, body = excluded.body, cards = excluded.cards, checks = excluded.checks, updated = excluded.updated, writes = writes + 1, usd = COALESCE(usd, 0) + excluded.usd`
  )
    .bind(r.id, t.rank, out.format, JSON.stringify(out.heads), out.summary, out.body, JSON.stringify(out.cards), JSON.stringify(out.checks), now, now, usd)
    .run();
  if (r.id === 0) await evDrafted(env, t.rank, now);
  return { ok: true, usd, n: srcs.length, fulltext: ft || undefined };
}

/* ---------- 行情（第 4 步）：页面上只给管理模式看；英文稿里可以引用，带时间，发布前由用户用自己的数据核对 ---------- */

// 大盘和相关资产的代表：标普、纳指、原油、黄金、长期美债、沙特股市 ETF（在美国上市，沙特收盘后也有价）
export const QUOTE_BASE = ['SPY', 'QQQ', 'USO', 'GLD', 'TLT', 'KSA'];
const qmem = { at: 0, key: '', data: null, src: '' };

/** Tiingo 的批量接口返回的一行 → { t, p, pc, chg }；chg 是相对昨收的涨跌幅（%） */
export function tidyQuote(x) {
  const p = Number(x?.tngoLast ?? x?.last);
  const pc = Number(x?.prevClose);
  if (!x?.ticker || !Number.isFinite(p) || !Number.isFinite(pc) || pc <= 0) return null;
  return { t: String(x.ticker).toUpperCase(), p, pc, chg: Math.round((p / pc - 1) * 10000) / 100, at: x.timestamp ? Date.parse(x.timestamp) || undefined : undefined };
}

/**
 * 最新一场选题里出现的美股代码 + 大盘代表的参考价。一次请求全拿到，结果在内存和 meta 里各留 5 分钟。
 * 没配 TIINGO_TOKEN 时返回 { ok: false, error: 'no_token' }。数据按 Tiingo 条款只供内部看。
 */
/** Yahoo 图表接口返回的一只 → { t, p, pc, chg }；t 用我们自己的代码（2222、TASI），不带 .SR */
export function tidyYahoo(j, t) {
  const res = j?.chart?.result?.[0];
  const m = res?.meta;
  const p = Number(m?.regularMarketPrice);
  // 一个月日线：最后一根是最近一个交易日，昨收取倒数第二根的收盘；只有一天的数据时用接口给的昨收
  const closes = (res?.indicators?.quote?.[0]?.close || []).filter((x) => Number.isFinite(x) && x > 0);
  let pc = closes.length >= 3 ? closes[closes.length - 2] : Number(m?.chartPreviousClose ?? m?.previousClose);
  if (!Number.isFinite(p) || !Number.isFinite(pc) || pc <= 0) return null;
  const out = { t, p, pc: Math.round(pc * 10000) / 10000, chg: Math.round((p / pc - 1) * 10000) / 100, at: m.regularMarketTime ? m.regularMarketTime * 1000 : undefined };
  // 平时一天动多少：最近约 20 个交易日每天涨跌幅（绝对值）的中位数，不含今天
  if (closes.length >= 8) {
    const moves = [];
    for (let i = Math.max(1, closes.length - 21); i < closes.length - 1; i++) moves.push(Math.abs(closes[i] / closes[i - 1] - 1) * 100);
    moves.sort((a, b) => a - b);
    const typ = moves.length ? moves[Math.floor(moves.length / 2)] : 0;
    if (typ > 0) out.typ = Math.round(Math.max(typ, 0.15) * 100) / 100;
  }
  return out;
}

/** 美股现在是盘前（纽约 4:00 到 9:30）、盘后（16:00 到 20:00），还是都不是 */
export function usExtended(now) {
  const p = parts(now, 'America/New_York');
  if (['Sat', 'Sun'].includes(p.wd)) return '';
  return p.min >= 4 * 60 && p.min < 9 * 60 + 30 ? 'pre' : p.min >= 16 * 60 && p.min < 20 * 60 ? 'post' : '';
}

/** Yahoo 5 分钟线（含盘前盘后）→ 最后一笔 { p, at }；没有就 null */
export function tidyYahooExt(j) {
  const res = j?.chart?.result?.[0];
  const ts = res?.timestamp || [];
  const cl = res?.indicators?.quote?.[0]?.close || [];
  for (let i = Math.min(ts.length, cl.length) - 1; i >= 0; i--) if (Number.isFinite(cl[i]) && cl[i] > 0) return { p: cl[i], at: ts[i] * 1000 };
  return null;
}
const ySym = (t) => (t === 'TASI' ? '^TASI.SR' : /^\d{4}$/.test(t) ? t + '.SR' : t);
let yBlockedAt = 0;
const Y_COOL = 6 * 3_600_000; // 被拒一次就停 6 小时（用户自己抓 Yahoo 的经验值）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Yahoo（不用密钥，美股和沙特股都有，沙特约延迟 15 分钟）。按用户行情文档里的经验求稳：
 * - 一只一只按顺序请求，中间停一下，不并发、不批量轰；一轮最多 24 只，结果缓存 10 分钟，只有管理模式的页面开着才会请求
 * - 如实表明自己是谁，不伪装浏览器、不取 cookie
 * - 一遇到拒绝（429 / 401 / 403）整轮立刻停，6 小时内不再碰 Yahoo（记在数据库里，换了实例也记得），改用备用源
 * - 连续 3 只拿不到数据也当作被限流，同样停下
 */
async function yahooQuotes(env, tickers, now, fetcher, gap = 250) {
  if (!yBlockedAt) yBlockedAt = (await metaGet(env, 'yahoo_block'))?.v?.at || 1;
  if (now - yBlockedAt < Y_COOL) return { ok: false, error: 'yahoo_blocked', until: yBlockedAt + Y_COOL };
  const out = [];
  let status = 0;
  let empty = 0;
  for (const t of tickers.slice(0, 24)) {
    try {
      const res = await fetcher('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ySym(t)) + '?interval=1d&range=1mo', { headers: { 'User-Agent': 'headline-watch/1.0 (private news dashboard)', Accept: 'application/json' } });
      if ([401, 403, 429].includes(res.status)) {
        status = res.status;
        break;
      }
      const q = res.ok ? tidyYahoo(await res.json(), t) : null;
      if (q) {
        out.push(q);
        empty = 0;
      } else if (++empty >= 3) break;
    } catch {
      if (++empty >= 3) break;
    }
    if (gap) await sleep(gap);
  }
  // 注意：这里用明确的起止时间，不用 range=1d / 2d。盘前时 range 是按“上一个正常交易时段”算的，只会给到上个交易日盘后，拿不到当天盘前（2026-11-27 实测）
  // 美股盘前盘后：正常时段的价格不动了，再各取一次带盘前盘后的 5 分钟线（最多 8 只美股，同样一只一只来，被拒就停）
  const ext = !status && out.length ? usExtended(now) : '';
  // 盘前盘后取数的自检信息：试了几只、拿到几只、最后一笔是什么时候，方便只读排查
  const dbg = ext ? { s: ext, tried: 0, got: 0, http: 0, last: 0, err: 0 } : undefined;
  if (ext) {
    for (const q of out.filter((x) => /^[A-Z]{1,5}$/.test(x.t) && x.t !== 'TASI').slice(0, 8)) {
      try {
        const res = await fetcher('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(q.t) + `?interval=5m&period1=${Math.floor(now / 1000) - 20 * 3600}&period2=${Math.floor(now / 1000) + 60}&includePrePost=true`, { headers: { 'User-Agent': 'headline-watch/1.0 (private news dashboard)', Accept: 'application/json' } });
        if ([401, 403, 429].includes(res.status)) {
          status = res.status;
          break;
        }
        dbg.tried++;
        if (!res.ok) dbg.http = res.status;
        const e = res.ok ? tidyYahooExt(await res.json()) : null;
        if (e) dbg.last = Math.max(dbg.last, e.at);
        // 只有确实晚于正常时段最后一笔、且是这两个小时内的，才算盘前 / 盘后价
        if (e && q.at && e.at > q.at + 60_000 && now - e.at < 2 * 3_600_000) (q.ext = { s: ext, p: e.p, chg: Math.round((e.p / q.p - 1) * 10000) / 100, at: e.at }), dbg.got++;
      } catch {
        dbg.err++;
      }
      if (gap) await sleep(gap);
    }
  }
  if (status || (!out.length && empty >= 3)) {
    yBlockedAt = now;
    try {
      await metaSet(env, 'yahoo_block', { at: now, status }, now);
    } catch {}
    if (!out.length) return { ok: false, error: status ? 'yahoo_http' : 'yahoo_fail', status: status || undefined };
  }
  if (!out.length) return { ok: false, error: 'yahoo_fail' };
  return { ok: true, quotes: out, miss: tickers.length - out.length, ext_dbg: dbg };
}

async function tiingoQuotes(env, tickers, fetcher) {
  const us = tickers.filter((t) => /^[A-Z]{1,5}$/.test(t) && t !== 'TASI');
  try {
    const res = await fetcher('https://api.tiingo.com/iex/?tickers=' + encodeURIComponent(us.join(',')), { headers: { Authorization: 'Token ' + env.TIINGO_TOKEN, 'Content-Type': 'application/json' } });
    if (!res.ok) return { ok: false, error: 'quotes_http', status: res.status };
    return { ok: true, quotes: (await res.json()).map(tidyQuote).filter(Boolean) };
  } catch (e) {
    return { ok: false, error: 'quotes_fail', detail: String(e?.message || e).slice(0, 120) };
  }
}

/**
 * 最新一场选题里出现的股票 + 大盘代表的参考价，结果在内存和 meta 里各留 5 分钟。
 * 先试 Yahoo（不用密钥，含沙特股），不行再用 Tiingo（要 TIINGO_TOKEN，只有美股）。两家的条款都只许内部看。
 */
export async function deskQuotes(env, { now = Date.now(), fetcher = fetch, gap = 250, extra = null } = {}) {
  let tickers = QUOTE_BASE.concat(['TASI']);
  for (const k of extra || []) if (/^([A-Z]{1,5}|\d{4})$/.test(k) && !tickers.includes(k)) tickers.push(k);
  if (!extra) try {
    const r = (await env.DB.prepare('SELECT topics FROM desk_runs ORDER BY id DESC LIMIT 1').all()).results?.[0];
    for (const t of safeJson(r?.topics, [])) for (const k of t.tickers || []) if (/^([A-Z]{1,5}|\d{4})$/.test(k) && !tickers.includes(k)) tickers.push(k);
  } catch {}
  tickers = tickers.slice(0, 24);
  const key = tickers.join(',');
  const ttl = 10 * 60_000;
  // 榜上的股票随时在变：10 分钟内已经拿过一轮的，不因为名单变了就再请求一轮
  if (qmem.data && (qmem.key === key || extra) && now - qmem.at < ttl) return { ok: true, at: qmem.at, src: qmem.src, quotes: qmem.data, ext_dbg: qmem.dbg };
  const m = await metaGet(env, 'desk_quotes');
  if ((m?.v?.key === key || extra) && m?.v && now - m.v.at < ttl) {
    Object.assign(qmem, { at: m.v.at, key, data: m.v.data, src: m.v.src, dbg: m.v.dbg });
    return { ok: true, at: m.v.at, src: m.v.src, quotes: m.v.data, ext_dbg: m.v.dbg };
  }
  let src = env.QUOTES === 'tiingo' ? '' : 'yahoo';
  let r = src ? await yahooQuotes(env, tickers, now, fetcher, gap) : { ok: false, error: 'off' };
  const yErr = r.ok ? undefined : { error: r.error, status: r.status };
  if (!r.ok) {
    if (!env.TIINGO_TOKEN) return { ok: false, error: env.QUOTES === 'tiingo' ? 'no_token' : r.error, status: r.status, fallback: 'no_token' };
    src = 'tiingo';
    r = await tiingoQuotes(env, tickers, fetcher);
    if (!r.ok) return { ...r, yahoo: yErr };
  }
  Object.assign(qmem, { at: now, key, data: r.quotes, src, dbg: r.ext_dbg });
  await metaSet(env, 'desk_quotes', { key, at: now, data: r.quotes, src, dbg: r.ext_dbg }, now);
  return { ok: true, at: now, src, quotes: r.quotes, miss: r.miss || undefined, yahoo: yErr, ext_dbg: r.ext_dbg };
}
