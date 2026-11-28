import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mergeStories, storyAlias, resolveAlias, _resetAlias } from '../src/events.js';
import { attachFullText, fullTextSelfTest } from '../src/fulltext.js';
import { deskPaste, deskState } from '../src/desk.js';
import { metaGet, metaSet } from '../src/dbguard.js';
import { claudeReset } from '../src/claude.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  for (const s of ['ALTER TABLE items ADD COLUMN story TEXT', 'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT, updated INTEGER)']) {
    try {
      db.exec(s);
    } catch {}
  }
  const prep = (sql) => {
    let args = [];
    const s = { bind: (...a) => ((args = a), s), all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => db.prepare(sql).run(...args) };
    return s;
  };
  return { prepare: prep, batch: async (l) => Promise.all(l.map((x) => x.run())), raw: db };
}
const NOW = Date.UTC(2026, 10, 26, 9, 0);
const claude = (text, calls = []) => ({ messages: { create: async (req) => (calls.push(req), { stop_reason: 'end_turn', usage: { input_tokens: 2000, output_tokens: 300 }, content: [{ type: 'text', text }] }) } });

test('mergeStories folds reactions into the action, remembers aliases, and stays quiet when nothing is new', async () => {
  claudeReset();
  _resetAlias();
  const DB = d1();
  const ins = DB.raw.prepare('INSERT INTO items (id, source, title, body, url, ts, seen_at, score, topic, tickers, story) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const rows = [
    ['a', 'US unveils tariff plan on 14 partners', 8, 'Tariffs|关税', '美国公布对14个贸易伙伴的关税计划'],
    ['b', '美国公布新关税计划', 7, 'Tariffs|关税', '美国公布对14个贸易伙伴的关税计划'],
    ['c', 'Japan protests planned 15% US tariff', 6, 'Tariffs|关税', '日本抗议美国关税'],
    ['d', 'Singapore very disappointed by new US tariffs', 3, 'Tariffs|关税', '新加坡对美国新关税表示失望'],
    ['e', 'Singapore urges US to reconsider tariffs', 6, 'Tariffs|关税', '新加坡对美国新关税表示失望'],
    ['f', 'Nvidia halts chip deliveries', 10, 'Nvidia|英伟达', '英伟达暂停对东南亚芯片交付'],
  ];
  rows.forEach(([id, title, score, topic, story], k) => ins.run(id, 'CNBC', title, '', 'https://x/' + id, NOW - 3_600_000 + k * 1000, NOW, score, topic, '', story));
  const calls = [];
  const env = { DB, CLAUDE_CLIENT: claude('{"groups": [[1, 2, 3]]}', calls) };
  // 清单按最新消息排：新加坡(1) 日本(2) 关税计划(3) 英伟达... 先看一眼顺序再给答案
  const dry = await mergeStories(env, { now: NOW, dry: true });
  assert.equal(dry.list, 4);
  const order = dry.names.map((n) => n.replace(/ \(\d+\)$/, ''));
  const idx = (p) => order.findIndex((n) => n.startsWith(p)) + 1;
  env.CLAUDE_CLIENT = claude(JSON.stringify({ groups: [[idx('美国公布'), idx('日本'), idx('新加坡')]] }), calls);
  const r = await mergeStories(env, { now: NOW });
  assert.equal(r.ok, true);
  assert.deepEqual(r.merges, [{ canon: '美国公布对14个贸易伙伴的关税计划', aliases: ['日本抗议美国关税', '新加坡对美国新关税表示失望'] }]);
  assert.equal(r.moved, 3); // 含 3 分的那条
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE story = '美国公布对14个贸易伙伴的关税计划'").get().n, 5);
  assert.deepEqual(calls.at(-1).thinking, { type: 'adaptive' });
  const alias = await storyAlias(env, NOW);
  assert.equal(resolveAlias('日本抗议美国关税', alias), '美国公布对14个贸易伙伴的关税计划');
  // 没有新事件：不再调模型
  const n = calls.length;
  const again = await mergeStories(env, { now: NOW + 600_000 });
  assert.equal(again.fresh, 0);
  assert.equal(calls.length, n);
});

