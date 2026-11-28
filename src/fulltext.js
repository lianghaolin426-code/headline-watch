// 文章全文（试验）：按需、一篇一篇地读公开网页上的正文，给写档案和写稿当材料用。
// 守规矩：如实报上自己的身份，先看 robots.txt，被拒或要付费就停，不伪装浏览器、不带 cookie、不走代理。

import { countedAs } from './origin.js';

const UA = 'headline-watch/1.0 (private news dashboard)';
const robotsMem = new Map(); // origin -> { at, rules }

/** 解析 robots.txt 里对所有爬虫（User-agent: *）和对我们自己的 Disallow / Allow */
export function parseRobots(text, agent = 'headline-watch') {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === 'user-agent') {
      if (!lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (k === 'disallow' || k === 'allow') && v) cur.rules.push({ allow: k === 'allow', path: v });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  return (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
}

/** 这个路径允不允许读：最长匹配的那条规则说了算，没有规则就是允许 */
export function robotsAllows(rules, path) {
  let best = null;
  for (const r of rules) {
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(path) && (!best || r.path.length > best.path.length)) best = r;
  }
  return !best || best.allow;
}

async function robotsFor(origin, fetcher, now) {
  const hit = robotsMem.get(origin);
  if (hit && now - hit.at < 6 * 3_600_000) return hit.rules;
  let rules = [];
  try {
    const r = await fetcher(origin + '/robots.txt', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (r.ok) rules = parseRobots(await r.text());
  } catch {}
  robotsMem.set(origin, { at: now, rules });
  return rules;
}

const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", copy: '©', reg: '®', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…', middot: '·' };
/** 去标签、解开 &amp; &#x27; 这类写法、收拾空白 */
export function plain(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16) || 32))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n) || 32))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
    .replace(/[ \t　]+/g, ' ')
    .replace(/ ?\n\s*\n*/g, '\n')
    .trim();
}

