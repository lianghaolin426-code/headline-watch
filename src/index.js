// Headline Watch：每分钟抓一次各个快讯源，去重、按关键词/大数字过滤，
// 存进 D1 数据库，并推送到已配置的渠道（可以一个都不配，只看网页）。

import { parseTelegram, parseFeed } from './parse.js';
import { matchItem, parseKeywords, maxAmountBillions } from './filter.js';
import { aiScores, routinePenalty } from './score.js';
import { parseCnJson } from './cnfeeds.js';
import { embed, pack, unpack, cos, isZh } from './embed.js';
import { tokens, sameStory, confirmBoost, idfWeights } from './similar.js';
import { notifyAll, enabledChannels } from './notify.js';
import { renderPage } from './page.js';
import { translatePending } from './translate.js';

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
    maxAi: Number(env.MAX_AI_PER_RUN || 15),
    weights: safeJson(env.SOURCE_WEIGHTS, {}),
    xlangOn: env.CROSS_LANGUAGE !== 'false',
    xlangMin: Number(env.CROSS_LANGUAGE_MIN || 0.65),
    trOn: env.TRANSLATE !== 'false',
    trMin: Number(env.TRANSLATE_MIN_SCORE || 6),
    trMax: Number(env.MAX_TRANSLATE_PER_RUN || 8),
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

