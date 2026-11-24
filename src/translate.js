// 中英互译：英文快讯译成中文，中文快讯译成英文，存进 D1，看板切换语言时直接读。
// 用 Cloudflare Workers AI（和评分共用免费额度），所以只翻评分达到 TRANSLATE_MIN_SCORE 的快讯。
// AI 出错或额度用完时返回 null，下一轮再试；看板这时显示原文。

import { isZh } from './embed.js';

const PROMPTS = {
  zh: `You translate financial news flashes into Simplified Chinese for professional investors.
Use standard mainland financial terminology (e.g. 美联储, 回购, 做空, 财报, 加息). Keep numbers, currencies, percentages and tickers exactly as written.
Use the established Chinese name for well-known companies, people and places (Nvidia = 英伟达, Jensen Huang = 黄仁勋, Fed = 美联储); keep other proper nouns in their original spelling.
Be concise and neutral, like a wire headline. Do not add or drop facts, do not explain.`,
  en: `You translate Chinese financial news flashes into English for professional investors.
Write in concise wire-headline style (Reuters / Bloomberg). Keep numbers, currencies, percentages and tickers exactly as written.
Use the established English name for companies, people and places. Do not add or drop facts, do not explain.`,
};
const FORMAT = `The user message lists numbered items. Each has a headline "T:" and sometimes a summary "B:".
Reply with ONLY a JSON array, one object per item, using the item's number as "i", "t" for the translated headline and "b" for the translated summary ("" when there is none):
[{"i": 0, "t": "...", "b": "..."}]. No other text.`;

/** 这条快讯该译成哪种语言：含汉字译成英文，否则译成中文 */
export const targetLang = (title) => (isZh(title) ? 'en' : 'zh');

function tidy(s, max) {
  return String(s || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/(?:^|\s|(?<=[^\x00-\x7f]))(?:[a-z0-9-]+\.)+[a-z]{2,6}\/[\w\-\/.?=&%#]+/gi, ' ') // reut.rs/xxxx 这类不带 http 的短链接
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function buildList(items) {
  return items
    .map((it, i) => {
      const t = tidy(it.title, 400);
      const b = tidy(it.body, 320);
      // 摘要只是把标题重复一遍的，不用翻
      return `${i}.\nT: ${t}` + (b && !t.startsWith(b.slice(0, 60)) ? `\nB: ${b}` : '');
    })
    .join('\n');
}

/** 解析模型回复，返回 [{t, b} | null]；整体不合法返回 null */
export function parseTranslations(raw, n) {
  let data = raw;
  if (typeof raw === 'string') {
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return null;
    try {
      data = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(data)) return null;
  const out = new Array(n).fill(null);
  for (const o of data) {
    const i = Number(o?.i);
    const t = typeof o?.t === 'string' ? o.t.trim() : '';
    if (Number.isInteger(i) && i >= 0 && i < n && t) out[i] = { t, b: typeof o?.b === 'string' ? o.b.trim() : '' };
  }
  return out;
}

/**
 * @param items [{title, body}]，同一批必须是同一个目标语言
 * @returns [{t, b} | null]；整批失败返回 null
 */
export async function translateBatch(env, items, lang) {
  if (!env.AI || !items.length) return null;
  try {
    const res = await env.AI.run(env.TRANSLATE_MODEL || env.AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: PROMPTS[lang] + '\n' + FORMAT },
        { role: 'user', content: buildList(items) },
      ],
      max_tokens: 60 + items.length * 260,
      temperature: 0,
    });
    const raw = res?.response ?? res;
    const out = parseTranslations(raw, items.length);
    if (!out) console.warn('translation reply not parseable', String(typeof raw === 'string' ? raw : JSON.stringify(raw)).slice(0, 300));
    return out;
  } catch (e) {
    console.warn('translation failed', e?.message || e);
    return null;
  }
}

// ---------- MyMemory（免费公共翻译接口，不占 Workers AI 额度） ----------
// 不带邮箱每天约 5000 字符，带邮箱（机密变量 MYMEMORY_EMAIL）每天约 5 万字符。一次请求翻一条标题，最长 500 字节。

const MM_LANG = { zh: 'zh-CN', en: 'en', ar: 'ar' };
const sourceLang = (title) => (isZh(title) ? 'zh' : /\p{Script=Arabic}/u.test(title) ? 'ar' : 'en');

/** 按 UTF-8 字节数截断，不切坏字符 */
export function clipBytes(s, max) {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= max) return s;
  let out = '';
  let n = 0;
  for (const ch of s) {
    n += enc.encode(ch).length;
    if (n > max - 3) break;
    out += ch;
  }
  return out + '…';
}