test('attachFullText reads listed sources once, stores them, skips unlisted ones; self-test records health', async () => {
  const DB = d1();
  const body = '<article>' + '<p>The company said on Thursday that it would raise output next year, citing demand.</p>'.repeat(8) + '</article>';
  let hits = 0;
  const fetcher = async (u) => {
    if (String(u).endsWith('/robots.txt')) return new Response('', { status: 200 });
    hits++;
    return String(u).includes('bad') ? new Response('no', { status: 403 }) : new Response(body, { status: 200 });
  };
  const srcs = () => [
    { n: 1, id: 'x1', source: 'CNBC', url: 'https://cnbc.example/a', k: 'h', body: '', score: 8 },
    { n: 2, id: 'x2', source: 'Nasdaq', url: 'https://nasdaq.example/a', k: 'h', body: '', score: 9 },
    { n: 3, id: 'x3', source: 'Arab News', url: 'https://arab.example/bad', k: 's', body: 'short', score: 7 },
    { n: 4, id: 'x4', source: 'BBC Business', url: 'https://bbc.example/a', k: 'f', body: 'already full', score: 7 },
  ];
  const env = { DB };
  const a = srcs();
  const r = await attachFullText(env, a, { fetcher, now: NOW });
  assert.deepEqual([r.got, r.fetched, r.failed], [1, 2, [{ source: 'Arab News', error: 'refused' }]]);
  assert.equal(a[0].k, 'f');
  assert.ok(a[0].full && a[0].body.startsWith('The company said'));
  assert.equal(a[1].k, 'h'); // Nasdaq 不在名单里
  assert.equal(hits, 2);
  // 第二次：存过的直接用，刚失败的不再试
  const b = srcs();
  const r2 = await attachFullText(env, b, { fetcher, now: NOW + 60_000 });
  assert.deepEqual([r2.got, r2.fetched], [1, 0]);
  assert.equal(hits, 2);
  // 自检：第 200 分钟试名单里第一个来源
  DB.raw.prepare('INSERT INTO items (id, source, title, body, url, ts, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('w1', '华尔街见闻文章', 't', '', 'https://w.example/bad', NOW, NOW);
  const day = Date.UTC(2026, 10, 27, 0, 0) + 200 * 60_000;
  const t = await fullTextSelfTest(env, { now: day, fetcher, metaGet, metaSet });
  assert.equal(t.source, '华尔街见闻文章');
  assert.equal(t.ok, false);
  assert.equal(t.fails, 1);
  assert.equal(await fullTextSelfTest(env, { now: day - 60_000, fetcher, metaGet, metaSet }), null);
});

test('deskPaste stores pasted text without calling the model', async () => {
  claudeReset();
  const DB = d1();
  const calls = [];
  const env = { DB, CLAUDE_CLIENT: claude('x', calls) };
  await deskState(env, { now: NOW }); // 没有表也不报错
  assert.equal((await deskPaste(env, { run: 1, rank: 1, paste: { label: 'FT', text: 'y'.repeat(300) }, now: NOW })).error, 'no_topic');
  DB.raw.prepare('INSERT INTO desk_runs (id, ts, slot, n, topics, usd, model) VALUES (1, ?, ?, 1, ?, 0, ?)').run(NOW, 'manual', JSON.stringify([{ rank: 1, title_zh: '甲', title_en: 'A', ids: [], stories: [] }]), 'm');
  assert.equal((await deskPaste(env, { run: 1, rank: 1, paste: { label: 'FT', text: 'short' }, now: NOW })).error, 'paste_short');
  const r = await deskPaste(env, { run: 1, rank: 1, paste: { label: 'FT 11-26', text: '正文'.repeat(200) }, now: NOW });
  assert.deepEqual(r, { ok: true, n: 1 });
  const st = await deskState(env, { now: NOW });
  assert.deepEqual(st.pasted[1], [{ label: 'FT 11-26', len: 400 }]);
  assert.equal(st.dossiers[1], undefined); // 只贴了全文，不算有档案
  assert.equal((await deskPaste(env, { run: 1, rank: 1, drop: 0, now: NOW })).n, 0);
  assert.equal(calls.length, 0);
});
