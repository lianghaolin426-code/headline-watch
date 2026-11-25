// Headline Watch：每分钟抓一次各个快讯源，去重、按关键词/大数字过滤，
// 存进 D1 数据库，并推送到已配置的渠道（可以一个都不配，只看网页）。

import { parseTelegram, parseFeed } from './parse.js';
import { matchItem, parseKeywords, maxAmountBillions } from './filter.js';
import { aiScores, routinePenalty, splitTopic } from './score.js';
import { CLAUDE_MODEL, claudeText, claudeOn, claudeUp, claudeState, claudeUsage, claudeUsd } from './claude.js';
import { parseCnJson } from './cnfeeds.js';
import { embed, pack, unpack, cos, isZh } from './embed.js';
import { tokens, sameStory, confirmBoost, idfWeights } from './similar.js';
import { notifyAll, enabledChannels } from './notify.js';
import { pushToSubscribers, saveSubscription, removeSubscription, getSubscription, listSubscriptions, vapidKeys, sendPush, dailyCounts, SW_JS } from './webpush.js';
import { renderPage, BUILD } from './page.js';
import { iconName, iconResponse, faviconSvg, ICON_VERSION, LOGO_STYLES, DEFAULT_LOGO } from './icons.js';
import { translatePending } from './translate.js';
import { runBriefs, listBriefs, isBig } from './brief.js';
import { pageable, fetchPage, rawPage } from './backfill.js';
import { guard, flushReads, budget, cached, ensureSchema, dbBlocked, noteDbError, readsStatus, metaGet, metaSet, cacheSet, LEVELS } from './dbguard.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function config(env) {
  let sources = [];
  try {
    sources = JSON.parse(env.SOURCES || '[]');
  } catch (e) {
    console.error('SOURCES 不是合法 JSON', e);
  }
  return {
    sources,
    rules: { keywords: parseKeywords(env.KEYWORDS), bigNumbers: env.BIG_NUMBERS !== 'false' },
    notifyMode: env.NOTIFY_MODE || 'matched', // matched | all | off
    maxAgeMs: Number(env.MAX_AGE_MINUTES || 30) * 60_000,
    maxPerRun: Number(env.MAX_NOTIFY_PER_RUN || 10),
    keepDays: Number(env.KEEP_DAYS || 7),
    threshold: Number(env.AI_THRESHOLD || 8),
    bigMin: Number(env.BIG_NUMBER_MIN_BILLION || 10),
    aiOn: env.AI_SCORING !== 'false',
    aiTags: env.AI_TAGS !== 'false',
    aiWaitMin: Number(env.AI_BATCH_WAIT_MIN ?? 5),
    aiBatchSize: Number(env.AI_BATCH_SIZE || 8),
    aiUrgentWaitMin: Number(env.AI_URGENT_WAIT_MIN ?? 3),
    aiUrgent: new Set(String(env.AI_URGENT_SOURCES || '').split(',').map((x) => x.trim()).filter(Boolean)),
    maxAi: Number(env.MAX_AI_PER_RUN || 15),
    weights: safeJson(env.SOURCE_WEIGHTS, {}),
    xlangOn: env.CROSS_LANGUAGE !== 'false',
    xlangMin: Number(env.CROSS_LANGUAGE_MIN || 0.65),
    trOn: env.TRANSLATE !== 'false',
    trMin: Number(env.TRANSLATE_MIN_SCORE || 6),
    trMax: Number(env.MAX_TRANSLATE_PER_RUN || 8),
    trProvider: env.TRANSLATE_PROVIDER || 'ai',
    trFallback: env.TRANSLATE_FALLBACK || 'mymemory', // TRANSLATE_PROVIDER="claude" 翻不出来时交给谁
    trAiMin: Number(env.TRANSLATE_AI_FALLBACK_MIN || 0),
    // 深度文章（来源配置里 "kind": "article"）：不算多源确认、不推送，只挂到同一件事的快讯下面
    articles: new Set(sources.filter((s) => s.kind === 'article').map((s) => s.name)),
    artAi: env.ARTICLE_AI_SCORING === 'true', // 额度宽裕时可开：深度文章也让 AI 打分（仍不推送）
    relHours: Number(env.RELATED_HOURS || 12), // 文章和多久以内的快讯比对
    relSameVec: env.RELATED_SAME_LANG_VEC === 'true', // 额度宽裕时可开：同语言之间也用向量模型匹配（默认只用词重合）
    relSameMin: Number(env.RELATED_SAME_LANG_MIN || 0.8),
    relClaude: env.RELATED_CLAUDE !== 'false', // 有 Claude 时，让 Claude 判断文章讲的是哪几条快讯（标题评论化时规则很难对上）
  };
}

function safeJson(s, d) {
  try {
    return s ? JSON.parse(s) : d;
  } catch {
    return d;
  }
}

/** 规则打分（AI 不可用时的退路）：关键词或超大金额 = 8 分，其他命中 = 5 分 */
function ruleScore(it, cfg) {
  if (it.kwHit || it.amount >= cfg.bigMin) return 8;
  return it.hits.length ? 5 : 0;
}

function enrich(it, cfg) {
  it.hits = matchItem(it, cfg.rules);
  it.kwHit = matchItem(it, { keywords: cfg.rules.keywords, bigNumbers: false }).length > 0;
  it.amount = maxAmountBillions(`${it.title}\n${it.body || ''}`);
  it.weight = Number(cfg.weights[it.source] ?? 0);
  return it;
}

/**
 * 最近 24 小时里用过的话题（"英文|中文"，按条数从多到少，最多 40 个）：交给 AI 照着用，同一件事就不会被打成好几种叫法。
 * 走 5 分以上快讯的部分索引，一次只读几百行；结果缓存 10 分钟。查不到就当没有，不影响打分。
 */
async function knownTopics(env, now = Date.now()) {
  try {
    return await cached('known_topics', 10 * 60_000, async () => {
      const rows = (await env.DB.prepare('SELECT topic, COUNT(*) AS n FROM items WHERE ts > ? AND score >= 5 AND dup_of IS NULL AND topic IS NOT NULL GROUP BY topic').bind(now - 24 * 3_600_000).all()).results;
      const m = new Map();
      for (const r of rows) {
        const [en, zh] = String(r.topic || '').split('|');
        const k = en.toLowerCase();
        if (!k) continue;
        const o = m.get(k) || { en, zh: '', n: 0 };
        o.n += r.n;
        if (zh && !o.zh) o.zh = zh;
        m.set(k, o);
      }
      return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 40).map((o) => o.en + (o.zh ? '|' + o.zh : ''));
    });
  } catch {
    return [];
  }
}

/** 给一批快讯打分并写回数据库：规则粗筛出候选 → AI 打分 → 来源加权、例行新闻减分；AI 失败时用规则 */
async function scoreItems(env, cfg, list, report) {
  // AI 很便宜（每条标题只要几十个 token），所以新快讯全部交给 AI 打分；
  // 超出单轮上限时，优先给规则命中的和高权重来源的
  const candidates = [...list]
    .sort((a, b) => (b.hits.length > 0) + (b.weight >= 1) - ((a.hits.length > 0) + (a.weight >= 1)) || b.ts - a.ts)
    .slice(0, cfg.maxAi);
  const scores = cfg.aiOn ? await aiScores(env, candidates, { tags: cfg.aiTags, topics: cfg.aiTags ? await knownTopics(env) : [] }) : null;
  if (scores?.usage) await addUsage(env, report, scores.usage, scores.provider);
  if (report && (scores?.fixed || scores?.dropped)) {
    report.renumbered = (report.renumbered || 0) + scores.fixed;
    report.dropped = (report.dropped || 0) + scores.dropped;
  }
  if (cfg.aiOn && candidates.length && !scores) report.errors.push('AI 打分失败，本轮用规则判断');
  candidates.forEach((it, k) => {
    if (scores && scores[k] != null) {
      it.score = Math.max(0, Math.min(10, scores[k] + it.weight + routinePenalty(it.title)));
      // 命中用户自己列的关键词（破产、做空等）时，AI 给得再低也保底 6 分，能在“6 分以上”里看到
      if (it.kwHit) it.score = Math.max(it.score, 6);
      it.scoreBy = 'ai';
      it.tags = scores.tags?.[k] || null;
    }
  });
  const updates = [];
  for (const it of list) {
    if (it.score == null) {
      it.score = it.hits.length || it.weight >= 1 ? ruleScore(it, cfg) : 0;
      it.scoreBy = 'rule';
    }
    it.base = it.score;
    it.score = Math.min(10, it.base + confirmBoost(it.confirms || 0));
    it.important = it.score >= cfg.threshold && !cfg.articles?.has(it.source); // 深度文章即使打了分也不算重要、不推送
    updates.push(
      env.DB.prepare('UPDATE items SET score = ?, base_score = ?, confirms = ?, important = ?, score_by = ?, hits = ? WHERE id = ?').bind(
        // AI 打出的 0 分照实存（不然会被当成“尚未评分”，补分时又被反复重打）；规则没命中的仍记为空
        it.scoreBy === 'ai' ? it.score : it.score || null, it.base, it.confirms || 0, it.important ? 1 : 0, it.scoreBy === 'ai' || it.score ? it.scoreBy : null, it.hits.join(' | '), it.id)
    );
  }
  if (updates.length) await env.DB.batch(updates);
  // AI 给的标签（方向、股票代码、话题、板块）单独写：数据库还没跑 migrate-v6.sql 时不影响打分
  const tagged = list.filter((it) => it.tags);
  if (tagged.length) {
    try {
      await env.DB.batch(
        tagged.map((it) =>
          env.DB.prepare('UPDATE items SET dir = ?, tickers = ?, topic = ?, sector = ? WHERE id = ?').bind(it.tags.dir, it.tags.tickers, it.tags.topic, it.tags.sector, it.id)
        )
      );
    } catch (e) {
      console.warn('saving tags failed (run migrate-v6.sql?)', e?.message || e);
    }
  }
}

