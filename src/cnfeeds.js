// 中文快讯（财联社电报、华尔街见闻、格隆汇、金十等）的公开 JSON 接口解析。
// 各家字段名不同，这里统一成 { id, source, title, body, url, ts }。

function strip(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// 在返回的 JSON 里找第一组“快讯列表”（对象数组）
function findList(x, depth = 0) {
  if (!x || depth > 4) return null;
  if (Array.isArray(x)) return x.length && typeof x[0] === 'object' ? x : null;
  if (typeof x !== 'object') return null;
  for (const k of ['roll_data', 'items', 'list', 'result', 'data']) {
    const r = findList(x[k], depth + 1);
    if (r) return r;
  }
  for (const v of Object.values(x)) {
    const r = findList(v, depth + 1);
    if (r) return r;
  }
  return null;
}

// 秒/毫秒/“北京时间字符串”都转成毫秒
function toMs(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    const n = Number(v);
    return n < 1e12 ? n * 1000 : n;
  }
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5], +(m[6] || 0)); // 无时区按北京时间
  return Date.parse(v);
}

const URLS = {
  cls: (o) => o.shareurl || `https://www.cls.cn/detail/${o.id}`,
  wscn: (o) => o.uri || `https://wallstreetcn.com/livenews/${o.id}`,
  wscnArticle: (o) => o.uri || `https://wallstreetcn.com/articles/${o.id}`,
  gelonghui: (o) => (o.route ? new URL(o.route, 'https://www.gelonghui.com').href : `https://www.gelonghui.com/live/${o.id}`),
  jin10: (o) => `https://flash.jin10.com/detail/${o.id}`,
};

export function parseCnJson(text, sourceName, format) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('返回的不是 JSON');
  }
  const list = findList(j);
  if (!list) throw new Error('没找到快讯列表');
  const out = [];
  for (let o of list) {
    // 华尔街见闻“信息流”接口：每条包在 resource 里，还夹着广告；只要文章（快讯另有 7x24 源）
    if (o && o.resource && typeof o.resource === 'object') {
      if (o.resource_type !== 'article') continue;
      o = o.resource;
    }
    if (!o || o.id == null) continue;
    // content_short：华尔街见闻文章接口公开给出的导语（约 150 字；正文不在这个接口里）
    const content = strip(o.content_text || o.content || o.content_short || o.brief || o.summary || (o.data && (o.data.content || o.data.title)) || '');
    // 很多快讯是“【标题】正文”的格式，取方括号里的做标题
    const bracket = content.match(/^【([^】]{4,120})】/);
    const title = strip(o.title) || (bracket ? bracket[1] : content.slice(0, 280));
    if (!title) continue;
    const ts = toMs(o.ctime ?? o.display_time ?? o.createTimestamp ?? o.created_at ?? o.time ?? o.publish_time);
    out.push({
      id: `${format}:${o.id}`,
      source: sourceName,
      title,
      body: content.slice(0, 500),
      url: (URLS[format] || (() => ''))(o),
      ts: Number.isNaN(ts) ? Date.now() : ts,
    });
  }
  return out;
}

/**
 * 从文章列表网页（服务器直接输出的 HTML）里取文章：智通财经美股频道、格隆汇首页这类没有公开 JSON 接口的来源。
 * src.link 是认文章链接的正则（第一个有值的括号是文章编号）。标题取链接文字，导语和时间取链接后面、下一篇之前的文字。
 * 只读公开网页上列出的标题和导语，不进文章页。
 */
export function parseHtmlList(html, src, now = Date.now()) {
  const linkRe = new RegExp(src.link);
  const body = String(html || '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ');
  const A = /<a\b[^>]*?href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  const hits = [];
  let m;
  while ((m = A.exec(body))) {
    const href = m[1] || m[2] || m[3];
    const g = href.match(linkRe);
    const id = g && g.slice(1).find((x) => x);
    if (id) hits.push({ id, href, text: strip(m[4]), at: m.index, end: A.lastIndex });
  }
  const out = new Map();
  hits.forEach((h, k) => {
    let o = out.get(h.id);
    if (!o) out.set(h.id, (o = { id: h.id, href: h.href, title: '', tail: '' }));
    if (h.text.length > o.title.length) o.title = h.text;
    // 这篇的最后一个链接之后、别的文章的第一个链接之前的那段文字
    const next = hits.slice(k + 1).find((x) => x.id !== h.id);
    if (!hits.slice(k + 1).some((x) => x.id === h.id)) o.tail = strip(body.slice(h.end, Math.min(next ? next.at : h.end + 1500, h.end + 1500)));
  });
  const items = [];
  for (const o of out.values()) {
    if (o.title.length < 8) continue;
    let ts = NaN;
    const abs = o.tail.match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
    const rel = o.tail.match(/(\d+)\s*(分钟|小时)前/);
    if (abs) ts = toMs(abs[1] + ' ' + abs[2]);
    else if (rel) ts = now - Number(rel[1]) * (rel[2] === '小时' ? 3_600_000 : 60_000);
    const sum = o.tail.split(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}|来自主题|\d+\s*(?:分钟|小时)前/)[0].trim();
    let url = o.href;
    try {
      url = new URL(o.href, src.url).href;
    } catch {}
    items.push({ id: `${src.format || 'html'}:${o.id}`, source: src.name, title: o.title.slice(0, 280), body: sum.length >= 30 && sum !== o.title ? sum.slice(0, 500) : '', url, ts: Number.isNaN(ts) || ts > now + 600_000 ? now : ts });
  }
  // 一条都没解析出来：把页面长什么样记进错误里（长度、有没有文章链接、页面标题），方便判断是被拦了、改版了还是要靠 JS 加载
  if (!items.length) {
    const raw = String(html || '');
    const t = (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
    throw new Error(`htmllist empty: len=${raw.length} anchors=${(raw.match(/<a\b/gi) || []).length} linkhits=${(raw.match(new RegExp(src.link, 'g')) || []).length} title=${strip(t).slice(0, 60)}`);
  }
  return items;
}
