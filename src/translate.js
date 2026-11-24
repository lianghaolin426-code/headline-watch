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

/**
 * 每轮抓取后调用：挑最近 24 小时里分数够高、还没翻过的快讯，翻一小批。
 * tr_lang 记录译文语言；模型漏掉的条目记为空串，避免每分钟重试同一条。
 */
export async function translatePending(env, { now = Date.now(), minScore = 6, max = 8 } = {}) {
  if (!env.AI || max <= 0) return 0;
  const rows = (
    await env.DB.prepare(
      'SELECT id, title, body FROM items WHERE title_tr IS NULL AND score >= ? AND ts > ? ORDER BY important DESC, score DESC, ts DESC LIMIT ?'
    )
      .bind(minScore, now - 86_400_000, max)
      .all()
  ).results;
  let done = 0;
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