/** 记下今天 AI 打分用了多少 token（看板和 /api/status 用来估算免费额度用了多少） */
async function addUsage(env, report, u, provider = 'workers') {
  if (report) {
    report.aiUsage = report.aiUsage || { calls: 0, prompt: 0, completion: 0 };
    report.aiUsage.calls++;
    report.aiUsage.prompt += u.prompt;
    report.aiUsage.completion += u.completion;
    report.aiUsage.provider = provider;
  }
  if (provider === 'claude') return; // Claude 的用量在 claude.js 里单独记（claude_usage 表）
  try {
    await env.DB.prepare(
      `INSERT INTO ai_usage (day, calls, prompt_tokens, completion_tokens) VALUES (?, 1, ?, ?)
       ON CONFLICT(day) DO UPDATE SET calls = calls + 1, prompt_tokens = prompt_tokens + excluded.prompt_tokens, completion_tokens = completion_tokens + excluded.completion_tokens`
    )
      .bind(new Date().toISOString().slice(0, 10), u.prompt, u.completion)
      .run();
  } catch {
    // 还没有 ai_usage 表（没跑 migrate-v6.sql）时忽略
  }
}

/**
 * 多源互证：新快讯和最近 6 小时其他来源的快讯比对，说的是同一件事就互相加分。
 * 先算新快讯被几个其他来源报道（写到 it.confirms，打分时加分），
 * 返回需要更新的旧快讯（它们也因为新来源的报道而加分）。
 */
async function findConfirmations(env, cfg, fresh, now) {
  const freshIds = new Set(fresh.map((f) => f.id));
  const recent = (
    await env.DB.prepare(
      'SELECT id, source, title, url, ts, base_score, confirms, important, notified, score_by, hits, dup_of FROM items WHERE ts > ? ORDER BY ts DESC LIMIT 800'
    )
      .bind(now - 3 * 3_600_000)
      .all()
  ).results.filter((r) => !freshIds.has(r.id) && !cfg.articles.has(r.source));
  for (const r of recent) r.tok = tokens(r.title);
  for (const f of fresh) f.tok = tokens(f.title);
  const W = idfWeights([...recent, ...fresh].map((x) => x.tok));
  await crossLanguage(env, cfg, fresh, now); // 中英文之间：f.xl = 匹配到的旧快讯 id，f.xlFresh = 匹配到的本轮快讯
  const bumped = new Map();
  for (const f of fresh) {
    const srcs = new Set();
    f.matches = [];
    f.freshMatches = [];
    for (const r of recent) {
      if (r.source === f.source) continue;
      if (!(f.xl?.has(r.id) || sameStory(f.tok, r.tok, W))) continue;
      srcs.add(r.source);
      f.matches.push(r);
      if (!bumped.has(r.id)) bumped.set(r.id, { row: r, add: new Set(), by: [] });
      bumped.get(r.id).add.add(f.source);
      bumped.get(r.id).by.push(f);
    }
    for (const g of fresh) {
      if (g === f || g.source === f.source) continue;
      if (!(f.xlFresh?.has(g) || g.xlFresh?.has(f) || sameStory(f.tok, g.tok, W))) continue;
      srcs.add(g.source);
      f.freshMatches.push(g);
    }
    f.confirms = srcs.size;
  }
  fresh.recent = recent; // relate() 拿去当词频参照，不用再查一遍
  return [...bumped.values()];
}

// 标题向量在本实例内存里留一份（向量写进去就不会再变，缓存不会过期）：
// 以前每分钟把最近 2 小时的向量全读一遍（约 250 行），来新文章时还要读 6 小时的（上千行）；现在只读上次之后新增的几行。
// 实例被回收后第一次运行会整段重读，结果完全一样。
const VEC = { rows: new Map(), from: Infinity, max: 0 };
function vecRemember(id, ts, zh, v) {
  VEC.rows.set(id, { id, ts, zh: zh ? 1 : 0, v });
  if (ts > VEC.max) VEC.max = ts;
}
/** 最近（ts > since）的全部向量：[{id, ts, zh, v}] */
export async function recentVecs(env, since, now = Date.now()) {
  for (const [id, r] of VEC.rows) if (r.ts < now - 7 * 3_600_000) VEC.rows.delete(id);
  if (VEC.from < now - 7 * 3_600_000) VEC.from = now - 7 * 3_600_000;
  // 缓存覆盖不到这么早，或者太久没更新：整段读；否则只读新增的（往前多读 3 分钟，防止别的实例同时写入的漏掉）
  const full = since < VEC.from || now - VEC.max > 30 * 60_000;
  const from = full ? since : Math.max(since, VEC.max - 3 * 60_000);
  const rows = (await env.DB.prepare('SELECT id, ts, zh, v FROM vecs WHERE ts > ?').bind(from).all()).results;
  for (const r of rows) if (!VEC.rows.has(r.id)) vecRemember(r.id, r.ts, r.zh, unpack(r.v));
  if (full) VEC.from = since;
  if (now > VEC.max) VEC.max = Math.max(VEC.max, now - 60_000);
  return [...VEC.rows.values()].filter((r) => r.ts > since);
}
export function _vecCache() {
  return VEC;
}

/**
 * 跨语言互证：给新快讯求向量存起来，再和最近 2 小时“另一种语言”的快讯比相似度。
 * 校准结果：同一件事的中英文标题相似度一般在 0.65 以上，不相关的在 0.6 以下。
 */
async function crossLanguage(env, cfg, fresh, now) {
  if (!cfg.xlangOn || !fresh.length) return;
  const vecs = await embed(env, fresh.map((f) => f.title));
  if (!vecs) return;
  const stmts = [];
  fresh.forEach((f, i) => {
    f.vec = pack(vecs[i]);
    f.zh = isZh(f.title);
    stmts.push(env.DB.prepare('INSERT OR REPLACE INTO vecs (id, ts, zh, v) VALUES (?, ?, ?, ?)').bind(f.id, now, f.zh ? 1 : 0, new Uint8Array(f.vec.buffer)));
  });
  await env.DB.batch(stmts);
  const freshIds = new Set(fresh.map((f) => f.id));
  const rows = (await recentVecs(env, now - 2 * 3_600_000, now)).filter((r) => !freshIds.has(r.id));
  for (const f of fresh) vecRemember(f.id, now, f.zh, f.vec);
  const zhRows = rows.filter((r) => r.zh);
  const enRows = rows.filter((r) => !r.zh);
  for (const f of fresh) {
    f.xl = new Set();
    f.xlFresh = new Set();
    for (const r of f.zh ? enRows : zhRows) if (cos(f.vec, r.v) >= cfg.xlangMin) f.xl.add(r.id);
    for (const g of fresh) if (g.zh !== f.zh && cos(f.vec, g.vec) >= cfg.xlangMin) f.xlFresh.add(g);
  }
}

/** 深度文章：默认不调 AI（解读和评论不是突发快讯，省额度给快讯）；无论怎么打分都不算重要、不推送 */
async function scoreArticles(env, cfg, arts, report) {
  if (cfg.artAi && cfg.aiOn) {
    const list = arts.map((a) => Object.assign(a, { confirms: 0 }));
    for (let i = 0; i < list.length; i += cfg.maxAi) await scoreItems(env, { ...cfg, threshold: Infinity }, list.slice(i, i + cfg.maxAi), report);
    return;
  }
  await env.DB.batch(
    arts.map((a) => env.DB.prepare("UPDATE items SET score = NULL, base_score = NULL, important = 0, score_by = 'article' WHERE id = ?").bind(a.id))
  );
}

async function safeRelate(env, cfg, opts, report) {
  try {
    const n = await relate(env, cfg, opts);
    if (n && report) report.related = (report.related || 0) + n;
  } catch (e) {
    console.warn('relate skipped (run migrate-v7.sql?)', e?.message || e);
  }
}

/**
 * 把深度文章挂到同一件事的快讯下面（写进 related 表，快讯一律记到这件事最早那条上）。
 * 判断“同一件事”：中文之间、英文之间按标题用词重合（纯规则，不花额度）；
 * 中英文之间用向量（很便宜，额度用光时这一层自动跳过）。
 * arts：新来的文章，和最近 relHours 小时的快讯比；flashes：新来的快讯，和最近的文章比。
 */