/** 给一批快讯打分并写回数据库：规则粗筛出候选 → AI 打分 → 来源加权、例行新闻减分；AI 失败时用规则 */
async function scoreItems(env, cfg, list, report) {
  // AI 很便宜（每条标题只要几十个 token），所以新快讯全部交给 AI 打分；
  // 超出单轮上限时，优先给规则命中的和高权重来源的
  const candidates = [...list]
    .sort((a, b) => (b.hits.length > 0) + (b.weight >= 1) - ((a.hits.length > 0) + (a.weight >= 1)) || b.ts - a.ts)
    .slice(0, cfg.maxAi);
  const scores = cfg.aiOn ? await aiScores(env, candidates) : null;
  if (cfg.aiOn && candidates.length && !scores) report.errors.push('AI 打分失败，本轮用规则判断');
  candidates.forEach((it, k) => {
    if (scores && scores[k] != null) {
      it.score = Math.max(0, Math.min(10, scores[k] + it.weight + routinePenalty(it.title)));
      it.scoreBy = 'ai';
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
    it.important = it.score >= cfg.threshold;
    updates.push(
      env.DB.prepare('UPDATE items SET score = ?, base_score = ?, confirms = ?, important = ?, score_by = ?, hits = ? WHERE id = ?').bind(
        it.score || null, it.base, it.confirms || 0, it.important ? 1 : 0, it.score ? it.scoreBy : null, it.hits.join(' | '), it.id)
    );
  }
  if (updates.length) await env.DB.batch(updates);
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
  ).results.filter((r) => !freshIds.has(r.id));
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
  return [...bumped.values()];
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
  const rows = (await env.DB.prepare('SELECT id, zh, v FROM vecs WHERE ts > ?').bind(now - 2 * 3_600_000).all()).results.filter(
    (r) => !freshIds.has(r.id)
  );
  const zhRows = rows.filter((r) => r.zh).map((r) => ({ id: r.id, v: unpack(r.v) }));
  const enRows = rows.filter((r) => !r.zh).map((r) => ({ id: r.id, v: unpack(r.v) }));
  for (const f of fresh) {
    f.xl = new Set();
    f.xlFresh = new Set();
    for (const r of f.zh ? enRows : zhRows) if (cos(f.vec, r.v) >= cfg.xlangMin) f.xl.add(r.id);
    for (const g of fresh) if (g.zh !== f.zh && cos(f.vec, g.vec) >= cfg.xlangMin) f.xlFresh.add(g);
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
  '英伟达|苹果|微软|谷歌|亚马逊|Meta|特斯拉|马斯克|OpenAI|Anthropic|博通|台积电|伯克希尔|巴菲特|摩根|高盛|贝莱德|' +
  '沙特|阿美|利雅得|中东|海湾|OPEC|欧佩克|原油|油价|布伦特|WTI|伊朗|以色列|霍尔木兹|' +
  '黄金|比特币|关税|制裁|收购|并购|破产|暴跌|暴涨|熔断|[A-Z]{2,5}\\.(?:O|N)\\b|美股盘前|美股盘后|美股收盘|美股开盘';

// 只关注美股、沙特股：中文快讯里 A 股、港股、国内政策等本地新闻直接丢掉，只留和美国/沙特/全球宏观相关的
function focusFilter(src, items) {
  if (!src.focus) return items;
  const re = new RegExp(src.focus === true ? FOCUS_ZH : src.focus, 'i');
  return items.filter((i) => re.test(i.title));
}

function sourceKey(src) {
  return src.type === 'telegram' ? `tg:${src.channel}` : `rss:${src.name || src.url}`;
}

// inputs：外部推进来的数据（GitHub 定时任务抓的 Telegram 页面），格式 [{src, items}]；不传则自己抓 SOURCES
export async function runOnce(env, { now = Date.now(), notify = true, inputs = null } = {}) {
  const cfg = config(env);
  const db = env.DB;
  const report = { fetched: 0, inserted: 0, matched: 0, notified: 0, errors: [] };

  const states = new Map(
    (await db.prepare('SELECT key, runs FROM source_state').all()).results.map((r) => [r.key, r.runs])
  );

  // 有的源限制频率（every: 每隔几分钟抓一次），没到时间的这轮跳过
  const minute = Math.floor(now / 60_000);
  const sources = inputs ? inputs.map((x) => x.src) : cfg.sources.filter((src) => !src.every || minute % src.every === 0);
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
      await db
        .prepare(
          `INSERT INTO source_state (key, runs, last_ok, last_error, last_error_at) VALUES (?, 0, NULL, ?, ?)
           ON CONFLICT(key) DO UPDATE SET last_error = excluded.last_error, last_error_at = excluded.last_error_at`
        )
        .bind(key, msg, now)
        .run();
      continue;
    }
    const items = res.value;
    report.fetched += items.length;
    // 第一次抓某个源时，只入库不推送，避免一上来推几十条旧闻
    const firstRun = !states.get(key);

    if (items.length) {
      const stmts = items.map((it) => {
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
        fresh.push(items[j]);
      });
    }
    await db
      .prepare(
        `INSERT INTO source_state (key, runs, last_ok, last_count) VALUES (?, 1, ?, ?)
         ON CONFLICT(key) DO UPDATE SET runs = runs + 1, last_ok = excluded.last_ok, last_count = excluded.last_count, last_error = NULL`
      )
      .bind(key, now, items.length)
      .run();
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
        toNotify.push({ id: row.id, title: row.title, source: row.source, url: row.url, ts: row.ts, score, scoreBy: row.score_by, hits: [`${confirms + 1} 个来源证实`] });
      }
    }
    if (upd.length) await env.DB.batch(upd);
  }

  if (notify && toNotify.length && enabledChannels(env).length) {
    toNotify.sort((a, b) => a.ts - b.ts);
    for (const it of toNotify.slice(-cfg.maxPerRun)) {
      const results = await notifyAll(env, {
        title: it.title,
        source: it.source,
        reason: `${it.scoreBy === 'ai' ? 'AI' : '规则'} ${Math.round(it.score * 10) / 10} 分${it.hits.length ? ' · ' + it.hits.join(', ') : ''}`,
        url: it.url,
        ts: it.ts,
      });
      const failed = results.filter((r) => !r.ok);
      if (failed.length) report.errors.push(...failed.map((f) => `notify ${f.channel}: ${f.error}`));
      await db.prepare('UPDATE items SET notified = ? WHERE id = ?').bind(now, it.id).run();
      report.notified++;
    }
  }

  // 中英互译：每轮翻一小批分数够高的快讯（旧库还没加译文列时跳过，不影响抓取）
  if (cfg.trOn && !inputs) {
    try {
      report.translated = await translatePending(env, { now, minScore: cfg.trMin, max: cfg.trMax });
    } catch (e) {
      console.warn('translate skipped', e?.message || e);
    }
  }

  // 每小时清理一次过期数据
  if (!inputs && new Date(now).getUTCMinutes() === 0) {
    await db.prepare('DELETE FROM items WHERE seen_at < ?').bind(now - cfg.keepDays * 86_400_000).run();
    await db.prepare('DELETE FROM vecs WHERE ts < ?').bind(now - 6 * 3_600_000).run();
  }

  if (report.errors.length) console.warn('run errors', report.errors);
  return report;
}

