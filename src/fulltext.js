// 文章全文（试验）：按需、一篇一篇地读公开网页上的正文，给写档案和写稿当材料用。
// 守规矩：如实报上自己的身份，先看 robots.txt，被拒或要付费就停，不伪装浏览器、不带 cookie、不走代理。

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
const prose = (t) => t.length >= 40 || (t.length >= 6 && /[。.!?！？”"]$/.test(t));

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
    const ps = trim(paras(m[0]));
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
