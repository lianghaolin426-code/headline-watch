// 补抓：数据库停摆（比如 D1 当天读取额度用完）那段时间漏掉的快讯。
// 只用支持“往前翻页”的源：华尔街见闻（cursor）、格隆汇（时间戳）、Bluesky 账号（官方公开接口 cursor）。
// 普通 RSS 只保留最近几十条，恢复后的第一轮抓取已经把还在源里的都收进来了，翻不了更早的。
//
// 用法（管理密码）：
//   GET  /api/backfill?op=fetch&src=来源名&cursor=… → { items, next }：只抓一页、只解析，不写库
//   POST /api/backfill?op=ingest  body { now, items } → 按 now 当作“当时”走一遍正常的入库、打分、去重流程，但不推送
// 由外部脚本按时间顺序分批调用（每次请求的外部请求数和 CPU 都很少，适合免费版 Workers）。

import { parseCnJson } from './cnfeeds.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function bskyHandle(src) {
  const m = String(src.url || '').match(/bsky\.app\/profile\/([^/]+)\/rss/);
  return m ? m[1] : null;
}

/** 这个源能不能往前翻页 */
export function pageable(src) {
  if (src.type === 'cnjson' && (src.format === 'wscn' || src.format === 'wscnArticle' || src.format === 'gelonghui')) return true;
  return !!bskyHandle(src);
}

function withParam(url, k, v) {
  const u = new URL(url);
  u.searchParams.set(k, v);
  return u.href;
}

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

/** 抓一页（cursor 为空 = 最新一页），返回 { items, next } */
export async function fetchPage(src, cursor, { focusFilter, limit = 100 } = {}) {
  const handle = bskyHandle(src);
  if (handle) {
    let url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=${Math.min(limit, 100)}&filter=posts_no_replies`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    const j = JSON.parse(await get(url));
    const items = [];
    for (const f of j.feed || []) {
      if (f.reason) continue; // 转发的别人的帖子，RSS 里也没有
      const p = f.post;
      const text = String(p?.record?.text || '').trim();
      if (!p?.uri || !text) continue;
      const rkey = p.uri.split('/').pop();
      // 和 RSS 解析出来的一致：id = rss:来源名:at://…，标题 = 正文第一行
      items.push({
        id: `rss:${src.name}:${p.uri}`.slice(0, 500),
        source: src.name,
        title: text.split('\n')[0].slice(0, 280),
        body: text.slice(0, 500),
        url: `https://bsky.app/profile/${handle}/post/${rkey}`,
        ts: Date.parse(p.record.createdAt || p.indexedAt),
      });
    }
    const ts = (j.feed || []).map((f) => Date.parse(f.post?.record?.createdAt || f.post?.indexedAt)).filter(Number.isFinite);
    return { items, next: j.cursor || null, oldest: ts.length ? Math.min(...ts) : null };
  }

  if (src.type === 'cnjson') {
    let url = withParam(src.url, 'limit', String(Math.min(limit, 100)));
    if (cursor) url = withParam(url, src.format === 'gelonghui' ? 'timestamp' : 'cursor', cursor);
    const text = await get(url);
    let items = parseCnJson(text, src.name, src.format);
    let next = null;
    if (src.format === 'gelonghui') {
      // 格隆汇按时间戳（秒）往前翻：下一页从这一页最早一条之前开始
      const oldest = Math.min(...items.map((i) => i.ts));
      next = items.length && Number.isFinite(oldest) ? String(Math.floor(oldest / 1000)) : null;
    } else {
      try {
        next = JSON.parse(text)?.data?.next_cursor || null;
      } catch {}
    }
    const oldest = items.length ? Math.min(...items.map((i) => i.ts)) : null;
    if (focusFilter) items = focusFilter(src, items);
    return { items, next: next ? String(next) : null, oldest };
  }
  throw new Error('这个源不支持往前翻页');
}

/** 调试用：看某个源接口的原始返回（只允许源本身的域名） */
export async function rawPage(src, query) {
  const base = bskyHandle(src) ? 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed' : src.url;
  const u = new URL(base);
  for (const [k, v] of new URLSearchParams(query || '')) u.searchParams.set(k, v);
  const r = await fetch(u.href, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cf: { cacheTtl: 0 } });
  return { status: r.status, url: u.href, text: (await r.text()).slice(0, 4000) };
}
