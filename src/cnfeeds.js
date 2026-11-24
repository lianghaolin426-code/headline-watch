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
  for (const o of list) {
    if (!o || o.id == null) continue;
    const content = strip(o.content_text || o.content || o.brief || o.summary || (o.data && (o.data.content || o.data.title)) || '');
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