/** 检查 MyMemory 的回复；可用返回译文，额度用完返回 false，其它问题返回 null */
export function readMyMemory(data, lang) {
  const text = String(data?.responseData?.translatedText || '').trim();
  if (data?.quotaFinished || Number(data?.responseStatus) === 429 || /^MYMEMORY WARNING/i.test(text)) return false;
  if (Number(data?.responseStatus) !== 200 || !text || /QUERY LENGTH LIMIT|INVALID (SOURCE|TARGET) LANGUAGE/i.test(text)) return null;
  if (lang === 'zh' && !isZh(text)) return null; // 说是译成中文却没有汉字
  return text;
}

export async function myMemoryTranslate(env, title, lang, fetcher = fetch) {
  const q = clipBytes(tidy(title, 400), 480);
  const u = new URL('https://api.mymemory.translated.net/get');
  u.searchParams.set('q', q);
  u.searchParams.set('langpair', MM_LANG[sourceLang(title)] + '|' + MM_LANG[lang]);
  if (env.MYMEMORY_EMAIL) u.searchParams.set('de', env.MYMEMORY_EMAIL);
  try {
    const res = await fetcher(u, { signal: AbortSignal.timeout(8000) });
    const data = await res.json().catch(() => null);
    if (res.status === 429) return false;
    const out = readMyMemory(data, lang);
    if (out === null) console.warn('mymemory reply not usable', res.status, JSON.stringify(data).slice(0, 200));
    return out;
  } catch (e) {
    console.warn('mymemory failed', e?.message || e);
    return undefined; // 网络问题，下一轮再试
  }
}

/**
 * 每轮抓取后调用：挑最近 24 小时里分数够高、还没翻过的快讯，翻一小批。
 * tr_lang 记录译文语言；翻不出来的条目记为空串，避免每分钟重试同一条。
 * provider: 'ai' 用 Workers AI（标题和摘要），'mymemory' 用 MyMemory（只翻标题）。
 */
export async function translatePending(env, { now = Date.now(), minScore = 6, max = 8, provider = 'ai', aiMin = 0, fetcher } = {}) {
  if (max <= 0 || (provider === 'ai' && !env.AI)) return 0;
  const rows = (
    await env.DB.prepare(
      'SELECT id, title, body, score FROM items WHERE title_tr IS NULL AND score >= ? AND ts > ? ORDER BY important DESC, score DESC, ts DESC LIMIT ?'
    )
      .bind(minScore, now - 86_400_000, max)
      .all()
  ).results;
  let done = 0;
  if (provider === 'mymemory') {
    let left = rows.slice();
    for (const r of rows) {
      const lang = targetLang(r.title);
      const t = await myMemoryTranslate(env, r.title, lang, fetcher);
      if (t === false || t === undefined) break; // 额度用完或网络不通：这一轮到此为止
      await env.DB.prepare('UPDATE items SET title_tr = ?, body_tr = ?, tr_lang = ? WHERE id = ?').bind(t || '', '', lang, r.id).run();
      left = left.filter((x) => x !== r);
      if (t) done++;
    }
    // MyMemory 翻不动时，分数达到 aiMin 的快讯交给 Workers AI（aiMin 为 0 表示不兜底）
    rows.length = 0;
    if (aiMin > 0 && env.AI) rows.push(...left.filter((r) => r.score >= aiMin));
    if (!rows.length) return done;
  }
  for (const lang of ['zh', 'en']) {
    const batch = rows.filter((r) => targetLang(r.title) === lang);
    if (!batch.length) continue;
    const out = await translateBatch(env, batch, lang);
    if (!out) continue;
    await env.DB.batch(
      batch.map((r, i) =>
        env.DB.prepare('UPDATE items SET title_tr = ?, body_tr = ?, tr_lang = ? WHERE id = ?').bind(out[i]?.t || '', out[i]?.b || '', lang, r.id)
      )
    );
    done += out.filter(Boolean).length;
  }
  return done;
}