export async function relate(env, cfg, { arts = [], flashes = [], now = Date.now() }) {
  if (!arts.length && !flashes.length) return 0;
  // 只有新快讯（每分钟都有）时只需要最近的深度文章：按来源走索引，几十行；
  // 词频参照用打分时已经读过的最近 3 小时快讯（flashes.recent），不再把 12 小时的快讯全读一遍
  const onlyFlashes = !arts.length && flashes.recent && cfg.articles.size;
  const artList = [...cfg.articles];
  const rows = onlyFlashes
    ? [
        ...(
          await env.DB.prepare(`SELECT id, source, title, body, score, ts, dup_of FROM items WHERE source IN (${artList.map(() => '?').join(',')}) AND ts > ? ORDER BY ts DESC LIMIT 300`)
            .bind(...artList, now - cfg.relHours * 3_600_000)
            .all()
        ).results,
        ...flashes.recent,
      ]
    : (await env.DB.prepare('SELECT id, source, title, body, score, ts, dup_of FROM items WHERE ts > ? ORDER BY ts DESC LIMIT 2000').bind(now - cfg.relHours * 3_600_000).all()).results;
  const newIds = new Set([...arts, ...flashes].map((x) => x.id));
  const oldArts = rows.filter((r) => cfg.articles.has(r.source) && !newIds.has(r.id));
  const oldFlashes = rows.filter((r) => !cfg.articles.has(r.source) && !newIds.has(r.id));
  const all = [...rows.filter((r) => !newIds.has(r.id)), ...arts, ...flashes];
  for (const x of all) x.tok = x.tok || tokens(x.title);
  const W = idfWeights(all.map((x) => x.tok));

  // 向量：新文章求一次存起来；其余从 vecs 表读（快讯的向量打分时已经存过）
  const vec = new Map();
  if (cfg.xlangOn) {
    const need = arts.filter((a) => !a.vec);
    if (need.length) {
      const v = await embed(env, need.map((a) => a.title));
      if (v) {
        need.forEach((a, i) => (a.vec = pack(v[i])));
        await env.DB.batch(need.map((a) => env.DB.prepare('INSERT OR REPLACE INTO vecs (id, ts, zh, v) VALUES (?, ?, ?, ?)').bind(a.id, now, isZh(a.title) ? 1 : 0, new Uint8Array(a.vec.buffer))));
        for (const a of need) vecRemember(a.id, now, isZh(a.title), a.vec);
      }
    }
    for (const x of [...arts, ...flashes]) if (x.vec) vec.set(x.id, x.vec);
    // 只有新快讯时，只要旧文章的向量（先查本实例缓存，缺的按主键取）；有新文章时才要最近 6 小时全部快讯的向量
    for (const a of onlyFlashes ? oldArts : []) if (!vec.has(a.id) && VEC.rows.has(a.id)) vec.set(a.id, VEC.rows.get(a.id).v);
    const want = onlyFlashes ? oldArts.map((a) => a.id).filter((id) => !vec.has(id)).slice(0, 90) : null;
    const vr = want
      ? want.length
        ? (await env.DB.prepare(`SELECT id, ts, zh, v FROM vecs WHERE id IN (${want.map(() => '?').join(',')})`).bind(...want).all()).results.map((r) => {
            const v = unpack(r.v);
            vecRemember(r.id, r.ts, r.zh, v);
            return { id: r.id, v };
          })
        : []
      : await recentVecs(env, now - 6 * 3_600_000, now);
    for (const r of vr) if (!vec.has(r.id)) vec.set(r.id, r.v);
  }
  const same = (a, f) => {
    const va = vec.get(a.id), vf = vec.get(f.id);
    const cross = isZh(a.title) !== isZh(f.title);
    if (va && vf && (cross || cfg.relSameVec)) {
      if (cos(va, vf) >= (cross ? cfg.xlangMin : cfg.relSameMin)) return true;
    }
    return !cross && sameStory(a.tok, f.tok, W);
  };
  const pairs = new Map(); // "head|article" → true
  const add = (f, a) => {
    const head = f.dupOf || f.dup_of || f.id;
    pairs.set(`${head}|${a.id}`, [head, a.id]);
  };
  for (const a of arts) {
    let n = 0;
    for (const f of [...flashes, ...oldFlashes]) if (n < 12 && same(a, f)) (add(f, a), n++);
  }
  for (const f of flashes) for (const a of oldArts) if (same(a, f)) add(f, a);
  // Claude：给每篇新文章挑候选快讯（同一件事只留最早那条），让它判断文章主要讲的是哪几条
  if (cfg.relClaude && arts.length && claudeUp(env)) {
    const heads = [...flashes.filter((f) => !f.dupOf), ...oldFlashes.filter((f) => !f.dup_of)];
    for (const a of arts) {
      const hit = await claudeRelate(env, a, candidatesFor(a, heads, W));
      for (const f of hit) add(f, a);
    }
  }
  if (!pairs.size) return 0;
  await env.DB.batch([...pairs.values()].map(([h, a]) => env.DB.prepare('INSERT OR IGNORE INTO related (flash_id, article_id, ts) VALUES (?, ?, ?)').bind(h, a, now)));
  return pairs.size;
}

/**
 * 候选快讯（只取文章发出前 12 小时到发出后 1 小时的）：
 * 和文章用词重合最多的 30 条（中文快讯主要靠这个），加上分数 7 以上的重要快讯（英文快讯和中文标题没有共同用词，靠这个进候选），
 * 标题几乎一样的只留一条，最多 120 条。
 */
export function candidatesFor(a, heads, W) {
  const t = a.ts || Date.now();
  const near = heads.filter((f) => !f.ts || (f.ts > t - 12 * 3_600_000 && f.ts < t + 3_600_000));
  const overlap = (f) => {
    let wi = 0;
    for (const w of a.tok) if (f.tok.has(w)) wi += W(w);
    return wi;
  };
  const byWords = near.map((f) => [overlap(f), f]).filter((x) => x[0] > 0).sort((x, y) => y[0] - x[0]).slice(0, 30).map((x) => x[1]);
  const byScore = near.filter((f) => (f.score || 0) >= 7).sort((x, y) => y.score - x.score || y.ts - x.ts);
  const seen = new Set();
  const out = [];
  for (const f of [...byWords, ...byScore]) {
    const k = String(f.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 40);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
    if (out.length >= 120) break;
  }
  return out;
}

// 分两步问：先只看文章说出它围绕的新闻事件（不给快讯列表，免得被满屏的大新闻带偏），再拿这个事件去挑快讯
const EVENT_SYSTEM = `You read the title and summary of an in-depth financial article and name the one concrete news event it is built around, in a short sentence in the article's language.
Most such articles are macro outlooks, strategy or theme pieces, or explainers with no single recent news event: answer exactly none for those.
Reply with the event sentence or none, nothing else.`;

const SUBJECT_STOP = new Set(['the', 'and', 'ceo', 'inc', 'corp', 'stock', 'shares', 'deal', 'reinstatement', 'us', 'u.s.', '美国', '公司', '股价']);
const PICK_SYSTEM = `You get a news event and numbered news flashes (Chinese or English).
First name the event's main subject (the company, person, central bank, asset or deal it is about).
A flash qualifies only if it is about that same subject AND reports this event or a direct development of it (the announcement, official statements about it, the market or stock reaction to it, investigations about it).
Flashes about other subjects never qualify, however big the news. Often no flash qualifies.
Reply with JSON only: {"subject": "...", "ids": [numbers]}, at most 8 ids, most direct first, [] if none.`;

/** 让 Claude 挑出和文章说同一件事的快讯；失败或没有就返回 [] */
export async function claudeRelate(env, a, cands) {
  if (!cands.length) return [];
  const e = await claudeText(env, { system: EVENT_SYSTEM, user: `Title: ${a.title}\nSummary: ${String(a.body || '').slice(0, 400)}`, maxTokens: 80, kind: 'relate' });
  const ev = (e?.text || '').trim().replace(/^["'“]|["'”]$/g, '');
  if (env.RELATE_DEBUG) env.RELATE_DEBUG.push({ article: a.title.slice(0, 40), event: ev });
  if (!ev || /^none\b/i.test(ev)) return [];
  const list = cands.map((f, i) => `${i + 1}. ${String(f.title).slice(0, 160)}`).join('\n');
  const r = await claudeText(env, { system: PICK_SYSTEM, user: `Event: ${ev}\n\nFlashes:\n${list}`, maxTokens: 100, kind: 'relate' });
  const m = r?.text.match(/"ids"\s*:\s*(\[[\d,\s]*\])/) || r?.text.match(/\[[\d,\s]*\]/);
  if (env.RELATE_DEBUG) env.RELATE_DEBUG[env.RELATE_DEBUG.length - 1].pick = (r?.text || '').slice(0, 120);
  if (!m) return [];
  try {
    // 防止模型写错编号：挑中的快讯标题里至少要出现主体里的一个词（公司名、人名等），对不上的丢掉
    const subject = r.text.match(/"subject"\s*:\s*"([^"]*)"/)?.[1] || '';
    const terms = subject
      .toLowerCase()
      .split(/[\/()（）,，、;；|\s]+/)
      .filter((w) => (/[a-z]/.test(w) ? w.length >= 3 : w.length >= 2) && !SUBJECT_STOP.has(w));
    const ok = (f) => !terms.length || terms.some((w) => String(f.title).toLowerCase().includes(w));
    return [...new Set(JSON.parse(m[1] || m[0]))]
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= cands.length)
      .map((n) => cands[n - 1])
      .filter(ok)
      .slice(0, 8);
  } catch {
    return [];
  }
}

async function fetchSource(src, env = {}) {
  const url = src.type === 'telegram' ? `${src.base || 'https://t.me/s/'}${src.channel}` : src.url;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: ctrl.signal, cf: { cacheTtl: 0 } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (src.type === 'telegram' && !r.url.includes('/s/')) throw new Error('Telegram 把请求重定向了（不允许从 Cloudflare 读取频道网页）');
    const text = await r.text();
    const items =
      src.type === 'telegram'
        ? parseTelegram(text, src.channel)
        : src.type === 'cnjson'
          ? parseCnJson(text, src.name, src.format)
          : parseFeed(text, src.name || url);
    if (src.name && src.type === 'telegram') items.forEach((i) => (i.source = src.name));
    // 有的源把当地时间当成 UTC 写（如 Argaam 的利雅得时间 UTC+3）：配置 "tzHours": 3 修正
    if (src.tzHours) items.forEach((i) => (i.ts -= src.tzHours * 3_600_000));
    // 发布时间不可能晚于现在：未来时间一律按抓取时间算，免得一直顶在最上面
    const now = Date.now();
    items.forEach((i) => (i.ts = Math.min(i.ts, now)));
    return focusFilter(src, items);
  } finally {
    clearTimeout(timer);
  }
}

// 中文快讯的关注范围：美国市场、美国政策、美股大公司、沙特/中东/原油、全球宏观
const FOCUS_ZH =
  '美股|美国|美联储|美元|美债|鲍威尔|特朗普|白宫|华尔街|纳指|纳斯达克|标普|道指|道琼斯|罗素|VIX|恐慌指数|非农|CPI|PCE|GDP|' +
  '英伟达|黄仁勋|苹果|微软|谷歌|亚马逊|Meta|特斯拉|马斯克|OpenAI|Anthropic|博通|台积电|伯克希尔|巴菲特|摩根|高盛|贝莱德|' +
  '沙特|阿美|利雅得|中东|海湾|OPEC|欧佩克|原油|油价|布伦特|WTI|伊朗|以色列|霍尔木兹|' +
  '黄金|比特币|关税|制裁|收购|并购|破产|暴跌|暴涨|熔断|[A-Z]{2,5}\\.(?:O|N)\\b|美股盘前|美股盘后|美股收盘|美股开盘';

