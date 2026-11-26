import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { heatOf, simpleHeat, poissonTail, eventCard, weigh, boardState, boardPublic, evAct, eventDetail, eventTopic, applyDeskRun, evCalib, _resetEv } from '../src/board.js';
import { originOf, countedAs } from '../src/origin.js';
import { deskPaste, tidyYahoo, tidyYahooExt, usExtended, DESK_TABLES } from '../src/desk.js';
import { _resetAlias } from '../src/events.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  for (const s of ['ALTER TABLE items ADD COLUMN story TEXT', 'ALTER TABLE items ADD COLUMN hook INTEGER', 'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT, updated INTEGER)', ...DESK_TABLES, 'ALTER TABLE desk_runs ADD COLUMN mood TEXT']) {
    try {
      db.exec(s);
    } catch {}
  }
  const prep = (sql) => {
    let args = [];
    const s = { bind: (...a) => ((args = a), s), all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => ({ meta: db.prepare(sql).run(...args) }) };
    return s;
  };
  return { prepare: prep, batch: async (l) => Promise.all(l.map((x) => x.run())), raw: db };
}
const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 26, 9, 0);

test('originOf spots relayed reports and counts them under the original outlet', () => {
  assert.equal(originOf({ source: '格隆汇', title: '据彭博社报道，英伟达暂停向东南亚交付芯片' }), 'Bloomberg');
  assert.equal(originOf({ source: '华尔街见闻', title: '路透：沙特阿美考虑出售管道股权' }), 'Reuters');
  assert.equal(originOf({ source: 'FinancialJuice', title: 'Nvidia halts chip deliveries to Southeast Asia - WSJ' }), 'WSJ');
  assert.equal(originOf({ source: 'investingLive', title: 'Fed seen holding in December, according to Reuters sources' }), 'Reuters');
  assert.equal(originOf({ source: 'Reuters (Bluesky)', title: 'Reuters reports Aramco weighs pipeline stake sale' }), ''); // 自己报自己的不算转述
  assert.equal(originOf({ source: 'CNBC', title: 'Nvidia shares fall 4% after chip halt' }), '');
  assert.equal(originOf({ source: '格隆汇', title: '美联储官员称12月加息几乎没有悬念' }), '');
  assert.equal(countedAs({ source: '格隆汇', title: '据彭博社报道，X' }), 'Bloomberg');
  assert.equal(countedAs({ source: '华尔街见闻文章', title: '深度：X' }), '华尔街见闻');
});

test('poissonTail and heat: surprise against the event\'s own pace, new outlets, new developments, cooling', () => {
  assert.ok(Math.abs(poissonTail(3, 1) - 0.0803) < 0.001);
  assert.equal(poissonTail(0, 2), 1);
  const g = [];
  for (let k = 0; k < 96; k++) g.push(NOW - k * 0.5 * H); // 全站节奏平稳
  const mk = (hoursAgo, o = {}) => ({ ts: hoursAgo.map((h) => NOW - h * H), outs: o.outs || [{ o: 'A', first: NOW - Math.max(...hoursAgo) * H }], sc: hoursAgo.map((h, k) => ({ ts: NOW - h * H, s: (o.sc || [])[k] ?? 6 })), whos: [] });
  // 一小时前才出现：新
  assert.equal(heatOf(mk([1, 0.5]), g, NOW).st, 'new');
  // 平时 20 小时才 2 条，最近 2 小时来了 4 条：升温
  const up = heatOf(mk([20, 10, 1.5, 1, 0.5, 0.2]), g, NOW);
  assert.equal(up.st, 'up');
  assert.equal(up.k2, 4);
  assert.ok(up.p < 0.05);
  // 一直每小时一条，最近 2 小时也是 2 条：平稳
  assert.equal(heatOf(mk([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 1.5, 0.5]), g, NOW).st, 'flat');
  // 最近 3 小时新加入两家媒体，且这 2 小时有 2 条：升温
  const nu = heatOf(mk([10, 9, 1, 0.5], { outs: [{ o: 'A', first: NOW - 10 * H }, { o: 'B', first: NOW - 1 * H }, { o: 'C', first: NOW - 0.5 * H }] }), g, NOW);
  assert.equal(nu.st, 'up');
  assert.deepEqual(nu.newOut, ['B', 'C']);
  // 出现了更高分的消息（新进展），这 2 小时有 2 条：升温；只有孤零零一条不算
  assert.equal(heatOf(mk([10, 9, 8, 7, 6, 5, 1, 0.5], { sc: [6, 6, 6, 6, 6, 6, 9, 6] }), g, NOW).dev, 'score');
  assert.equal(heatOf(mk([10, 9, 8, 7, 6, 5, 1, 0.5], { sc: [6, 6, 6, 6, 6, 6, 9, 6] }), g, NOW).st, 'up');
  assert.equal(heatOf(mk([10, 9, 8, 7, 6, 5, 4, 1], { sc: [6, 6, 6, 6, 6, 6, 6, 9] }), g, NOW).st, 'flat');
  // 之前每小时一条，最近 6 小时一条都没有：降温
  assert.equal(heatOf(mk([20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7]), g, NOW).st, 'down');
  // 时段修正：全站最近 2 小时的消息量是平时的 3 倍（开盘），同样的 4 条就不算意外
  const busy = g.concat(Array.from({ length: 12 }, (_, k) => NOW - k * 0.15 * H));
  assert.ok(heatOf(mk([20, 15, 10, 5, 1.5, 1, 0.5, 0.2]), busy, NOW).p > heatOf(mk([20, 15, 10, 5, 1.5, 1, 0.5, 0.2]), g, NOW).p);
  assert.equal(simpleHeat([NOW - 20 * H, NOW - 1 * H, NOW - 0.5 * H, NOW - 0.2 * H], NOW), 'up');
});

