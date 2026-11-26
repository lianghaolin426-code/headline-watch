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

/** 从文章网页里取正文：去掉脚本、样式、导航，取 <article> 或段落最多的那一块 */
export function htmlText(html) {
  let s = String(html || '').replace(/<(script|style|noscript|svg|nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  const art = s.match(/<article\b[\s\S]*?<\/article>/i);
  if (art) s = art[0];
  const ps = [...s.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => m[1]);
  const text = (ps.length >= 3 ? ps.join('\n') : s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t　]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  return text;
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
    const text = htmlText(html);
    return text.length >= 300 ? { ok: true, via: 'page', len: text.length, text } : { ok: false, error: 'short', len: text.length, htmlLen: html.length, title: (html.match(/<title[^>]*>([^<]*)/i) || [])[1] };
  } catch (e) {
    return { ok: false, error: 'fetch', detail: String(e?.message || e).slice(0, 120) };
  }
}