// 只关注美股、沙特股：中文快讯里 A 股、港股、国内政策等本地新闻直接丢掉，只留和美国/沙特/全球宏观相关的
function focusFilter(src, items) {
  if (src.skip === 'pr') items = items.filter((i) => !isPrJunk(i.title));
  if (src.enOnly) items = items.filter((i) => !isForeign(i.title));
  if (!src.focus) return items;
  const re = new RegExp(src.focus === true ? FOCUS_ZH : src.focus, 'i');
  return items.filter((i) => re.test(i.title));
}

// 新闻稿源（PR Newswire）里的两类垃圾，入库前就丢掉，不占打分、翻译和数据库额度：
// 1) 同一篇稿子的西班牙语、法语、德语、荷兰语等版本（英文版另有一条）；2) 律所招揽集体诉讼的广告（"Stock Drop Notice"、"SHAREHOLDER ALERT"）。
// 2026-11-25 按前 24 小时的 547 条实测：外语 73 条、律所 19 条，英文正常稿没有误伤。
const FOREIGN_WORDS = /(?<![\p{L}.])(?:de|la|le|les|des|du|una|el|los|las|und|der|das|mit|für|para|con|por|sur|avec|dans|aux|zum|zur|sich|ist|van|het|een|voor|met|och|nas|sua|seu|ao|dos|dass|auf|eine|einen|bekannt|nach|über)(?![\p{L}])/giu;
export function isForeign(t) {
  const s = String(t || '');
  const words = (s.match(FOREIGN_WORDS) || []).length;
  const accents = (s.match(/[àáâãçéèêëíîïñóôõöúùûüÿæœßąćęłńśźżčďěňřšťůž]/gi) || []).length;
  return words >= 2 || accents >= 3;
}
const PR_JUNK = /stock drop notice|shareholder alert|investor (notice|deadline|alert)|securities (fraud|violations?|class action|litigation)|class action (lawsuit|filed|against|on behalf)|files? a class action|lead (a )?class action|lead plaintiff|investigation (notice|into the fairness)|notifies (former )?(stockholders|investors|shareholders)|investors with substantial losses/i;
export const isPrJunk = (t) => PR_JUNK.test(String(t || ''));

function sourceKey(src) {
  return src.type === 'telegram' ? `tg:${src.channel}` : `rss:${src.name || src.url}`;
}