const item = (id, story, hoursAgo, o = {}) => ({ id, source: o.source || 'CNBC', title: o.title || 'T ' + id, body: o.body || '', url: 'https://x/' + id, ts: NOW - hoursAgo * H, seen_at: NOW, score: o.score ?? 7, story, tickers: o.tickers || '', topic: o.topic || '', kind: o.kind || 'f', who: o.who || '', dir: o.dir ?? 0, pick: o.pick ?? null, hook: o.hook ?? 0 });
function seed(DB, list) {
  const ins = DB.raw.prepare('INSERT INTO items (id, source, title, body, url, ts, seen_at, score, story, tickers, topic, kind, who, dir, pick, hook) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const i of list) ins.run(i.id, i.source, i.title, i.body, i.url, i.ts, i.seen_at, i.score, i.story, i.tickers, i.topic, i.kind, i.who, i.dir, i.pick, i.hook);
}

test('eventCard counts relays once, finds split views; weigh explains the ranking', () => {
  const its = [
    item('a', 'S', 5, { source: 'Bloomberg (Bluesky)', title: 'Nvidia halts deliveries', score: 9, tickers: 'NVDA' }),
    item('b', 'S', 4, { source: '格隆汇', title: '据彭博社报道，英伟达暂停交付', score: 8, tickers: 'NVDA' }),
    item('c', 'S', 3, { source: '华尔街见闻', title: '彭博：英伟达暂停向东南亚交付芯片', score: 8 }),
    item('d', 'S', 2, { source: 'CNBC', title: 'Goldman says buy the dip in Nvidia', kind: 'v', who: 'Goldman Sachs|高盛', dir: 1, pick: 8 }),
    item('e', 'S', 1, { source: 'CNBC', title: 'Burry says Nvidia has further to fall', kind: 'v', who: 'Michael Burry|迈克尔·伯里', dir: -1, pick: 7 }),
  ];
  const c = eventCard('S', its, its.map((i) => i.ts), NOW);
  assert.equal(c.n, 5);
  assert.equal(c.outlets, 2); // 彭博（含两家转述）+ CNBC
  assert.deepEqual(c.relay, ['Bloomberg']);
  assert.deepEqual(c.split, [1, 1]);
  assert.deepEqual(c.tickers, ['NVDA']);
  assert.equal(c.market, 'US');
  assert.equal(c.latest[0].id, 'e');
  const { w, why } = weigh({ ...c, rec: 2 }, NOW);
  assert.ok(w > 9);
  assert.equal(why[0][0], 'top');
  assert.ok(why.some((x) => x[0] === 'rec'));
  // 很久没动静、又写过的会沉下去
  const low = weigh({ ...c, last: NOW - 20 * H, st: 'down', wr: { same: true, fresh: 0 } }, NOW);
  assert.ok(low.w < w - 5);
  assert.ok(low.why.some((x) => x[0] === 'wr') && low.why.some((x) => x[0] === 'quiet'));
});

test('board: events get ids, states and moves are logged, guests see no private fields, deep-read storage hangs on the event id', async () => {
  _resetEv();
  _resetAlias();
  const DB = d1();
  const env = { DB };
  seed(DB, [
    item('a1', '英伟达暂停对东南亚芯片交付', 5, { score: 9.5, tickers: 'NVDA' }),
    item('a2', '英伟达暂停对东南亚芯片交付', 4, { source: 'Reuters', score: 8 }),
    item('a3', '英伟达暂停对东南亚芯片交付', 1, { source: 'BBC Business', score: 8 }),
    item('b1', '沙特阿美考虑出售管道股权', 6, { source: 'Argaam', score: 7, tickers: '2222' }),
    item('c1', null, 2, { score: 8.5, title: 'A lone big headline with no event' }),
    item('z1', null, 2, { score: 6, title: 'A small headline with no event' }),
  ]);
  const st = await boardState(env, { now: NOW });
  const t = st.run.topics;
  assert.equal(st.run.id, 0);
  assert.equal(t.length, 3);
  assert.equal(t[0].name, '英伟达暂停对东南亚芯片交付');
  assert.equal(t[0].pos, 1);
  assert.ok(t[0].rank > 0);
  assert.equal(t[0].state, 'new');
  assert.equal(t.find((x) => x.name === '沙特阿美考虑出售管道股权').market, 'Saudi');
  assert.ok(t.find((x) => x.name === 'i:c1'));
  // 再算一次：编号不变
  const st2 = await boardState(env, { now: NOW + 1000 });
  assert.equal(st2.run.topics[0].rank, t[0].rank);

  const id = t[0].rank;
  assert.equal((await evAct(env, { id, act: 'state', state: 'nope' })).ok, false);
  assert.equal((await evAct(env, { id, act: 'state', state: 'write', snap: { pos: 1 }, now: NOW })).ok, true);
  const sa = t.find((x) => x.name === '沙特阿美考虑出售管道股权').rank;
  await evAct(env, { id: sa, act: 'state', state: 'skip', note: 'weak; 太小', snap: { pos: 2 }, now: NOW });
  await evAct(env, { id, act: 'state', state: 'published', snap: { pos: 1 }, now: NOW + 5000 });
  const st3 = await boardState(env, { now: NOW + 6000 });
  const a = st3.run.topics.find((x) => x.rank === id);
  assert.equal(a.state, 'published');
  assert.equal(a.wr.same, true);
  assert.equal(st3.written.length, 1);
  assert.deepEqual(st3.calib, { days: 30, yes: 1, yes_top5: 1, yes_known: 1, no: 1, no_top5: 1, why: [['weak', 1], ['太小', 1]] });
  // 改回“决定写”：已写记录撤掉
  await evAct(env, { id, act: 'state', state: 'write', now: NOW + 7000 });
  assert.equal((await boardState(env, { now: NOW + 8000 })).written.length, 0);

  // 访客版
  const pub = boardPublic(st3);
  assert.equal(pub.guest, true);
  assert.equal(pub.run.topics.find((x) => x.rank === id).state, 'new');
  assert.equal(pub.run.topics.find((x) => x.rank === id).wr, undefined);
  assert.deepEqual(pub.written, []);

  // 事件页：时间线最新在前；管理员打开会记下“看过”
  const d = await eventDetail(env, { id, now: NOW + 9000, admin: true, ftSources: new Set(['BBC Business']) });
  assert.deepEqual(d.items.map((i) => i.id), ['a3', 'a2', 'a1']);
  assert.equal(d.items[0].ft, 'can');
  assert.equal(d.items[1].ft, 'no');
  assert.equal(d.seen, 0);
  assert.equal((await eventDetail(env, { id, now: NOW + 9500, admin: true })).seen, NOW + 9000);

  // 把一条移出这件事
  assert.equal((await evAct(env, { id, act: 'move', item: 'a2', now: NOW })).ok, true);
  assert.equal(DB.raw.prepare("SELECT story FROM items WHERE id = 'a2'").get().story, null);

  // 深读、稿件用的“选题”，以及免费贴全文（run = 0，rank = 事件编号）
  const tp = await eventTopic(env, id, NOW);
  assert.equal(tp.title_zh, '英伟达暂停对东南亚芯片交付');
  assert.deepEqual(tp.stories, ['英伟达暂停对东南亚芯片交付']);
  assert.deepEqual(tp.tickers, ['NVDA']);
  const pr = await deskPaste(env, { run: 0, rank: id, paste: { label: 'FT', text: 'x'.repeat(300) }, now: NOW });
  assert.equal(pr.ok, true);
  assert.equal((await boardState(env, { now: NOW + 10000 })).pasted[id][0].label, 'FT');
});

test('story meeting results land on events: one event gets the reason, several become one merged row', async () => {
  _resetEv();
  _resetAlias();
  const DB = d1();
  const env = { DB };
  seed(DB, [
    item('a1', 'PCE高于预期', 5, { score: 8 }),
    item('a2', 'PCE高于预期', 4, { score: 7 }),
    item('b1', 'GDP上修至4.3%', 3, { score: 7 }),
    item('b2', 'GDP上修至4.3%', 2, { score: 7 }),
    item('c1', '英伟达暂停对东南亚芯片交付', 2, { score: 9 }),
    item('d1', '黄金跌破3500美元', 2, { score: 7 }),
  ]);
  DB.raw.prepare("INSERT INTO desk_runs (id, ts, slot, n, topics) VALUES (7, ?, 'manual', 6, '[]')").run(NOW);
  const run = {
    id: 7,
    topics: [
      { rank: 1, title_zh: 'PCE超预期叠加GDP上修', title_en: 'Hot PCE and GDP', why_zh: '加息近乎定局。', ids: ['a1', 'a2', 'b1', 'b2', 'd1'], write: true, market: 'US', tickers: [] },
      { rank: 2, title_zh: '英伟达停供', title_en: 'Nvidia halt', why_zh: '供应链。', ids: ['c1'], market: 'US', tickers: ['NVDA'] },
    ],
  };
  assert.deepEqual(await applyDeskRun(env, run, { now: NOW }), { made: 1, tagged: 1 });
  const st = await boardState(env, { now: NOW });
  const g = st.run.topics.find((x) => x.kind === 'g');
  assert.equal(g.title_zh, 'PCE超预期叠加GDP上修');
  assert.equal(g.n, 4); // 黄金只用了一条，不并进来
  assert.deepEqual(g.parts.map((p) => [p.name, p.n]), [['PCE高于预期', 2], ['GDP上修至4.3%', 2]]);
  assert.equal(g.rec, 2);
  assert.equal(g.why_zh, '加息近乎定局。');
  assert.ok(!st.run.topics.some((x) => x.name === 'PCE高于预期'));
  const nv = st.run.topics.find((x) => x.name === '英伟达暂停对东南亚芯片交付');
  assert.equal(nv.rec, 1);
  assert.equal(nv.title_zh, '英伟达停供');
  assert.ok(st.run.topics.find((x) => x.name === '黄金跌破3500美元'));
  assert.equal(st.meeting.id, 7);
  // 下一场选题会没有再把这两件事放一起：没动过的合并行解散
  DB.raw.prepare("INSERT INTO desk_runs (id, ts, slot, n, topics) VALUES (8, ?, 'manual', 6, '[]')").run(NOW + H);
  await applyDeskRun(env, { id: 8, topics: [{ rank: 1, title_zh: '英伟达停供', title_en: 'Nvidia halt', ids: ['c1'], tickers: [] }] }, { now: NOW + H });
  const st2 = await boardState(env, { now: NOW + H });
  assert.ok(!st2.run.topics.some((x) => x.kind === 'g'));
  assert.ok(st2.run.topics.some((x) => x.name === 'PCE高于预期'));
  assert.equal((await evCalib(env, NOW)).yes, 0);
});

test('quotes: previous close and typical daily move from a month of closes; pre and post market', () => {
  const closes = [100, 101, 100, 102, 101, 103, 102, 104, 103, 105, 110];
  const q = tidyYahoo({ chart: { result: [{ meta: { regularMarketPrice: 110, chartPreviousClose: 90, regularMarketTime: 1795600000 }, indicators: { quote: [{ close: closes }] } }] } }, 'NVDA');
  assert.equal(q.pc, 105);
  assert.equal(q.chg, 4.76);
  assert.ok(q.typ > 0.9 && q.typ < 2.1);
  assert.ok(Math.abs(q.chg) >= q.typ * 2);
  assert.deepEqual(tidyYahooExt({ chart: { result: [{ timestamp: [10, 20, 30], indicators: { quote: [{ close: [1, 2.5, null] }] } }] } }), { p: 2.5, at: 20000 });
  assert.equal(usExtended(Date.UTC(2026, 10, 25, 12, 0)), 'pre'); // 周三纽约 7:00
  assert.equal(usExtended(Date.UTC(2026, 10, 25, 22, 0)), 'post'); // 纽约 17:00
  assert.equal(usExtended(Date.UTC(2026, 10, 25, 16, 0)), ''); // 盘中
  assert.equal(usExtended(Date.UTC(2026, 10, 28, 12, 0)), ''); // 周六
});