// ---------- HTTP ----------

function authorized(req, env) {
  if (!env.ACCESS_KEY) return true;
  const u = new URL(req.url);
  return u.searchParams.get('key') === env.ACCESS_KEY;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

async function listItems(env, { limit = 200, matched = false, since = 0 }) {
  const sql = (tr) => `SELECT id, source, title, body, url, ts, seen_at, hits, notified, score, important, score_by, base_score, confirms, dup_of${tr ? ', title_tr, body_tr, tr_lang' : ''} FROM items
               WHERE seen_at > ? ${matched ? 'AND important = 1 AND dup_of IS NULL' : ''}
               ORDER BY ts DESC LIMIT ?`;
  const run = (tr) => env.DB.prepare(sql(tr)).bind(since, Math.min(limit, 500)).all();
  try {
    return (await run(true)).results;
  } catch {
    // 数据库还没跑 migrate-v5.sql（没有译文列）时照常返回原文
    return (await run(false)).results;
  }
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runOnce(env));
  },

  async fetch(req, env) {
    const url = new URL(req.url);
    if (!authorized(req, env)) return new Response('需要 ?key=访问密码', { status: 401 });
    // 手动抓取和测试推送是管理操作：设置了 ADMIN_KEY 时需要 ?admin=管理密码，
    // 这样看板公开分享给别人也不会被人乱触发推送。
    if (url.pathname === '/api/run' || url.pathname === '/api/test-notify' || url.pathname === '/api/rescore' || url.pathname === '/api/xlang') {
      if (env.ADMIN_KEY && url.searchParams.get('admin') !== env.ADMIN_KEY) {
        return new Response('需要 ?admin=管理密码', { status: 403 });
      }
    }

    switch (url.pathname) {
      case '/':
        return new Response(renderPage({ key: url.searchParams.get('key') || '' }), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        });

      case '/api/items': {
        const items = await listItems(env, {
          limit: Number(url.searchParams.get('limit') || 200),
          matched: url.searchParams.get('matched') === '1',
          since: Number(url.searchParams.get('since') || 0),
        });
        return json({ now: Date.now(), items });
      }

      case '/api/status': {
        const cfg = config(env);
        // 只显示当前配置里的源（已删掉的源不再列出）；外部推送进来的（如 Telegram）照常显示
        const keys = new Set(cfg.sources.map(sourceKey));
        const sources = (await env.DB.prepare('SELECT * FROM source_state ORDER BY key').all()).results
          .filter((r) => keys.has(r.key) || !r.key.startsWith('rss:'));
        return json({
          channels: enabledChannels(env),
          keywords: cfg.rules.keywords,
          bigNumbers: cfg.rules.bigNumbers,
          ai: { enabled: cfg.aiOn && !!env.AI, threshold: cfg.threshold, weights: cfg.weights },
          notifyMode: cfg.notifyMode,
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
        const hours = Math.min(Number(url.searchParams.get('hours') || 6), 72);
        const rows = (
          await env.DB.prepare('SELECT id, source, title, body, ts, confirms FROM items WHERE ts > ? ORDER BY ts DESC LIMIT 200')
            .bind(Date.now() - hours * 3_600_000)
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
          top: out.sort((a, b) => b.score - a.score).slice(0, 15).map((r) => ({ score: r.score, by: r.scoreBy, title: r.title })),
        });
      }

      case '/api/run': // 手动触发一次抓取（测试用）
        return json(await runOnce(env, { notify: url.searchParams.get('notify') !== '0' }));

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