// inputs：外部推进来的数据（GitHub 定时任务抓的 Telegram 页面），格式 [{src, items}]；不传则自己抓 SOURCES
// backfill：补抓模式，不更新 source_state（不影响正常抓取的去重记录和状态页）
export async function runOnce(env, { now = Date.now(), notify = true, inputs = null, backfill = false } = {}) {
  const cfg = config(env);
  const db = env.DB;
  const report = { fetched: 0, inserted: 0, matched: 0, notified: 0, errors: [] };

  // last_ids：上一轮从这个源抓到的条目 id。源每次都返回最近 30 条左右，绝大多数上一轮已经入库，
  // 先在内存里去掉，省得每条都去数据库 INSERT OR IGNORE（每条算 1 行读取，一天上百万行）
  let stateRows;
  try {
    stateRows = (await db.prepare('SELECT key, runs, last_ok, last_error, last_error_at, last_ids FROM source_state').all()).results;
  } catch {
    stateRows = (await db.prepare('SELECT key, runs, last_ok, last_error, last_error_at FROM source_state').all()).results; // 还没加 last_ids 列
  }
  const states = new Map(stateRows.map((r) => [r.key, r.runs]));
  const stateOf = new Map(stateRows.map((r) => [r.key, r]));
  const lastIds = new Map(stateRows.map((r) => [r.key, r.last_ids]));
  const hasLastIds = stateRows.length === 0 || 'last_ids' in stateRows[0];

  // 有的源限制频率（every: 每隔几分钟抓一次），没到时间的这轮跳过。
  // 一直失败的源（比如 Arab News 对 Cloudflare 返回 403）：连续失败超过 30 分钟后改成每 10 分钟试一次，恢复后自动回到每分钟
  const minute = Math.floor(now / 60_000);
  const failing = (src) => {
    const st = stateOf.get(sourceKey(src));
    // 从来没成功过的源（新加的）不降频，免得一次偶然失败就要等 10 分钟
    return !!(st?.last_error && st.last_ok && now - st.last_ok > 30 * 60_000);
  };
  const sources = inputs ? inputs.map((x) => x.src) : cfg.sources.filter((src) => (!src.every || minute % src.every === 0) && (!failing(src) || minute % 10 === 0));
  // source_state 的写入攒成一批（以前每个源单独写一次，每分钟二十多次写入，一天 3 万多行，占免费写入额度的三成）
  const stateWrites = [];
  const QUIET_MS = 10 * 60_000; // 源没有变化时，最多隔这么久才写一次状态（看板上“最后成功”的时间最多晚 10 分钟）
  const settled = inputs
    ? inputs.map((x) => (x.error ? { status: 'rejected', reason: new Error(x.error) } : { status: 'fulfilled', value: x.items }))
    : await Promise.allSettled(sources.map((src) => fetchSource(src, env)));
  const toNotify = [];
  const fresh = [];

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const key = sourceKey(src);
    const res = settled[i];
    if (res.status === 'rejected') {
      const msg = String(res.reason?.message || res.reason);
      report.errors.push(`${key}: ${msg}`);
      const st = stateOf.get(key);
      // 同样的错误 10 分钟内已经记过，就不再写
      if (st && st.last_error === msg && now - (st.last_error_at || 0) < QUIET_MS) continue;
      stateWrites.push(
        db
          .prepare(
            `INSERT INTO source_state (key, runs, last_ok, last_error, last_error_at) VALUES (?, 0, NULL, ?, ?)
           ON CONFLICT(key) DO UPDATE SET last_error = excluded.last_error, last_error_at = excluded.last_error_at`
          )
          .bind(key, msg, now)
      );
      continue;
    }
    const items = res.value;
    report.fetched += items.length;
    // 第一次抓某个源时，只入库不推送，避免一上来推几十条旧闻
    const firstRun = !states.get(key);

    let prev;
    try {
      prev = new Set(JSON.parse(lastIds.get(key) || '[]'));
    } catch {
      prev = new Set();
    }
    const todo = items.filter((it) => !prev.has(it.id));
    if (todo.length) {
      const stmts = todo.map((it) => {
        enrich(it, cfg);
        it.firstRun = firstRun;
        return db
          .prepare(
            `INSERT OR IGNORE INTO items (id, source, title, body, url, ts, seen_at, hits)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
          )
          .bind(it.id, it.source, it.title, it.body || '', it.url || '', it.ts, now, it.hits.join(' | '));
      });
      const results = await db.batch(stmts);
      results.forEach((r, j) => {
        if (!r.results?.length) return; // 已存在
        report.inserted++;
        fresh.push(todo[j]);
      });
    }
    if (backfill) continue;
    const ids = JSON.stringify(items.map((it) => it.id).slice(0, 300));
    // 源和上一轮一模一样（大部分源大部分分钟都是这样）、之前也没有报错：10 分钟内不重复写状态
    const st = stateOf.get(key);
    if (hasLastIds && st && !st.last_error && ids === st.last_ids && now - (st.last_ok || 0) < QUIET_MS) continue;
    stateWrites.push(hasLastIds
      ? db
          .prepare(
            `INSERT INTO source_state (key, runs, last_ok, last_count, last_ids) VALUES (?, 1, ?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET runs = runs + 1, last_ok = excluded.last_ok, last_count = excluded.last_count, last_error = NULL, last_ids = excluded.last_ids`
          )
          .bind(key, now, items.length, ids)
      : db
          .prepare(
            `INSERT INTO source_state (key, runs, last_ok, last_count) VALUES (?, 1, ?, ?)
             ON CONFLICT(key) DO UPDATE SET runs = runs + 1, last_ok = excluded.last_ok, last_count = excluded.last_count, last_error = NULL`
          )
          .bind(key, now, items.length)
    );
  }
  if (stateWrites.length) await db.batch(stateWrites);

  // 深度文章单独处理：不进攒批、不参与多源确认和推送
  const arts = fresh.filter((it) => cfg.articles.has(it.source));
  if (arts.length) for (let k = fresh.length - 1; k >= 0; k--) if (cfg.articles.has(fresh[k].source)) fresh.splice(k, 1);

  // ---- 攒批：每次调用 AI 都要带上一大段固定提示词，一两条就调一次很浪费额度。
  // 规则命中的、高权重来源的快讯照旧马上打分；其余的先记为 wait，攒够 aiBatchSize 条或等满 aiWaitMin 分钟再一起打分。
  // 用 Claude 时不用省额度：新快讯当轮就打分，之前在等的也一并放行（Claude 出错停用期间，仍按下面的规则攒批）。
  if (cfg.aiOn && (env.AI || claudeOn(env)) && cfg.aiWaitMin > 0 && !inputs) {
    try {
      // 三档：规则命中的（关键词、大金额）马上打分；快讯源最多等 aiUrgentWaitMin 分钟；其余最多等 aiWaitMin 分钟。
      // 每次调用的固定开销远大于每条快讯的开销，所以尽量让一次调用多带几条。
      const now0 = (it) => it.hits.length > 0 || it.weight >= 1 || it.firstRun;
      const fast = claudeUp(env, now);
      const limit = (src) => (fast ? 0 : cfg.aiUrgent.has(src) ? cfg.aiUrgentWaitMin : cfg.aiWaitMin) * 60_000;
      const freshIds = new Set(fresh.map((f) => f.id));
      const pend = (
        await db.prepare("SELECT id, source, title, body, url, ts, seen_at FROM items WHERE score_by = 'wait' AND seen_at > ? ORDER BY seen_at LIMIT 60").bind(now - 30 * 60_000).all()
      ).results.filter((r) => !freshIds.has(r.id) && !cfg.articles.has(r.source));
      const waiting = fresh.filter((it) => !now0(it)).length + pend.length;
      const go =
        fresh.some(now0) ||
        waiting >= cfg.aiBatchSize ||
        pend.some((r) => now - r.seen_at >= limit(r.source)) ||
        fresh.some((it) => limit(it.source) <= 0);
      if (go) {
        // 等得最久的先打分；一轮装不下的留到下一轮
        // 等了半小时还没轮到的（极少见），不再等 AI，交给规则，免得一直显示“待评分”
        // 只看 30 分钟到 3 小时前的（不加下限会把整张表扫一遍）
        await db.prepare("UPDATE items SET score_by = NULL WHERE seen_at > ? AND seen_at <= ? AND score_by = 'wait'").bind(now - 3 * 3_600_000, now - 30 * 60_000).run();
        const room = Math.max(0, cfg.maxAi - fresh.length);
        for (const r of pend.slice(0, room)) fresh.push(Object.assign(enrich(r, cfg), { firstRun: false }));
      } else if (fresh.length) {
        await db.batch(fresh.map((it) => db.prepare("UPDATE items SET score_by = 'wait' WHERE id = ?").bind(it.id)));
        report.waiting = waiting;
        fresh.length = 0;
      }
    } catch (e) {
      report.errors.push(`攒批打分出错，本轮照常打分: ${e?.message || e}`);
    }
  }

  // ---- 打分：规则粗筛出候选 → AI 打分 → 来源加权、例行新闻减分 ----
  if (fresh.length) {
    const bumps = await findConfirmations(env, cfg, fresh, now);
    await scoreItems(env, cfg, fresh, report);
    // 同一件事只推一次、看板只显示一条：已有更早的重要快讯（或本轮更早的一条）时，记为它的重复
    const heads = new Set();
    for (const it of [...fresh].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1))) {
      if (!it.important) continue;
      const prior = it.matches.filter((r) => r.important || r.notified).sort((a, b) => a.ts - b.ts)[0];
      const priorFresh = it.freshMatches.find((g) => heads.has(g));
      const head = prior ? prior.dup_of || prior.id : priorFresh ? priorFresh.id : null;
      if (head) it.dupOf = head;
      else heads.add(it);
    }
    const dupUpd = fresh.filter((it) => it.dupOf).map((it) => env.DB.prepare('UPDATE items SET dup_of = ? WHERE id = ?').bind(it.dupOf, it.id));
    if (dupUpd.length) await env.DB.batch(dupUpd);
    if (cfg.articles.size) {
      const flashes = [...fresh];
      flashes.recent = fresh.recent;
      await safeRelate(env, cfg, { flashes, now }, report);
    }

    for (const it of fresh) {
      if (it.important) report.matched++;
      const wanted = cfg.notifyMode === 'all' || (cfg.notifyMode === 'matched' && it.important && !it.dupOf);
      if (!it.firstRun && wanted && now - it.ts <= cfg.maxAgeMs) toNotify.push(it);
    }

    // 旧快讯被新来源证实：加分；刚过阈值、这件事还没推送过的，补推
    const upd = [];
    for (const { row, add, by } of bumps) {
      if (row.base_score == null) continue;
      const confirms = (row.confirms || 0) + add.size;
      const score = Math.min(10, row.base_score + confirmBoost(confirms));
      const important = score >= cfg.threshold;
      upd.push(env.DB.prepare('UPDATE items SET confirms = ?, score = ?, important = ? WHERE id = ?').bind(confirms, score, important ? 1 : 0, row.id));
      const storyPushed = row.dup_of || by.some((f) => f.important || f.matches.some((m) => m.notified || m.important));
      if (important && !row.important && !row.notified && !storyPushed && now - row.ts <= cfg.maxAgeMs && cfg.notifyMode !== 'off') {
        toNotify.push({ id: row.id, title: row.title, source: row.source, url: row.url, ts: row.ts, score, scoreBy: row.score_by, confirms, hits: [`${confirms + 1} 个来源证实`] });
      }
    }
    if (upd.length) await env.DB.batch(upd);
  }

  if (arts.length) {
    try {
      await scoreArticles(env, cfg, arts, report);
    } catch (e) {
      report.errors.push(`深度文章打分出错: ${e?.message || e}`);
    }
    await safeRelate(env, cfg, { arts, now }, report);
  }

  if (notify && toNotify.length) {
    toNotify.sort((a, b) => a.ts - b.ts);
    const batch = toNotify.slice(-cfg.maxPerRun);
    // 网页推送：每个订阅的浏览器按自己的门槛和免打扰时段收
    let web = { ids: new Set(), errors: [], sent: 0 };
    try {
      web = await pushToSubscribers(env, batch, { now });
    } catch (e) {
      report.errors.push(`webpush: ${e?.message || e}`);
    }
    report.errors.push(...web.errors);
    report.webpush = web.sent;
    const channels = enabledChannels(env).length;
    for (const it of batch) {
      if (channels) {
        const results = await notifyAll(env, {
          title: it.title,
          source: it.source,
          reason: `${it.scoreBy === 'ai' ? 'AI' : '规则'} ${Math.round(it.score * 10) / 10} 分${it.hits.length ? ' · ' + it.hits.join(', ') : ''}`,
          url: it.url,
          ts: it.ts,
        });
        const failed = results.filter((r) => !r.ok);
        if (failed.length) report.errors.push(...failed.map((f) => `notify ${f.channel}: ${f.error}`));
      } else if (!web.ids.has(it.id)) continue;
      await db.prepare('UPDATE items SET notified = ? WHERE id = ?').bind(now, it.id).run();
      report.notified++;
    }
  }

  // 读取额度快用完时，后台可选的活（翻译、简报、统计）少做或不做
  const level = inputs ? 'ok' : (await budget(env, now)).level;
  report.budget = level;
  const scoredHigh = fresh.some((it) => it.score >= cfg.trMin);

  // 中英互译：本轮有够分的新快讯时翻一小批；没有的话每 10 分钟看一次有没有漏的（旧库还没加译文列时跳过，不影响抓取）
  if (cfg.trOn && !inputs && level !== 'critical' && (scoredHigh || minute % 10 === 0)) {
    try {
      report.translated = await translatePending(env, { now, minScore: cfg.trMin, max: cfg.trMax, provider: cfg.trProvider, fallback: cfg.trFallback, aiMin: cfg.trAiMin });
    } catch (e) {
      console.warn('translate skipped', e?.message || e);
    }
  }

  // 事件简报：重要事件有新报道时滚动重写（每天有花费上限，出错不影响抓取）
  // 为省数据库读取量，平时每 10 分钟看一次（省流时 30 分钟）；本轮有新的重要快讯时立刻看
  // 只有够得上“大事”（9 分以上，或 8 分以上且有多源证实）的新快讯才立刻看：普通的重要快讯本来就要攒 30 分钟才更新简报，
  // 以前每来一条 8 分快讯就把 36 小时的事件重读一遍（美股时段几乎每分钟一次）
  const briefEvery = level === 'save' ? 30 : 10;
  if (!inputs && level !== 'critical' && (fresh.some(isBig) || minute % briefEvery === 0)) {
    try {
      const b = await runBriefs(env, { now, articles: cfg.articles });
      if (b.written.length) report.briefs = b.written;
    } catch (e) {
      report.errors.push(`brief: ${e?.message || e}`);
    }
  }

  // 统计磁贴用的每小时条数：每 10 分钟更新一次（网页读的是存好的结果，不再每次扫 7 天）
  if (!inputs && level !== 'critical' && minute % 10 === 3) {
    try {
      await refreshHourStats(env, now);
    } catch (e) {
      report.errors.push(`stats: ${e?.message || e}`);
    }
  }

  // 每小时清理一次过期数据
  if (!inputs && new Date(now).getUTCMinutes() === 0) {
    await db.prepare('DELETE FROM items WHERE seen_at < ?').bind(now - cfg.keepDays * 86_400_000).run();
    await db.prepare('DELETE FROM vecs WHERE ts < ?').bind(now - 6 * 3_600_000).run();
    try {
      await db.prepare('DELETE FROM related WHERE ts < ?').bind(now - cfg.keepDays * 86_400_000).run();
    } catch {}
  }

  if (report.errors.length) console.warn('run errors', report.errors);
  return report;
}

// ---------- HTTP ----------

// 当前用哪种 logo（管理页设置，存在 meta 表）。内存里缓存 5 分钟；数据库慢或出错就用默认的黑色。
async function logoStyle(env) {
  const got = await Promise.race([
    cached('logo', 300_000, async () => ({ s: (await metaGet(env, 'logo'))?.v || DEFAULT_LOGO })).catch(() => null),
    new Promise((r) => setTimeout(() => r(null), 400)),
  ]);
  return LOGO_STYLES.includes(got?.s) ? got.s : DEFAULT_LOGO;
}

function logoAdminPage(current, saved) {
  const names = { dark: '黑色', light: '米白' };
  const card = (st) => `<button name="style" value="${st}" class="${st === current ? 'on' : ''}"><img src="data:image/svg+xml,${encodeURIComponent(faviconSvg(st).replace('viewBox', 'width="160" height="160" viewBox'))}" alt=""><b>${names[st]}</b><span>${st === current ? '正在使用' : '换成这个'}</span></button>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Logo 设置 · Headline Watch</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(faviconSvg(current))}">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#ebe5d8;color:#1a1714;font:15px/1.6 -apple-system,"PingFang SC","Noto Sans SC",sans-serif}
main{padding:32px 20px;text-align:center;max-width:560px}h1{font:800 30px/1.2 Georgia,"Songti SC",serif;margin:0 0 6px}p{color:#6f675b;margin:0 0 26px}
form{display:flex;gap:20px;justify-content:center;flex-wrap:wrap}
button{font:inherit;color:inherit;cursor:pointer;background:#f5f0e6;border:2px solid transparent;border-radius:22px;padding:26px 26px 18px;display:grid;gap:6px;justify-items:center;box-shadow:0 8px 30px rgba(40,30,10,.08);transition:.15s}
button:hover{transform:translateY(-2px)}button.on{border-color:#c8371d}button img{width:120px;height:120px;margin-bottom:8px}button b{font-size:16px}button span{font-size:13px;color:#8a8275}button.on span{color:#c8371d;font-weight:600}
.ok{display:inline-block;background:#e4efe4;color:#2f6f4a;border-radius:99px;padding:5px 14px;font-size:13px;margin-bottom:18px}small{display:block;margin-top:26px;color:#8a8275}a{color:inherit}</style></head><body><main>
<h1>Logo 设置</h1><p>选一个，全站的标签图标、主屏图标和推送通知图标都会跟着换。</p>
${saved ? '<div class="ok">已保存，几分钟内全部生效</div><br>' : ''}
<form method="post">${LOGO_STYLES.map(card).join('')}</form>
<small>这个页面只有带管理密码的网址才能打开。浏览器对图标有缓存，换完后强制刷新一次首页（Cmd+Shift+R）就能看到。<br><a href="/">返回首页</a></small>
</main></body></html>`;
}

function authorized(req, env) {
  if (!env.ACCESS_KEY) return true;
  const u = new URL(req.url);
  return u.searchParams.get('key') === env.ACCESS_KEY;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

async function listItems(env, opts) {
  const arts = config(env).articles;
  const rows = await listRows(env, opts);
  for (const r of rows) if (arts.has(r.source)) r.kind = 'article';
  return rows;
}

async function listRows(env, { limit = 200, matched = false, since = 0, before = 0, after = 0, keep = null, ids = null, cap = 500 }) {
  // since（轮询“最近抓到的”）走 seen_at 索引：ORDER BY 写成 +ts，免得数据库为了按 ts 排序而沿 ts 索引把整张表扫一遍
  // （2026-11-24 每 15 秒一次的轮询就是这样一次读 1 万多行）
  const ord = since > 0 && !before && !after && !ids ? '+ts' : 'ts';
  const sql = (level) => `SELECT id, source, title, body, url, ts, seen_at, hits, notified, score, important, score_by, base_score, confirms, dup_of${level > 0 ? ', title_tr, body_tr, tr_lang' : ''}${level > 1 ? ', dir, tickers, topic, sector' : ''}${level > 2 ? ', (SELECT COUNT(*) FROM related WHERE flash_id = items.id OR article_id = items.id) AS rel' : ''} FROM items
               WHERE seen_at > ? ${before > 0 ? 'AND ts < ?' : ''} ${after > 0 ? 'AND ts > ?' : ''} ${matched ? 'AND important = 1 AND dup_of IS NULL' : ''}
               ${keep ? `AND (score >= 6 OR source IN (${keep.map(() => '?').join(',') || "''"}))` : ''} ${ids ? `AND id IN (${ids.map(() => '?').join(',')})` : ''}
               ORDER BY ${ord} DESC LIMIT ?`;
  // before：只要比这个时间更早的（看板“加载更早的快讯”用）
  const args = [since, ...(before > 0 ? [before] : []), ...(after > 0 ? [after] : []), ...(keep || []), ...(ids || []), Math.min(limit, cap)];
  // 数据库还没跑 migrate-v6.sql（标签列）或 migrate-v5.sql（译文列）时，退回到不带这些列的查询
  for (const level of [3, 2, 1]) {
    try {
      return (await env.DB.prepare(sql(level)).bind(...args).all()).results.map(splitTopic);
    } catch {}
  }
  return (await env.DB.prepare(sql(0)).bind(...args).all()).results;
}

// llama-3.3-70b-instruct-fp8-fast 的官方折算：每百万输入 token 约 26668 neurons，每百万输出 token 约 204805 neurons
const neurons = (r) => Math.round((r.prompt_tokens * 26668 + r.completion_tokens * 204805) / 1e6);
async function usageRows(env) {
  try {
    const rows = (await env.DB.prepare('SELECT day, calls, prompt_tokens, completion_tokens FROM ai_usage ORDER BY day DESC LIMIT 7').all()).results;
    return rows.map((r) => ({ ...r, neurons_est: neurons(r) }));
  } catch {
    return [];
  }
}

// 最近 7 天里，每天“和现在同一时段的 12 小时”各有多少条快讯、多少条重要（看板的“比平常热不热”用）。
// 以前每次请求都把 7 天的快讯扫一遍（1 万多行）；现在 cron 每 10 分钟把“每小时条数”存进 meta 表，这里只读一行，
// 再加上存完之后新来的几条。
const HOUR = 3_600_000;
const imp1 = 'SUM(CASE WHEN important = 1 AND dup_of IS NULL THEN 1 ELSE 0 END)';
export async function refreshHourStats(env, now = Date.now()) {
  const old = await metaGet(env, 'stats_hours');
  const full = !old || !old.v?.h || now - (old.v.full || 0) > 24 * HOUR;
  const from = full ? now - 8 * 86_400_000 : Math.floor((now - 3 * HOUR) / HOUR) * HOUR;
  const rows = (await env.DB.prepare(`SELECT CAST(ts / ${HOUR} AS INTEGER) AS h, COUNT(*) AS n, ${imp1} AS imp FROM items WHERE ts >= ? AND ts <= ? GROUP BY h`).bind(from, now).all()).results;
  const h = full ? {} : { ...old.v.h };
  if (!full) for (const k of Object.keys(h)) if (Number(k) * HOUR >= from) delete h[k];
  for (const r of rows) h[r.h] = [r.n, r.imp || 0];
  for (const k of Object.keys(h)) if (Number(k) * HOUR < now - 8 * 86_400_000) delete h[k];
  const oldest = (await env.DB.prepare('SELECT MIN(seen_at) AS t FROM items').all()).results?.[0]?.t || now;
  const v = { h, built: now, full: full ? now : old.v.full, oldest };
  await metaSet(env, 'stats_hours', v, now);
  return v;
}

async function statsData(env) {
  const now = Date.now();
  let st = (await metaGet(env, 'stats_hours'))?.v;
  if (!st?.h || now - st.built > 2 * HOUR) st = await refreshHourStats(env, now);
  const hours = Object.entries(st.h).map(([k, v]) => [Number(k) * HOUR, v]);
  const windows = [];
  for (let k = 0; k < 7; k++) {
    const end = now - k * 86_400_000, start = end - 12 * HOUR;
    let n = 0, imp = 0;
    for (const [t, v] of hours) if (t >= Math.floor(start / HOUR) * HOUR && t < end) (n += v[0]), (imp += v[1]);
    windows.push({ k, n, imp });
  }
  // 存完之后新来的（最多十来分钟的量）
  const live = (await env.DB.prepare(`SELECT COUNT(*) AS n, ${imp1} AS imp FROM items WHERE ts > ? AND ts <= ?`).bind(st.built, now).all()).results?.[0];
  if (live) (windows[0].n += live.n || 0), (windows[0].imp += live.imp || 0);
  return { now, oldest: st.oldest || now, windows: windows.filter((w) => w.n > 0) };
}

// 写进网页的首屏数据用“轻量版”：重要快讯保留全文，其余只留标题和标签（正文、链接等网页打开后再补齐），网页能小四成
// 首屏数据：最新的 400 条，加上 18 小时内更早的“6 分以上”和深度文章。
// 这样头条、今日要闻、各标签的条数一打开就是最终结果，不用等后面再补一页数据才变（以前会先显示 9 分的头条再跳成 10 分的）。
async function bootData(env) {
  const now = Date.now();
  const [items, stats, briefs] = await Promise.all([
    listItems(env, { limit: 400 }),
    cached('stats', 120_000, () => statsData(env)).catch(() => null),
    cached('briefs', 60_000, async () => ({ briefs: await listBriefs(env) })).then((d) => d.briefs).catch(() => null),
  ]);
  let contig = 0;
  if (items.length >= 400) {
    contig = items[items.length - 1].ts;
    const extra = await listItems(env, { limit: 700, cap: 700, before: contig, after: now - 18 * 3_600_000, keep: [...config(env).articles] });
    const have = new Set(items.map((x) => x.id));
    for (const x of extra) if (!have.has(x.id)) items.push(x);
  }
  return { now, contig, items: items.map(liteItem), stats, briefs };
}

function liteItem(it) {
  if (it.important && !it.dup_of) return it;
  const { body, body_tr, url, hits, ...rest } = it;
  return { ...rest, lite: 1 };
}

// 首屏数据和轮询结果在多个标签页/设备之间共用缓存：数据每分钟才变一次，不必每个请求都查数据库
async function lvl(env) {
  return (await budget(env)).level;
}
const ttl = async (env, ms) => ms * LEVELS[await lvl(env)].ttl;

async function cron(env0) {
  const now = Date.now();
  if (dbBlocked(now)) {
    console.warn('D1 暂时不可用（额度用完或出错），本轮跳过');
    return;
  }
  const env = guard(env0, 'cron');
  try {
    await ensureSchema(env);
    return await runOnce(env, { now });
  } catch (e) {
    noteDbError(e, now);
    console.error('cron failed', e?.message || e);
  } finally {
    await flushReads(env, { force: true });
  }
}

const app = {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // Logo 图标：内嵌的静态文件，不查数据库、不需要访问密码，浏览器长期缓存
    if (req.method === 'GET' || req.method === 'HEAD') {
      const icon = iconName(url.pathname);
      if (icon) {
        // 网址里写明样式的（?s=dark）直接给，不查数据库；没写明的跟着当前设置（设置在内存里缓存 5 分钟）
        const s = url.searchParams.get('s');
        const pinned = LOGO_STYLES.includes(s);
        return iconResponse(icon, pinned ? s : await logoStyle(env), pinned);
      }
    }
    if (!authorized(req, env)) return new Response('需要 ?key=访问密码', { status: 401 });
    // 手动抓取和测试推送是管理操作：设置了 ADMIN_KEY 时需要 ?admin=管理密码，
    // 这样看板公开分享给别人也不会被人乱触发推送。
    if (url.pathname === '/api/run' || url.pathname === '/api/test-notify' || url.pathname === '/api/rescore' || url.pathname === '/api/xlang' || url.pathname === '/api/relink' || url.pathname === '/api/brief-run') {
      if (env.ADMIN_KEY && url.searchParams.get('admin') !== env.ADMIN_KEY) {
        return new Response('需要 ?admin=管理密码', { status: 403 });
      }
    }

    switch (url.pathname) {
      case '/admin/logo': {
        // 只有带管理密码才能打开的 logo 设置页：/admin/logo?admin=管理密码
        if (!env.ADMIN_KEY || url.searchParams.get('admin') !== env.ADMIN_KEY) return new Response('需要 ?admin=管理密码', { status: 403 });
        let saved = false;
        if (req.method === 'POST') {
          const pickStyle = String((await req.formData()).get('style') || '');
          if (!LOGO_STYLES.includes(pickStyle)) return new Response('unknown style', { status: 400 });
          await metaSet(env, 'logo', pickStyle);
          await cacheSet('logo', { s: pickStyle });
          saved = true;
        }
        return new Response(logoAdminPage(await logoStyle(env), saved), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
      }

      case '/': {
        // 首屏数据直接写进网页，省掉一次往返；数据库慢的时候不等它，网页照常先出来
        const boot = await Promise.race([
          (async () => cached('boot', await ttl(env, 20_000), () => bootData(env)))().catch(() => null),
          new Promise((r) => setTimeout(() => r(null), 900)),
        ]);
        return new Response(renderPage({ key: url.searchParams.get('key') || '', boot: boot && !boot.stale ? { ...boot, now: Date.now() } : null, logo: await logoStyle(env) }), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-HW-Build': BUILD },
        });
      }

      case '/api/items': {
        const now = Date.now();
        const limit = Math.min(Number(url.searchParams.get('limit') || 200), 500);
        const matched = url.searchParams.get('matched') === '1';
        const before = Number(url.searchParams.get('before') || 0);
        let since = Number(url.searchParams.get('since') || 0);
        // 轮询的 since 取整到 1 分钟（同一分钟里的各个标签页、设备共用一份缓存；cron 每分钟才写一次，多给的只是上一轮那几条）；
        // 太久以前的 since 等于要最新的一页。网页平时只要上次之后新增的，每 5 分钟才回看 30 分钟取一次分数、译文的更新。
        if (since > 0) since = since < now - 3 * HOUR ? 0 : Math.floor(since / 60_000) * 60_000;
        const b = await budget(env, now);
        const key = `items:${limit}:${matched ? 1 : 0}:${since}:${before}`;
        const d = await cached(key, before ? 60_000 * LEVELS[b.level].ttl : 15_000 * LEVELS[b.level].ttl, async () => ({
          items: await listItems(env, { limit, matched, since, before }),
          at: Date.now(),
        }));
        return json({ now, build: BUILD, items: d.items, stale: d.stale || undefined, budget: b.level, reads_pct: b.pct, poll: LEVELS[b.level].poll });
      }

      case '/api/briefs': {
        const d = await cached('briefs', await ttl(env, 60_000), async () => ({ briefs: await listBriefs(env) }));
        if (dbBlocked() && !d.briefs?.length) return json({ error: 'db_unavailable', briefs: [] }, 503); // 别让网页把已有的简报清空
        // 简报几十 KB，大多数时候没变：网页带上次的版本号 v 来问，没变就只回一句 same（每 3 分钟一次，省流量）
        const v = (d.briefs || []).map((b) => b.key + ':' + b.updated + ':' + (b.quiet ? 1 : 0)).join('|');
        const sig = String(v.length) + '-' + [...v].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
        if (url.searchParams.get('v') === sig) return json({ now: Date.now(), same: 1, v: sig });
        return json({ now: Date.now(), briefs: d.briefs, v: sig });
      }

      case '/api/brief-run': {
        // 管理用：立刻（重）写一件事的简报，如 /api/brief-run?admin=…&key=$NVDA；不带 key 就按平常的规则跑一轮
        const cfg = config(env);
        return json(await runBriefs(env, { articles: cfg.articles, force: url.searchParams.get('key') || null }));
      }

      case '/api/item': {
        // 单条全文：首屏里只带标题的条目，点开时补正文和链接
        const id = url.searchParams.get('id') || '';
        return json({ items: id ? await listItems(env, { ids: [id], limit: 1 }) : [] });
      }

      case '/api/stats':
        return json(await cached('stats', await ttl(env, 120_000), () => statsData(env)));

      case '/api/status': {
        const cfg = config(env);
        // 只显示当前配置里的源（已删掉的源不再列出）；外部推送进来的（如 Telegram）照常显示
        const keys = new Set(cfg.sources.map(sourceKey));
        const sources = (await cached('status:sources', await ttl(env, 30_000), async () => ({ rows: (await env.DB.prepare('SELECT key, runs, last_ok, last_count, last_error, last_error_at FROM source_state ORDER BY key').all()).results }))).rows
          .filter((r) => keys.has(r.key) || !r.key.startsWith('rss:'));
        return json({
          channels: enabledChannels(env),
          keywords: cfg.rules.keywords,
          bigNumbers: cfg.rules.bigNumbers,
          ai: { enabled: cfg.aiOn && (!!env.AI || claudeOn(env)), provider: claudeOn(env) ? 'claude' : 'workers', tags: cfg.aiTags, threshold: cfg.threshold, weights: cfg.weights, usage: await usageRows(env) },
          claude: { enabled: claudeOn(env), model: env.CLAUDE_MODEL || CLAUDE_MODEL, translate: cfg.trProvider === 'claude', ...claudeState(), ...(await claudeUsage(env)) },
          notifyMode: cfg.notifyMode,
          d1: await readsStatus(env),
          webpush: (await listSubscriptions(env)).map((x) => ({ min: x.min_score, mode: x.mode, quiet: x.quiet_from != null ? `${x.quiet_from}-${x.quiet_to} ${x.tz || ''}`.trim() : null, last_ok: x.last_ok, fails: x.fails, last_error: x.last_error })),
          sources,
        });
      }

      case '/api/ingest': {
        // GitHub 定时任务把抓到的 Telegram 频道网页 POST 过来：/api/ingest?channel=X&name=Y，请求头带管理密码
        if (req.method !== 'POST') return new Response('POST only', { status: 405 });
        const auth = req.headers.get('Authorization') || '';
        if (!env.ADMIN_KEY || auth !== `Bearer ${env.ADMIN_KEY}`) return new Response('forbidden', { status: 403 });
        const channel = (url.searchParams.get('channel') || '').replace(/[^\w]/g, '');
        if (!channel) return json({ error: 'missing channel' }, 400);
        const src = { type: 'telegram', channel, name: url.searchParams.get('name') || `TG @${channel}` };
        const html = await req.text();
        const items = parseTelegram(html.slice(0, 2_000_000), channel);
        items.forEach((i) => (i.source = src.name));
        const input = items.length ? { src, items } : { src, error: `页面里没有解析到消息（${html.length} 字节）` };
        return json(await runOnce(env, { inputs: [input] }));
      }

      case '/api/related': {
        // 详情面板用：快讯 → 同一件事的深度文章；文章 → 它解读的快讯
        const id = url.searchParams.get('id') || '';
        const cfg = config(env);
        const it = await env.DB.prepare('SELECT id, source, dup_of FROM items WHERE id = ?').bind(id).first();
        if (!it) return json({ items: [] });
        const cols = 'i.id, i.source, i.title, i.title_tr, i.tr_lang, i.url, i.ts';
        try {
          if (cfg.articles.has(it.source)) {
            const r = await env.DB.prepare(`SELECT ${cols} FROM related r JOIN items i ON i.id = r.flash_id WHERE r.article_id = ? ORDER BY i.ts DESC LIMIT 8`).bind(id).all();
            return json({ kind: 'flashes', items: r.results });
          }
          const head = it.dup_of || it.id;
          const r = await env.DB.prepare(
            `SELECT DISTINCT ${cols} FROM related r JOIN items i ON i.id = r.article_id
             WHERE r.flash_id = ?1 OR r.flash_id IN (SELECT id FROM items WHERE dup_of = ?1) ORDER BY i.ts DESC LIMIT 6`
          ).bind(head).all();
          return json({ kind: 'articles', items: r.results });
        } catch {
          return json({ items: [] }); // 还没跑 migrate-v7.sql
        }
      }

      case '/api/relink': {
        // 补挂：把最近 N 小时的深度文章重新和快讯比对一遍（改了匹配规则后用）
        const cfg = config(env);
        const hours = Math.min(Number(url.searchParams.get('hours') || 12), 48);
        const now = Date.now();
        const arts = (await env.DB.prepare('SELECT id, source, title, body, ts, score_by FROM items WHERE ts > ?').bind(now - hours * 3_600_000).all()).results.filter((r) => cfg.articles.has(r.source));
        // 开了 ARTICLE_AI_SCORING 时，顺便把还没 AI 打过分的文章补打
        const report = { errors: [] };
        const unscored = arts.filter((a) => a.score_by !== 'ai').map((a) => enrich({ ...a }, cfg));
        if (url.searchParams.get('score') !== '0' && cfg.artAi && unscored.length) await scoreArticles(env, cfg, unscored, report);
        const dbg = url.searchParams.has('debug') ? [] : null;
        const n = await relate(dbg ? { ...env, RELATE_DEBUG: dbg } : env, { ...cfg, relHours: hours + cfg.relHours }, { arts, now });
        return json({ debug: dbg || undefined, articles: arts.length, scored: cfg.artAi ? unscored.length : 0, links: n, errors: report.errors });
      }

      case '/api/xlang': {
        // 校准用：最近 N 小时里，中文和英文快讯两两比对，列出最相似的几对
        const hours = Math.min(Number(url.searchParams.get('hours') || 1), 6);
        const rows = (await env.DB.prepare('SELECT id, source, title FROM items WHERE seen_at > ? ORDER BY ts DESC LIMIT 400').bind(Date.now() - hours * 3_600_000).all()).results;
        const vecs = await embed(env, rows.map((r) => r.title));
        if (!vecs) return json({ error: 'embed failed' });
        const q = vecs.map(pack);
        const pairs = [];
        for (let i = 0; i < rows.length; i++) {
          if (!isZh(rows[i].title)) continue;
          let best = -1, bj = -1;
          for (let j = 0; j < rows.length; j++) {
            if (isZh(rows[j].title)) continue;
            const c = cos(q[i], q[j]);
            if (c > best) { best = c; bj = j; }
          }
          if (bj >= 0) pairs.push({ s: Math.round(best * 1000) / 1000, zh: rows[i].title.slice(0, 80), en: `${rows[bj].source} | ${rows[bj].title.slice(0, 100)}` });
        }
        pairs.sort((a, b) => b.s - a.s);
        return json({ n: rows.length, dims: vecs[0]?.length, pairs: pairs.slice(0, 60) });
      }

      case '/api/rescore': {
        // 按当前规则/AI 重新给最近 N 小时的快讯打分（改了阈值或权重后用）
        const cfg = config(env);
        if (url.searchParams.has('tags')) cfg.aiTags = url.searchParams.get('tags') !== '0'; // 对比带标签和不带标签的开销
        const hours = Math.min(Number(url.searchParams.get('hours') || 6), 72);
        const rows = (
          await env.DB.prepare(
            // todo=1：只补还没有 AI 分数的（额度用完那段时间留下的）；skip=N：跳过最新的 N 条，分几次跑完
            `SELECT id, source, title, body, ts, confirms FROM items WHERE ts > ? ${url.searchParams.get('todo') === '1' ? "AND (score_by IS NULL OR score_by = 'rule')" : ''} ORDER BY ts DESC LIMIT 200 OFFSET ?`
          )
            .bind(Date.now() - hours * 3_600_000, Math.max(0, Number(url.searchParams.get('skip')) || 0))
            .all()
        ).results.map((r) => enrich(r, cfg));
        const report = { errors: [] };
        const out = [];
        for (let i = 0; i < rows.length; i += cfg.maxAi) {
          const chunk = rows.slice(i, i + cfg.maxAi);
          await scoreItems(env, cfg, chunk, report);
          out.push(...chunk);
        }
        return json({
          rescored: out.length,
          important: out.filter((r) => r.important).length,
          errors: report.errors,
          renumbered: report.renumbered || 0,
          dropped: report.dropped || 0,
          by: out.reduce((c, r) => ((c[r.scoreBy] = (c[r.scoreBy] || 0) + 1), c), {}),
          usage:
            report.aiUsage &&
            (report.aiUsage.provider === 'claude'
              ? { ...report.aiUsage, usd: claudeUsd(report.aiUsage.prompt, report.aiUsage.completion) }
              : { ...report.aiUsage, neurons_est: neurons({ prompt_tokens: report.aiUsage.prompt, completion_tokens: report.aiUsage.completion }) }),
          tagged: out.filter((r) => r.tags).length,
          sample: out.filter((r) => r.tags).slice(0, 12).map((r) => ({ title: r.title.slice(0, 80), ...r.tags })),
          top: out.sort((a, b) => b.score - a.score).slice(0, 15).map((r) => ({ score: r.score, by: r.scoreBy, title: r.title })),
        });
      }

      case '/api/backfill': {
        // 补抓数据库停摆期间漏掉的快讯（见 src/backfill.js）。只入库、打分、去重，从不推送。
        const key = url.searchParams.get('admin');
        if (!(env.ADMIN_KEY && key === env.ADMIN_KEY) && !(env.BACKFILL_KEY && key === env.BACKFILL_KEY)) return new Response('需要 ?admin=管理密码', { status: 403 });
        const cfg = config(env);
        const op = url.searchParams.get('op');
        if (op === 'sources') return json(cfg.sources.map((s) => ({ name: s.name, pageable: pageable(s), kind: s.kind || null })));
        if (op === 'ingest') {
          const body = await req.json();
          const now = Number(body.now) || Date.now();
          const by = new Map();
          for (const it of body.items || []) {
            const src = cfg.sources.find((s) => s.name === it.source);
            if (!src || !it.id || !it.title || !(it.ts <= now)) continue;
            if (!by.has(src)) by.set(src, []);
            by.get(src).push({ id: String(it.id), source: src.name, title: String(it.title), body: String(it.body || ''), url: String(it.url || ''), ts: Number(it.ts) });
          }
          const inputs = [...by].map(([src, items]) => ({ src, items }));
          if (!inputs.length) return json({ inserted: 0 });
          return json(await runOnce(env, { now, notify: false, inputs, backfill: true }));
        }
        const src = cfg.sources.find((s) => s.name === url.searchParams.get('src'));
        if (!src) return json({ error: 'unknown src' }, 400);
        if (op === 'raw') return json(await rawPage(src, url.searchParams.get('q')));
        if (!pageable(src)) return json({ error: 'not pageable' }, 400);
        return json(await fetchPage(src, url.searchParams.get('cursor'), { focusFilter, limit: Number(url.searchParams.get('limit') || 100) }));
      }

      case '/api/run': // 手动触发一次抓取（测试用）
        return json(await runOnce(env, { notify: url.searchParams.get('notify') !== '0' }));

      case '/sw.js':
        return new Response(SW_JS, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' } });

      case '/manifest.webmanifest': {
        const ms = url.searchParams.get('s');
        const mlogo = LOGO_STYLES.includes(ms) ? ms : await logoStyle(env);
        return new Response(
          JSON.stringify({ name: 'Headline Watch', short_name: 'Headline', start_url: '/' + (url.searchParams.get('key') ? '?key=' + encodeURIComponent(url.searchParams.get('key')) : ''), display: 'standalone', background_color: '#f5f0e6', theme_color: '#f5f0e6', icons: [{ src: '/icons/icon-192.png?s=' + mlogo + '&v=' + ICON_VERSION, sizes: '192x192', type: 'image/png' }, { src: '/icons/icon-512.png?s=' + mlogo + '&v=' + ICON_VERSION, sizes: '512x512', type: 'image/png' }, { src: '/icons/maskable-512.png?s=' + mlogo + '&v=' + ICON_VERSION, sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }),
          { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' } }
        );
      }

      case '/api/push/key': {
        // 公钥 + 过去 24 小时各门槛的条数；带 endpoint 时顺便返回这个浏览器在服务器上的设置
        const keys = await vapidKeys(env);
        const ep = url.searchParams.get('endpoint');
        const sub = ep ? await getSubscription(env, ep) : null;
        return json({
          publicKey: keys.publicKey,
          counts: (await cached('push:counts', 600_000, async () => ({ c: await dailyCounts(env) })).catch(() => ({ c: null }))).c,
          sub: sub ? { min: sub.min_score, mode: sub.mode, quietFrom: sub.quiet_from, quietTo: sub.quiet_to, tz: sub.tz, sticky: !!sub.sticky, lastOk: sub.last_ok, fails: sub.fails, lastError: sub.last_error } : null,
        });
      }

      case '/api/push/subscribe': {
        if (req.method !== 'POST') return json({ ok: false }, 405);
        const body = await req.json().catch(() => null);
        const page = String(body?.page || '').split('#')[0];
        const origin = page.startsWith(url.origin + '/') ? page : url.origin + '/';
        const r = await saveSubscription(env, body, { origin, ua: req.headers.get('User-Agent') });
        return json(r, r.ok ? 200 : 400);
      }

      case '/api/push/unsubscribe': {
        if (req.method !== 'POST') return json({ ok: false }, 405);
        const body = await req.json().catch(() => null);
        return json(await removeSubscription(env, body?.endpoint));
      }

      case '/api/push/test': {
        // 只能给已经订阅的浏览器发测试，避免被人拿来乱发
        if (req.method !== 'POST') return json({ ok: false }, 405);
        const body = await req.json().catch(() => null);
        const sub = await getSubscription(env, body?.endpoint);
        if (!sub) return json({ ok: false, error: 'not subscribed' }, 404);
        try {
          const r = await sendPush(env, sub, {
            title: body?.title ? String(body.title).slice(0, 120) : 'Headline Watch 测试推送',
            body: body?.body ? String(body.body).slice(0, 200) : '能看到这条，说明推送已经通了',
            id: `test-${Date.now()}`, // 每次都不同，避免被当成同一条通知悄悄替换
            sticky: !!sub.sticky,
            url: String(sub.origin || url.origin + '/').split('#')[0],
            ts: Date.now(),
          }, { ttl: 300 });
          if (r.gone) await removeSubscription(env, sub.endpoint);
          return json(r, r.ok ? 200 : 502);
        } catch (e) {
          return json({ ok: false, error: String(e?.message || e) }, 502);
        }
      }

      case '/api/test-notify': {
        const channels = enabledChannels(env);
        if (!channels.length) return json({ ok: false, message: '还没有配置任何推送渠道' }, 400);
        const results = await notifyAll(env, {
          title: 'Headline Watch 测试推送：NVIDIA SHORT SELLERS REAP $24 BILLION',
          source: 'test',
          reason: '$24 billion',
          url: 'https://t.me/WalterBloomberg',
          ts: Date.now(),
        });
        return json({ results });
      }

      case '/rss.xml': {
        const items = await listItems(env, { limit: 100, matched: url.searchParams.get('all') !== '1' });
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Headline Watch</title><link>${escapeXml(url.origin)}</link><description>合并快讯</description>
${items
  .map(
    (i) =>
      `<item><title>${escapeXml(i.title)}</title><link>${escapeXml(i.url)}</link><guid isPermaLink="false">${escapeXml(i.id)}</guid><pubDate>${new Date(i.ts).toUTCString()}</pubDate><category>${escapeXml(i.source)}</category><description>${escapeXml((i.score != null ? '评分：' + i.score + '\n' : '') + (i.hits ? '命中：' + i.hits + '\n' : '') + (i.body || ''))}</description></item>`
  )
  .join('\n')}
</channel></rss>`;
        return new Response(body, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'no-store' } });
      }

      default:
        return new Response('Not found', { status: 404 });
    }
  },
};

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(cron(env));
  },

  async fetch(req, env0, ctx) {
    const env = guard(env0, 'web');
    try {
      return await app.fetch(req, env, ctx);
    } catch (e) {
      noteDbError(e);
      // 数据库不可用（比如当天读取额度用完）：接口返回 503，网页会继续显示浏览器里存的上一份数据
      return json({ error: 'db_unavailable', message: String(e?.message || e).slice(0, 200), items: [], poll: LEVELS.blocked.poll }, 503);
    } finally {
      ctx?.waitUntil?.(flushReads(env).catch(() => {}));
    }
  },
};
