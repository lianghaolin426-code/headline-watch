import test from 'node:test';
import assert from 'node:assert/strict';
import { deskSlot, nextSlot, thickness, outlet, deskInput, parseDesk, tidyDossier, dossierSources, dossierText, runDesk } from '../src/desk.js';
import { claudeReset } from '../src/claude.js';

const T0 = Date.UTC(2026, 10, 25, 6, 0);
const it = (id, o = {}) => ({ id, source: 'Reuters (Bluesky)', title: 'Title ' + id, body: '', ts: T0, score: 7, ...o });

test('desk: meeting slots follow Riyadh and New York local time', () => {
  assert.deepEqual(deskSlot(Date.UTC(2026, 10, 25, 6, 35)), { slot: 'saudi', day: '2026-11-25' });
  assert.equal(deskSlot(Date.UTC(2026, 10, 25, 7, 0)), null);
  assert.deepEqual(deskSlot(Date.UTC(2026, 10, 25, 13, 30)), { slot: 'us', day: '2026-11-25' }); // EST
  assert.deepEqual(deskSlot(Date.UTC(2026, 6, 1, 12, 40)), { slot: 'us', day: '2026-07-01' }); // EDT
  assert.equal(deskSlot(Date.UTC(2026, 10, 27, 6, 35)), null); // Friday: Tadawul closed
  assert.equal(deskSlot(Date.UTC(2026, 10, 28, 13, 35)), null); // Saturday
  assert.deepEqual(nextSlot(Date.UTC(2026, 10, 25, 7, 0)), { slot: 'us', ts: Date.UTC(2026, 10, 25, 13, 30) });
});

test('desk: thickness and outlet', () => {
  assert.equal(thickness(it('a')), 'h');
  assert.equal(thickness(it('a', { body: 'Title a' })), 'h');
  assert.equal(thickness(it('a', { body: 'x'.repeat(100) })), 's');
  assert.equal(thickness(it('a', { body: 'x'.repeat(500) })), 'f');
  assert.equal(outlet('Reuters (Bluesky)'), 'Reuters');
  assert.equal(outlet('WSJ Markets'), 'WSJ');
  assert.equal(outlet('华尔街见闻文章'), '华尔街见闻');
});

test('desk: shortlist input groups by story and parse maps numbers back to items', () => {
  const rows = [it('a', { story: 'S1', score: 9 }), it('b', { story: 'S1', source: 'CNBC' }), it('c', { score: 8 }), it('d', { story: 'S2', body: 'y'.repeat(450) })];
  const inp = deskInput(rows, new Set(), 100);
  assert.equal(inp.list.length, 4);
  assert.match(inp.text, /## 事件：S1（共 2 条，2 家媒体/);
  assert.equal(inp.list[0].id, 'a');
  const out = parseDesk('```json\n' + JSON.stringify({ topics: [
    { title_zh: '甲', title_en: 'A', why_zh: '原因', why_en: 'why', angle_en: 'angle', market: 'Saudi', tickers: ['2222', 'x y'], items: [1, 2, 99, 1], write: true },
    { title_zh: '乙', items: [3], write: true },
    { title_zh: '丙', items: [4], write: true },
    { title_zh: '空', items: [] },
  ] }) + '\n```', inp.list);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0].ids, ['a', 'b']);
  assert.equal(out[0].outlets, 2);
  assert.deepEqual(out[0].basis, { f: 0, s: 0, h: 2 });
  assert.deepEqual(out[0].tickers, ['2222', 'XY']);
  assert.equal(out[0].market, 'Saudi');
  assert.deepEqual(out[1].basis, { f: 1, s: 0, h: 0 });
  assert.deepEqual(out.map((t) => t.write), [true, true, false]); // at most two
  assert.equal(parseDesk('sorry', inp.list), null);
});

test('desk: dossier tidy drops unknown citations and counts uncited lines', () => {
  const srcs = dossierSources([it('a'), it('b', { body: 'z'.repeat(500), ts: T0 - 1000 })], [], 40);
  assert.deepEqual(srcs.map((s) => [s.id, s.k]), [['b', 'f'], ['a', 'h']]);
  assert.match(dossierText(srcs, [{ label: 'FT', text: 'full text' }]), /\[P1\] 主编贴进来的全文 \| 〔正文〕 \| FT/);
  const out = tidyDossier('前言\n## 一句话\n发生了一件事。[S1]\n## 为什么重要\n事实。[S2][S9]\n推断：有关系。\n没有来源的一句。\n## 进展到哪一步\n- 11-25 14:00 节点 [P1][P2]\n## 还不知道什么\n- 缺口\n## 可以怎么写\n- Angle: x', 2, 1);
  assert.equal(out.title, '发生了一件事。');
  assert.ok(!out.body.includes('[S9]') && !out.body.includes('[P2]') && out.body.includes('[P1]'));
  assert.equal(out.uncited, 1);
  assert.equal(tidyDossier('no sections', 2, 0), null);
});

test('desk: runDesk asks the stronger model and stores the shortlist', async () => {
  claudeReset();
  const calls = [];
  const sql = [];
  const rows = Array.from({ length: 6 }, (_, k) => it('i' + k, { story: 'S' + (k % 3) }));
  const env = {
    CLAUDE_CLIENT: { messages: { create: async (req) => (calls.push(req), { stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 500 }, content: [{ type: 'text', text: JSON.stringify({ topics: [{ title_zh: '甲', title_en: 'A', why_zh: 'w', items: [1, 2], write: true }] }) }] }) } },
    DB: { prepare: (q) => ({ q, bind(...a) { this.a = a; return this; }, async all() { sql.push(q); return { results: /FROM items/.test(q) ? rows : [] }; }, async run() { sql.push(q); return { meta: { last_row_id: 7 } }; } }) },
  };
  const r = await runDesk(env, { now: T0, slot: 'saudi' });
  assert.equal(r.ok, true);
  assert.equal(r.run.id, 7);
  assert.equal(r.run.topics[0].n, 2);
  assert.equal(calls[0].model, 'claude-sonnet-5-5');
  assert.deepEqual(calls[0].thinking, { type: 'adaptive' });
  // 1000 in / 500 out on Sonnet 5.5 = $0.002 + $0.005
  assert.equal(r.run.usd, 0.007);
  assert.ok(sql.some((q) => /INSERT INTO desk_runs/.test(q)));
});
