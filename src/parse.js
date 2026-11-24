// 解析各种来源：Telegram 公开频道网页（t.me/s/xxx）和 RSS/Atom。
// Workers 里没有 DOMParser，所以用正则；这两种格式都很稳定，正则足够。

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitTitle(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  // 去掉结尾的 "(@WalterBloomberg)" 这类署名行
  while (lines.length && /^\(?@\w+\)?$/.test(lines[lines.length - 1])) lines.pop();
  const title = lines[0] || '';
  const body = lines.slice(1).join('\n');
  return { title, body };
}

/** 解析 https://t.me/s/<channel> 页面，返回最新约 20 条 */
export function parseTelegram(html, channel) {
  const items = [];
  const blocks = html.split('tgme_widget_message_wrap').slice(1);
  for (const b of blocks) {
    const post = b.match(/data-post="([^"\/]+)\/(\d+)"/);
    if (!post) continue;
    const textM = b.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!textM) continue; // 纯图片/视频帖，没有文字，跳过
    const text = htmlToText(textM[1]);
    if (!text) continue;
    const timeM = b.match(/<time datetime="([^"]+)"/);
    const { title, body } = splitTitle(text);
    items.push({
      id: `tg:${post[1]}/${post[2]}`.toLowerCase(),
      source: `TG @${channel}`,
      title,
      body,
      url: `https://t.me/${post[1]}/${post[2]}`,
      ts: timeM ? Date.parse(timeM[1]) || Date.now() : Date.now(),
    });
  }
  return items;
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  if (!m) return '';
  let v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) v = cdata[1];
  return v.trim();
}

function parseDate(s) {
  if (!s) return NaN;
  let t = Date.parse(s);
  if (Number.isNaN(t)) {
    // Investing.com 用的 "2026-11-15 13:05:31"（无时区，按 UTC 处理）
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
    if (m) t = Date.parse(`${m[1]}T${m[2]}Z`);
  }
  return t;
}

/** 解析 RSS 2.0 或 Atom */
export function parseFeed(xml, sourceName) {
  const items = [];
  const re = /<(item|entry)[\s>][\s\S]*?<\/\1>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const x = m[0];
    const descRaw = tag(x, 'description') || tag(x, 'summary') || '';
    // Bluesky 等社交平台的 RSS 没有 <title>，用正文开头当标题
    let title = htmlToText(decodeEntitiesIfEscaped(tag(x, 'title')));
    if (!title) title = htmlToText(decodeEntitiesIfEscaped(descRaw)).split('\n')[0].slice(0, 280);
    if (!title) continue;
    let link = tag(x, 'link');
    if (!link) {
      const href = x.match(/<link[^>]*href="([^"]+)"/i);
      if (href) link = href[1];
    }
    link = decodeEntities(link);
    const guid = tag(x, 'guid') || tag(x, 'id') || link || title;
    const ts = parseDate(tag(x, 'pubDate') || tag(x, 'published') || tag(x, 'updated') || tag(x, 'dc:date'));
    const desc = descRaw;
    items.push({
      id: `rss:${sourceName}:${decodeEntities(guid)}`.slice(0, 500),
      source: sourceName,
      title,
      body: htmlToText(decodeEntitiesIfEscaped(desc)).slice(0, 500),
      url: link,
      ts: Number.isNaN(ts) ? Date.now() : ts,
    });
  }
  return items;
}

// 有些 RSS 把 HTML 转义后放进 description（&lt;p&gt;），先还原一层再去标签
function decodeEntitiesIfEscaped(s) {
  return /&lt;/.test(s) ? decodeEntities(s) : s;
}
