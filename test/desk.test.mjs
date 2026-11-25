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

test('desk: opinion leads get their own section and reach the topic card with facts', () => {
  const rows = [
    it('a', { story: 'Fed path', score: 9, pick: 9 }),
    it('v', { story: 'Fed path', score: 2, pick: 8, kind: 'v', who: 'Goldman Sachs|高盛', title: 'Goldman sees four hikes' }),
    it('w', { score: 3, pick: 7, kind: 'v', who: 'Deutsche Bank|德银', title: 'DB lifts S&P target to 9000' }),
  ];
  const inp = deskInput(rows, new Set(), 50);
  assert.equal(inp.views, 2);
  assert.match(inp.text, /观点线索/);
  const nv = inp.list.findIndex((i) => i.id === 'v') + 1;
  const na = inp.list.findIndex((i) => i.id === 'a') + 1;
  const topics = parseDesk(JSON.stringify({ topics: [{ title_zh: '美联储路径', title_en: 'Fed path', why_zh: '原因', angle_en: 'x', market: 'US', items: [na, nv], facts: [['高盛预计加息四次', nv], ['编号不存在', 99]], write: true }] }), inp.list);
  assert.equal(topics.length, 1);
  assert.deepEqual(topics[0].facts.map((f) => f.id), ['v']);
  assert.deepEqual(topics[0].views.map((x) => [x.id, x.who]), [['v', 'Goldman Sachs|高盛']]);
});

