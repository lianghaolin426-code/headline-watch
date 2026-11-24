import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { groupEvents, needsWrite, briefConfig, tidyBrief, pickSources, runBriefs, listBriefs } from '../src/brief.js';
import { claudeReset } from '../src/claude.js';

// 用 node 自带的 SQLite 模拟 D1 的接口
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const prep = (sql) => {
    let args = [];
    const s = {
      bind: (...a) => ((args = a), s),
      all: async () => ({ results: db.prepare(sql).all(...args) }),
      first: async () => db.prepare(sql).get(...args) || null,
      run: async () => db.prepare(sql).run(...args),
    };
    return s;
  };
  return { prepare: prep, batch: async (l) => Promise.all(l.map((x) => x.run())), raw: db };
}

const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 24, 15, 0);
const it = (id, over) => ({ id, source: 'Reuters', title: `t ${id}`, body: '', url: `https://x/${id}`, ts: NOW - H, score: 6, confirms: 0, tickers: '', topic: '', ...over });

test('events: tickers and topics join into one group; topic "US Tariffs" equals "Tariffs"', () => {
  const evs = groupEvents([
    it('a', { tickers: 'SNY,INSM' }),
    it('b', { tickers: 'INSM' }),
    it('c', { tickers: 'SNY' }),
    it('d', { topic: 'US Tariffs' }),
    it('e', { topic: 'Tariffs' }),
    it('f', {}),
  ]);
  const by = Object.fromEntries(evs.map((e) => [e.key, e.items.map((i) => i.id).sort().join('')]));
  assert.equal(by.$SNY ?? by.$INSM, 'abc');
  assert.equal(by['#tariffs'], 'de');
  assert.equal(evs.length, 2);
});

test('when to rewrite: new event, batch of 3, urgent 9+, daily cap, quiet', () => {
  const c = briefConfig({});
  const ev = (items) => ({ key: '$NVDA', items });
  const base = [it('a', { score: 9 }), it('b'), it('c')];
  assert.equal(needsWrite(ev(base.slice(0, 2)), null, NOW, c), null); // 只有 2 条
  assert.equal(needsWrite(ev([it('a', { score: 8 }), it('b'), it('c')]), null, NOW, c), null); // 没有大消息
  assert.equal(needsWrite(ev(base), null, NOW, c), 'new');
  const row = { ids: JSON.stringify(['a', 'b', 'c']), updated: NOW - 20 * 60_000, day: '2026-11-24', day_writes: 1 };
  assert.equal(needsWrite(ev(base), row, NOW, c), null); // 没有新报道
  const more = [...base, it('d'), it('e'), it('f')];
  assert.equal(needsWrite(ev(more), row, NOW, c), null); // 3 条新的，但不到 30 分钟
  assert.equal(needsWrite(ev(more), { ...row, updated: NOW - 31 * 60_000 }, NOW, c), 'batch');
  assert.equal(needsWrite(ev([...base, it('g', { score: 9.5 })]), row, NOW, c), 'urgent');
  assert.equal(needsWrite(ev([...base, it('g')]), { ...row, updated: NOW - 4 * H }, NOW, c), 'stale');
  assert.equal(needsWrite(ev([...base, it('g', { score: 9.5 })]), { ...row, day_writes: 8 }, NOW, c), null);
  // 上一版太旧（窗口外）：当成新事件
  assert.equal(needsWrite(ev(base), { ...row, updated: NOW - 40 * H }, NOW, c), 'new');
});

test('tidy: drops unknown source numbers, takes title from 一句话', () => {
  const out = tidyBrief('好的，下面是简报：\n## 一句话\n英伟达恢复黄仁勋职务。[S1][S9]\n## 发生了什么\n董事会宣布。[S2] 没有来源的一句\n', 3);
  assert.equal(out.title, '英伟达恢复黄仁勋职务。');
  assert.ok(out.body.startsWith('## 一句话'));
  assert.ok(!out.body.includes('[S9]'));
  assert.equal(out.uncited, 0);
  assert.equal(tidyBrief('no headings', 3), null);
});