const paras = (html) => [...String(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => plain(m[1])).filter(Boolean);
// 一段像不像正文：够长，或者是一句完整的话；“Sign In”“首页 > 快讯”这类页面零件不算
// 页面零件：登录、版权、cookie 提示、政府网站页头
const JUNK = /^(forgot password|sign in|log ?in|search result|an official website of|official websites use|a \.gov website|secure \.gov websites|you consent to our cookies|we use cookies|©|&copy;|copyright|all rights reserved|share this|read more|follow us|subscribe)/i;
const prose = (t) => !JUNK.test(t) && !/cookies if you use this website\.?$/i.test(t) && (t.length >= 40 || (t.length >= 6 && /[。.!?！？”"]$/.test(t)));

/**
 * 从文章网页里取正文。依次试：
 * 1 网页自带的结构化数据（JSON-LD 的 articleBody），最干净；
 * 2 文字最多的那个 <article>（有的网页第一个 <article> 只是推荐卡片）里的段落；
 * 3 整页里像正文的段落（去掉导航、页头页脚之后）。
 * 取到的段落里，开头结尾那些不像正文的短句（登录、面包屑、版权）去掉。
 */
export function htmlText(html) {
  const src = String(html || '');
  for (const m of src.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const b = m[1].match(/"articleBody"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (!b) continue;
    try {
      const t = plain(JSON.parse('"' + b[1] + '"'));
      if (t.length >= 300) return t;
    } catch {}
  }
  const s = src.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
  const trim = (ps) => {
    let a = 0;
    let b = ps.length;
    while (a < b && !prose(ps[a])) a++;
    while (b > a && !prose(ps[b - 1])) b--;
    return ps.slice(a, b);
  };
  let best = [];
  const size = (ps) => ps.reduce((n, t) => n + t.length, 0);
  for (const m of s.matchAll(/<article\b[\s\S]*?<\/article>/gi)) {
    const ps = trim(paras(m[0])).filter((t) => !JUNK.test(t));
    if (size(ps) > size(best)) best = ps;
  }
  if (size(best) < 300) {
    const ps = trim(paras(s).filter(prose));
    if (size(ps) > size(best)) best = ps;
  }
  if (best.length >= 2 || size(best) >= 300) return best.join('\n');
  // 没有分段的网页（少见）：退回去掉标签后的全部文字
  const art = s.match(/<article\b[\s\S]*?<\/article>/i);
  return plain(art ? art[0] : s);
}

/** 网页是不是“请先通过浏览器验证”的拦截页（返回 200 但没有正文）。这种算被拒绝，不去跑它的脚本 */
export function isChallenge(html) {
  const h = String(html || '');
  return h.length < 60_000 && /wafToken|请启用\s*JavaScript|enable JavaScript and cookies|cf-challenge|challenge-platform|captcha-delivery|Just a moment\.\.\./i.test(h) && plain(h.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')).length < 400;
}

/**
 * 读一篇文章的正文。返回 { ok, text, len, via } 或 { ok: false, error, status }。
 * 华尔街见闻：先用它公开的文章接口（和列表是同一套），标了付费的不读；其余来源读文章网页。
 */
export async function fetchFullText(item, { fetcher = fetch, now = Date.now() } = {}) {
  const url = String(item?.url || '');
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, error: 'no_url' };
  }
  if (!(await robotsAllows(await robotsFor(u.origin, fetcher, now), u.pathname))) return { ok: false, error: 'robots' };
  const wscn = String(item.id || '').match(/^wscnArticle:(\d+)$/);
  try {
    if (wscn) {
      const r = await fetcher(`https://api-one-wscn.awtmt.com/apiv1/content/articles/${wscn[1]}?extract=0`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) return { ok: false, error: 'http', status: r.status };
      const d = (await r.json())?.data || {};
      const paid = !!(d.is_need_pay || d.need_pay || d.is_priced || d.vip_type);
      const text = htmlText('<article>' + (d.content || '') + '</article>');
      // 付费文章接口只给开头一段：不算全文，也不想办法拿剩下的
      if (paid && text.length < 1200) return { ok: false, error: 'paywall', len: text.length, keys: Object.keys(d).slice(0, 40) };
      return text.length >= 300 ? { ok: true, via: 'wscn-api', len: text.length, text } : { ok: false, error: 'short', len: text.length, keys: Object.keys(d).slice(0, 40) };
    }
    const r = await fetcher(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
    if ([401, 403, 429].includes(r.status)) return { ok: false, error: 'refused', status: r.status };
    if (!r.ok) return { ok: false, error: 'http', status: r.status };
    const html = await r.text();
    if (isChallenge(html)) return { ok: false, error: 'refused', status: r.status, why: 'challenge' };
    const text = htmlText(html);
    return text.length >= 300 ? { ok: true, via: 'page', len: text.length, text } : { ok: false, error: 'short', len: text.length, htmlLen: html.length, title: (html.match(/<title[^>]*>([^<]*)/i) || [])[1], shape: { article: (html.match(/<article\b/gi) || []).length, p: (html.match(/<p\b/gi) || []).length, ld: /articleBody/.test(html), next: /__NEXT_DATA__|__NUXT__|window\.__INITIAL/.test(html) } };
  } catch (e) {
    return { ok: false, error: 'fetch', detail: String(e?.message || e).slice(0, 120) };
  }
}

/* ---------- 按需读全文：只在用户点“生成档案 / 写英文稿”时，对这件事下面的几篇文章各读一次，存起来下次不重读 ---------- */

export const FT_TABLE = 'CREATE TABLE IF NOT EXISTS fulltext (id TEXT PRIMARY KEY, source TEXT, ts INTEGER NOT NULL, ok INTEGER NOT NULL, len INTEGER, via TEXT, err TEXT, text TEXT)';
// 实测（2026-11-26）能合规读到正文的来源。富途（浏览器验证）、WSJ（robots 不允许）、Nasdaq（403）、各家快讯和 Bluesky 帖子不在里面
const FT_DEFAULT = '华尔街见闻文章,格隆汇文章,CNBC,BBC Business,PR Newswire,Federal Reserve,Investing.com,investingLive,Argaam,Arab News';

export function fullTextConfig(env) {
  return {
    on: env.FULLTEXT !== 'false',
    sources: new Set(String(env.FULLTEXT_SOURCES || FT_DEFAULT).split(',').map((s) => s.trim()).filter(Boolean)),
    max: Number(env.FULLTEXT_MAX || 6), // 一次最多新读几篇
    chars: Number(env.FULLTEXT_CHARS || 3000), // 每篇最多留多少字
    retryH: Number(env.FULLTEXT_RETRY_HOURS || 6), // 读失败的隔多久才再试
    testAt: Number(env.FULLTEXT_TEST_MINUTE ?? 200), // 每天自检从 UTC 第几分钟开始（每分钟试一个来源）；-1 关掉
  };
}

let ftOk = false;
async function ftTable(env) {
  if (ftOk) return;
  await env.DB.prepare(FT_TABLE).run();
  ftOk = true;
}

/** 读一篇并存进 fulltext 表（成功失败都记）。返回 fetchFullText 的结果 */
export async function readAndStore(env, item, { fetcher = fetch, now = Date.now(), chars = 3000 } = {}) {
  const r = await fetchFullText(item, { fetcher, now });
  const text = r.ok ? r.text.slice(0, chars) : null;
  try {
    await ftTable(env);
    await env.DB.prepare('INSERT OR REPLACE INTO fulltext (id, source, ts, ok, len, via, err, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(item.id, item.source || '', now, r.ok ? 1 : 0, r.len || 0, r.via || null, r.ok ? null : String(r.error || '') + (r.status ? ' ' + r.status : ''), text)
      .run();
  } catch {}
  return r.ok ? { ...r, text } : r;
}

/** 一组材料里哪些会去读全文、按什么顺序：来源在名单里、现在只有标题或摘要、带链接的；深度文章优先，其次分数高的；最多 12 篇 */
export function ftCandidates(srcs, c) {
  const cand = srcs
    .filter((s) => s.url && s.k !== 'f' && c.sources.has(s.source))
    // 分数是 AI 只看标题和摘要打的，看不出哪篇写得更全；所以分数四舍五入后一样就算差不多，挑更新的那篇（后续报道通常更完整）
    .sort((a, b) => (b.art ? 1 : 0) - (a.art ? 1 : 0) || Math.round(b.score || 0) - Math.round(a.score || 0) || (b.ts || 0) - (a.ts || 0));
  // 先每家来源各取一篇，再取第二篇：免得读到的全是同一家的说法
  const seen = new Map();
  const round = new Map();
  for (const s of cand) {
    // 转述别家的（“据彭博社报道”）记在最初那家名下：三家都在转同一篇，读一篇就够
    const who = countedAs(s);
    round.set(s, seen.get(who) || 0);
    seen.set(who, round.get(s) + 1);
  }
  cand.sort((a, b) => round.get(a) - round.get(b));
  cand.splice(12);
  return cand;
}

/**
 * 不真的去读，只算“点了深读或写稿会读哪些全文”。和 attachFullText 用同一套挑法。
 * st：have = 以前读到过，直接用；new = 这次会去读；fail = 最近读失败过，暂时不再试；over = 超过一次新读的篇数，这次轮不到
 */
export async function fullTextPlan(env, srcs, { now = Date.now() } = {}) {
  const c = fullTextConfig(env);
  if (!c.on) return [];
  const cand = ftCandidates(srcs, c);
  if (!cand.length) return [];
  let rows = [];
  try {
    await ftTable(env);
    rows = (await env.DB.prepare(`SELECT id, ts, ok, len, length(text) AS tl FROM fulltext WHERE id IN (${cand.map(() => '?').join(',')})`).bind(...cand.map((s) => s.id)).all()).results;
  } catch {}
  const have = new Map(rows.map((r) => [r.id, r]));
  let todo = 0;
  return cand.map((s) => {
    const h = have.get(s.id);
    const st = h?.ok && h.tl ? 'have' : h && now - h.ts < c.retryH * 3_600_000 ? 'fail' : todo++ < c.max ? 'new' : 'over';
    return { id: s.id, source: s.source, title: s.title, url: s.url, from: s.from, ts: s.ts, st, len: st === 'have' ? h.len || h.tl : undefined };
  });
}

/**
 * 给一组材料（档案/英文稿用的 srcs）补全文：只挑来源在名单里、现在只有标题或摘要、带链接的；深度文章优先，其次分数高的。
 * 存过的直接用；没存过的最多新读 max 篇（同时读，各自 12 秒超时）。读到的把 body 换成全文、k 改成 'f'、full = true。
 * 返回 { got: 用上全文的篇数, fetched: 这次新读了几篇, failed: [{ source, error }] }
 */
export async function attachFullText(env, srcs, { fetcher = fetch, now = Date.now() } = {}) {
  const c = fullTextConfig(env);
  const out = { got: 0, fetched: 0, failed: [] };
  if (!c.on) return out;
  const cand = ftCandidates(srcs, c);
  if (!cand.length) return out;
  let rows = [];
  try {
    await ftTable(env);
    rows = (await env.DB.prepare(`SELECT id, ts, ok, text, err FROM fulltext WHERE id IN (${cand.map(() => '?').join(',')})`).bind(...cand.map((s) => s.id)).all()).results;
  } catch {}
  const have = new Map(rows.map((r) => [r.id, r]));
  const use = (s, text) => {
    s.body = text;
    s.k = 'f';
    s.full = true;
    out.got++;
  };
  const todo = [];
  for (const s of cand) {
    const h = have.get(s.id);
    if (h?.ok && h.text) use(s, h.text);
    else if (h && now - h.ts < c.retryH * 3_600_000) continue; // 刚失败过，先不再试
    else if (todo.length < c.max) todo.push(s);
  }
  const res = await Promise.all(todo.map((s) => readAndStore(env, s, { fetcher, now, chars: c.chars }).catch((e) => ({ ok: false, error: 'fetch', detail: String(e?.message || e) }))));
  res.forEach((r, i) => {
    out.fetched++;
    if (r.ok) use(todo[i], r.text);
    else out.failed.push({ source: todo[i].source, error: r.error });
  });
  return out;
}

/**
 * 每天自检：从 testAt 那一分钟起，每分钟拿一个名单里的来源的最新一篇试读一次（一天十来次请求），
 * 结果记在 meta 表的 fulltext_health：{ 来源: { ok, len, err, at, fails: 连续失败天数 } }。页面和每日检查靠它发现“抽取坏了”。
 */
export async function fullTextSelfTest(env, { now = Date.now(), fetcher = fetch, metaGet, metaSet } = {}) {
  const c = fullTextConfig(env);
  if (!c.on || c.testAt < 0) return null;
  const names = [...c.sources];
  const k = Math.floor((now % 86_400_000) / 60_000) - c.testAt;
  if (k < 0 || k >= names.length) return null;
  const source = names[k];
  const it = (await env.DB.prepare('SELECT id, source, title, url FROM items WHERE source = ? AND url IS NOT NULL ORDER BY ts DESC LIMIT 1').bind(source).all()).results?.[0];
  const health = (await metaGet(env, 'fulltext_health'))?.v || {};
  const prev = health[source] || { fails: 0 };
  if (!it) health[source] = { ok: false, err: 'no_item', at: now, fails: prev.fails || 0 };
  else {
    const r = await readAndStore(env, it, { fetcher, now, chars: c.chars });
    health[source] = r.ok ? { ok: true, len: r.len, at: now, fails: 0 } : { ok: false, err: String(r.error || '') + (r.status ? ' ' + r.status : ''), len: r.len || 0, at: now, fails: (prev.fails || 0) + 1 };
  }
  for (const n of Object.keys(health)) if (!c.sources.has(n)) delete health[n];
  await metaSet(env, 'fulltext_health', health, now);
  return { source, ...health[source] };
}