test('desk: topic status, written match, mood, draft parsing and quotes', async () => {
  const { topicStatus, matchWritten, deskMood, parseDraft, tidyQuote, deskSlot: slot2 } = await import('../src/desk.js');
  const Hh = 3600000;
  const now = T0;
  const topics = [
    { rank: 1, ids: ['a', 'b', 'c', 'd'], stories: ['S1'], tsl: [now - Hh, now - 2 * Hh, now - 3 * Hh, now - 4 * Hh, now - 20 * Hh] },
    { rank: 2, ids: ['x'], stories: ['S9'], tsl: [now - Hh] },
    { rank: 3, ids: ['m', 'n', 'o'], stories: ['S3'], tsl: [now - 10 * Hh, now - 12 * Hh, now - 14 * Hh] },
  ];
  const prev = [{ id: 5, ts: now - 12 * Hh, topics: [{ rank: 2, ids: ['zz'], stories: ['S1'] }, { rank: 4, ids: ['m'], stories: [] }] }];
  topicStatus(topics, prev, now);
  assert.deepEqual(topics.map((t) => t.st), ['up', 'new', 'down']);
  assert.equal(topics[0].was, 2);
  assert.equal(topics[0].since, now - 12 * Hh);
  const written = [
    { id: 3, ts: now - 5 * Hh, title: 'Old piece', run_id: 2, rank: 1, ids: '["zz"]', stories: '["S1"]', off: 0 },
    { id: 2, ts: now - 6 * Hh, title: 'Off board', run_id: null, rank: null, ids: null, stories: null, off: 1 },
  ];
  assert.deepEqual(matchWritten(topics[0], 9, written), { id: 3, ts: now - 5 * Hh, title: 'Old piece', same: false, fresh: 4 });
  assert.equal(matchWritten(topics[1], 9, written), null);
  assert.equal(matchWritten({ rank: 1, ids: [], stories: [], tsl: [] }, 2, written).same, true);
  const rows = [
    ...[1, 1, 1, -1, -1].map((dir, k) => ({ id: 'n' + k, dir, score: 7, title: 't' })),
    { id: 'v1', kind: 'v', dir: -1, who: 'Goldman Sachs|高盛', pick: 8, title: 'Four hikes', score: 2 },
  ];
  const mood = deskMood(rows, { lean: -40 });
  assert.deepEqual(mood.news, { up: 3, down: 2, n: 5 });
  assert.equal(mood.lean, 20);
  assert.equal(mood.delta, 60);
  assert.equal(mood.vlean, null);
  assert.equal(mood.bears[0].who, 'Goldman Sachs|高盛');
  const d = parseDraft('## FORMAT\nFive numbers\n## HEADLINES\n**One two three four**\n2. Two\n- Three\nFour\nFive\nSix\n## SUMMARY\nSum.\n## ARTICLE\n## What happened\n' + 'word '.repeat(100) + '\n## Next\nmore\n## CARDS\n[{"type":"numbers","title":"T","items":[{"n":"7%","label":"a"},{"n":"3","label":"b"}]},{"type":"nope"}]\n## CHECK\n- 核对一');
  assert.deepEqual(d.heads, ['One two three four', 'Two', 'Three', 'Four', 'Five']);
  assert.match(d.body, /^## What happened/);
  assert.match(d.body, /more$/);
  assert.equal(d.cards.length, 1);
  assert.deepEqual(d.checks, ['核对一']);
  assert.equal(parseDraft('nothing useful'), null);
  assert.deepEqual(tidyQuote({ ticker: 'spy', tngoLast: 99, prevClose: 100 }), { t: 'SPY', p: 99, pc: 100, chg: -1, at: undefined });
  assert.equal(tidyQuote({ ticker: 'X', tngoLast: null, prevClose: 0 }), null);
  // after-close meeting only when switched on
  const close = Date.UTC(2026, 10, 25, 21, 35); // 16:35 New York
  assert.equal(slot2(close), null);
  assert.deepEqual(slot2(close, true), { slot: 'close', day: '2026-11-25' });
});

test('desk: public view hides unpublished work; lint catches invented quotes; one shared story is not the same topic', async () => {
  const { deskPublic, draftLint, sameTopic, deskMood } = await import('../src/desk.js');
  const st = { run: { id: 1, topics: [{ rank: 1, title_zh: 't', wr: { id: 1, title: 'x' } }] }, picks: { 1: { verdict: 'pass', ts: 1, note: 'thin' } }, dossiers: { 1: { body: 'b' } }, drafts: { 1: { body: 'd' } }, written: [{ id: 1 }], follow: { 1: { id: 1, yes: true } } };
  const pub = deskPublic(st);
  assert.deepEqual(pub.picks, { 1: { verdict: 'pass', ts: 1 } });
  assert.deepEqual([pub.dossiers, pub.drafts, pub.written, pub.follow], [{}, {}, [], {}]);
  assert.equal(pub.run.topics[0].wr, undefined);
  assert.equal(st.run.topics[0].wr.id, 1); // the full state is untouched
  const out = { heads: ['A "dead-cat bounce" call'], summary: '', body: 'He described a "sell first, ask questions later" mood. The materials do not include the close.', cards: [] };
  const warn = draftLint(out, 'Klement called it a dead-cat bounce. 先卖再说');
  assert.equal(warn.length, 2);
  assert.match(warn[0], /sell first, ask questions later/);
  assert.match(warn[1], /materials do not include/i);
  assert.equal(sameTopic({ ids: ['a', 'b', 'c'], stories: ['Huang', 'AI selloff', 'Chips'] }, { ids: ['x', 'y', 'z'], stories: ['Huang', 'Pardon', 'Export rules'] }), false);
  assert.equal(sameTopic({ ids: ['a', 'b', 'c'], stories: ['S1'] }, { ids: ['a', 'b', 'q'], stories: [] }), true);
  assert.equal(sameTopic({ ids: ['a'], stories: ['S1'] }, { ids: ['z'], stories: ['S1', 'S2'] }), true);
  // eighteen bearish headlines on one story count once
  const rows = Array.from({ length: 18 }, (_, k) => ({ id: 'b' + k, story: 'Selloff', dir: -1, score: 8 })).concat([1, 2, 3, 4].map((k) => ({ id: 'u' + k, story: 'Up' + k, dir: 1, score: 7 })));
  assert.deepEqual(deskMood(rows, null).news, { up: 4, down: 1, n: 5 });
});

test('desk: eye-catching items reach the meeting and the topic card', () => {
  const rows = [
    it('a', { story: 'Nvidia', score: 8, pick: 8 }),
    it('h', { score: 3, pick: 3, hook: 3, title: 'Nvidia to pour $50 billion into one startup' }),
    it('n', { score: 6 }),
  ];
  const inp = deskInput(rows, new Set(), 1); // even when the cap leaves no room for storyless items
  assert.match(inp.text, /吸睛资讯/);
  const nh = inp.list.findIndex((i) => i.id === 'h') + 1;
  const na = inp.list.findIndex((i) => i.id === 'a') + 1;
  assert.ok(nh > 0 && na > 0);
  const topics = parseDesk(JSON.stringify({ topics: [{ title_zh: '英伟达', title_en: 'Nvidia', why_zh: 'x', market: 'US', items: [na], hooks: [['500 亿的大数字', nh], ['不是吸睛条目', na]] }] }), inp.list);
  assert.deepEqual(topics[0].hooks.map((h) => h.id), ['h']);
  assert.match(topics[0].hooks[0].title, /\$50 billion/);
});