test('sources: keeps top scores when too many, in time order, articles last', () => {
  const items = Array.from({ length: 10 }, (_, k) => it('i' + k, { ts: NOW - (10 - k) * 60_000, score: k }));
  const s = pickSources(items, [{ id: 'art', source: '华尔街见闻文章', title: 'A', ts: NOW, url: 'u' }], 4);
  assert.deepEqual(s.map((x) => x.id), ['i6', 'i7', 'i8', 'i9', 'art']);
  assert.deepEqual(s.map((x) => x.n), [1, 2, 3, 4, 5]);
  assert.equal(s[4].art, true);
});

test('runBriefs writes a cited brief, marks new sources on update, respects spend cap', async () => {
  claudeReset();
  const DB = d1();
  const ins = DB.raw.prepare('INSERT INTO items (id, source, title, body, url, ts, seen_at, score, confirms, tickers, topic) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const add = (i) => ins.run(i.id, i.source, i.title, i.body, i.url, i.ts, i.ts, i.score, i.confirms, i.tickers, i.topic);
  [it('a', { score: 9.5, tickers: 'NVDA' }), it('b', { tickers: 'NVDA' }), it('c', { tickers: 'NVDA' }), it('x', { score: 9, topic: 'Oil' })].forEach(add);
  DB.raw.prepare('INSERT INTO items (id, source, title, body, url, ts, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('art', '华尔街见闻文章', '深度：黄仁勋回归', '', 'https://w/1', NOW - H, NOW - H);
  DB.raw.prepare('INSERT INTO related (flash_id, article_id, ts) VALUES (?, ?, ?)').run('a', 'art', NOW);
  let prompts = [];
  const CLAUDE_CLIENT = {
    messages: {
      create: async (req) => {
        prompts.push(req);
        return { stop_reason: 'end_turn', usage: { input_tokens: 9000, output_tokens: 2000 }, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '## 一句话\n英伟达恢复黄仁勋职务。[S1]\n## 各方观点\n- 文章：好。[S4]' }] };
      },
    },
  };
  const env = { DB, CLAUDE_CLIENT };
  const articles = new Set(['华尔街见闻文章']);
  let r = await runBriefs(env, { now: NOW, articles });
  assert.deepEqual(r.written.map((w) => w.key), ['$NVDA']); // 石油只有 1 条，不写
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].thinking.type, 'adaptive');
  assert.match(prompts[0].messages[0].content, /\[S4\] .*深度文章.*深度：黄仁勋回归/);
  let list = await listBriefs(env, { now: NOW });
  assert.equal(list.length, 1);
  assert.equal(list[0].title, '英伟达恢复黄仁勋职务。');
  assert.equal(list[0].srcs.length, 4);
  assert.ok(list[0].srcs.every((s) => !s.new));

  // 40 分钟后来了 3 条新报道：重写，新来源打上 new
  [it('d', { tickers: 'NVDA', ts: NOW }), it('e', { tickers: 'NVDA', ts: NOW }), it('f', { tickers: 'NVDA', ts: NOW })].forEach(add);
  r = await runBriefs(env, { now: NOW + 40 * 60_000, articles });
  assert.equal(r.written[0].why, 'batch');
  list = await listBriefs(env, { now: NOW + 40 * 60_000 });
  assert.deepEqual(list[0].srcs.filter((s) => s.new).map((s) => s.id), ['d', 'e', 'f']);
  assert.equal(list[0].writes, 2);

  // 花费到上限就不再写
  const capped = await runBriefs({ ...env, BRIEF_DAILY_USD: '0.001' }, { now: NOW + 90 * 60_000, articles, force: '$NVDA' });
  assert.match(capped.skipped, /上限/);
  // 用量记在 claude_usage 的 brief 一栏
  const u = DB.raw.prepare("SELECT calls FROM claude_usage WHERE kind = 'brief'").get();
  assert.equal(u.calls, 2);
});
