import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTelegram, parseFeed } from '../src/parse.js';
import { matchItem, parseKeywords } from '../src/filter.js';

const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

test('telegram: parses text posts, skips media-only, strips signature', () => {
  const items = parseTelegram(fx('tg.html'), 'WalterBloomberg');
  assert.equal(items.length, 2);
  const [a, b] = items;
  assert.equal(a.id, 'tg:walterbloomberg/38878');
  assert.equal(a.title, 'NVIDIA SHORT SELLERS REAP $24 BILLION AS STOCK EXTENDS SLIDE: S3 & CO');
  assert.equal(a.body, '');
  assert.equal(a.url, 'https://t.me/WalterBloomberg/38878');
  assert.equal(a.ts, Date.parse('2026-11-22T21:40:00Z'));
  assert.match(b.title, /^GOLDMAN WARNS/);
  assert.match(b.body, /Nvidia: -48%/);
  assert.doesNotMatch(b.body, /@WalterBloomberg/);
});

test('rss: entities, CDATA, odd date format, escaped html description', () => {
  const items = parseFeed(fx('feed.xml'), 'Investing.com');
  assert.equal(items.length, 2);
  assert.equal(items[0].title, `Fed's Waller says "no rush" on cuts`);
  assert.equal(items[0].ts, Date.parse('2026-11-15T13:05:31Z'));
  assert.equal(items[0].url, 'https://www.investing.com/news/a-123');
  assert.equal(items[1].title, 'Apple to buy back $110 billion of stock');
  assert.equal(items[1].body, 'Record buyback');
  assert.equal(items[1].id, 'rss:Investing.com:b-1');
});

test('atom: link href and Chinese text', () => {
  const [e] = parseFeed(fx('atom.xml'), 'cn');
  assert.equal(e.url, 'https://example.cn/1');
  assert.equal(e.ts, Date.parse('2026-11-17T13:22:05Z'));
});

test('filter: keywords and big numbers', () => {
  const rules = { keywords: parseKeywords('short sellers，英伟达'), bigNumbers: true };
  assert.deepEqual(matchItem({ title: 'NVIDIA SHORT SELLERS REAP $24 BILLION' }, rules), ['short sellers', '$24 BILLION']);
  assert.deepEqual(matchItem({ title: '英伟达市值蒸发超2万亿美元' }, rules), ['英伟达', '2万亿美元']);
  assert.deepEqual(matchItem({ title: 'Traders sold 57 billion in equities' }, rules), ['57 billion']);
  assert.deepEqual(matchItem({ title: 'Musk says Ukraine violated Starlink terms' }, rules), []);
  assert.deepEqual(matchItem({ title: 'Stock rises $5' }, rules), []);
  assert.deepEqual(matchItem({ title: 'X' }, { keywords: [], bigNumbers: false }), []);
});

import { maxAmountBillions } from '../src/filter.js';
import { parseScores, routinePenalty } from '../src/score.js';

test('amount extraction in billions', () => {
  assert.equal(maxAmountBillions('NVIDIA SHORT SELLERS REAP $24 BILLION'), 24);
  assert.equal(maxAmountBillions('CrowdStrike to buy Zscaler in $44 billion deal; $1.2bn fee'), 44);
  assert.equal(maxAmountBillions('Market value fell $2 trillion'), 2000);
  assert.equal(maxAmountBillions('英伟达市值蒸发超2万亿美元，空头浮盈240亿美元'), 200);
  assert.equal(maxAmountBillions('Stock rises 5% to $120'), 0);
  assert.equal(maxAmountBillions('Pfizer 3b trial'), 0);
});

test('AI score parsing is robust', () => {
  assert.deepEqual(parseScores('Sure: [{"i":0,"s":9},{"i":1,"s":3}]', 3), [9, 3, null]);
  assert.deepEqual(parseScores([{ i: 1, s: 12 }], 2), [null, 10]);
  assert.equal(parseScores('no json here', 2), null);
  assert.equal(routinePenalty('Morgan Stanley raises Apple price target'), -2);
  assert.equal(routinePenalty('Nvidia CEO ousted'), 0);
});

test('AI positional score array', () => {
  assert.deepEqual(parseScores('[7, 2, 9]', 3), [7, 2, 9]);
  assert.deepEqual(parseScores('Scores: [8,3]', 3), [8, 3, null]);
});

test('rss without title uses description (Bluesky)', () => {
  const xml = '<rss><channel><item><link>https://bsky.app/x/1</link><description>BREAKING: Something big happened\nmore text</description><pubDate>Mon, 23 Nov 2026 10:00:00 +0000</pubDate><guid>at://1</guid></item></channel></rss>';
  const [it] = parseFeed(xml, 'bsky');
  assert.equal(it.title, 'BREAKING: Something big happened');
});

import { sameStory } from '../src/similar.js';

test('same story detection across sources', () => {
  assert.equal(sameStory('Jensen Huang reinstated as Nvidia CEO. Stock skyrockets 31%', 'BREAKING: $NVDA reinstates Jensen Huang as President and CEO'), true);
  assert.equal(sameStory('CrowdStrike to buy Zscaler in $44 billion deal as AI supercharges cyberattacks', 'FinancialJuice: CROWDSTRIKE AGREES TO ACQUIRE ZSCALER FOR $44 BILLION'), true);
  assert.equal(sameStory('Nvidia short sellers reap US$24 billion as stock extends slide', 'NVIDIA SHORT SELLERS REAP $24 BILLION AS STOCK EXTENDS SLIDE: S3'), true);
  assert.equal(sameStory('Jensen Huang reinstated as Nvidia CEO', 'Asian chip stocks soar tracking Nvidia rally; S.Korea, Taiwan lead'), false);
  assert.equal(sameStory('Gold rises amid risk-on sentiment', 'Fed official says rates likely higher'), false);
});

test('idf weighting stops a hot topic from matching unrelated follow-ups', async () => {
  const { tokens, sameStory, idfWeights } = await import('../src/similar.js');
  const titles = [
    'Jensen Huang reinstated as Nvidia CEO, stock jumps 31%',
    'Nvidia reinstates Jensen Huang as CEO, shares jump 31%',
    'Six key questions raised by Jensen Huang return to Nvidia',
    'How important are Nvidia and Jensen Huang to the economy',
    'What Jensen Huang return means for Nvidia CFO Kress',
    'Nvidia Jensen Huang cheered by employees after return',
  ];
  const T = titles.map(tokens);
  const W = idfWeights(T);
  assert.ok(sameStory(T[0], T[1], W));
  assert.ok(!sameStory(T[2], T[3], W));
});

test('Chinese flash JSON (wallstreetcn / cls shapes)', async () => {
  const { parseCnJson } = await import('../src/cnfeeds.js');
  const w = parseCnJson(JSON.stringify({ data: { items: [{ id: 1, title: '', content_text: '【SpaceX和特斯拉委派董事负责合并谈判】据FT报道……', display_time: 1795490000 }] } }), '华尔街见闻', 'wscn');
  assert.equal(w[0].title, 'SpaceX和特斯拉委派董事负责合并谈判');
  assert.equal(w[0].ts, 1795490000000);
  const c = parseCnJson(JSON.stringify({ data: { roll_data: [{ id: 9, title: '美股三大指数集体高开', content: '……', ctime: 1795490001 }] } }), '财联社电报', 'cls');
  assert.equal(c[0].title, '美股三大指数集体高开');
  assert.equal(c[0].url, 'https://www.cls.cn/detail/9');
});

test('int8 vector packing keeps cosine', async () => {
  const { pack, unpack, cos } = await import('../src/embed.js');
  const a = pack([1, 2, 3]), b = pack([1, 2, 3.1]), c = pack([-3, 0, 1]);
  assert.ok(cos(a, b) > 0.99);
  assert.ok(cos(a, c) < 0.1);
  assert.ok(Math.abs(cos(unpack(Array.from(new Uint8Array(a.buffer))), b) - cos(a, b)) < 1e-9);
});

test('translation helpers', async () => {
  const { targetLang, buildList, parseTranslations } = await import('../src/translate.js');
  assert.equal(targetLang('Fed cuts rates'), 'zh');
  assert.equal(targetLang('美联储降息'), 'en');
  const list = buildList([{ title: 'Fed cuts rates reut.rs/abc https://x.co/1', body: 'Fed cuts rates' }, { title: 'A buys B', body: 'The deal values B at $5 billion.' }]);
  assert.ok(!list.includes('https://'));
  assert.equal(list.split('B: ').length, 2); // 重复标题的摘要不翻
  const out = parseTranslations('here: [{"i":1,"t":"A 收购 B","b":"交易对 B 估值 50 亿美元。"},{"i":7,"t":"x"}]', 2);
  assert.equal(out[0], null);
  assert.deepEqual(out[1], { t: 'A 收购 B', b: '交易对 B 估值 50 亿美元。' });
  assert.equal(parseTranslations('sorry', 2), null);
});

test('mymemory helpers', async () => {
  const { clipBytes, readMyMemory, myMemoryTranslate } = await import('../src/translate.js');
  assert.equal(clipBytes('abc', 10), 'abc');
  assert.ok(new TextEncoder().encode(clipBytes('美联储'.repeat(200), 480)).length <= 480);
  assert.equal(readMyMemory({ responseStatus: 200, responseData: { translatedText: '美联储加息' } }, 'zh'), '美联储加息');
  assert.equal(readMyMemory({ responseStatus: 200, responseData: { translatedText: 'Fed hikes' } }, 'zh'), null);
  assert.equal(readMyMemory({ responseStatus: '429', responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' } }, 'en'), false);
  let seen;
  const fetcher = async (u) => { seen = u; return { status: 200, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'Fed raises rates' } }) }; };
  assert.equal(await myMemoryTranslate({ MYMEMORY_EMAIL: 'a@b.c' }, '美联储加息', 'en', fetcher), 'Fed raises rates');
  assert.equal(seen.searchParams.get('langpair'), 'zh-CN|en');
  assert.equal(seen.searchParams.get('de'), 'a@b.c');
});

test('tagged score replies', async () => {
  const { parseTagged } = await import('../src/score.js');
  const r = parseTagged('[[0,9,-1,"NVDA","Nvidia","tech"],[1,2],[2,6,1,"","Fed","macro"],[3,8,1,"$tsla, 2222.SR, not a ticker","Aramco","Energy"]]', 5);
  assert.deepEqual(r.scores, [9, 2, 6, 8, null]);
  assert.deepEqual(r.tags[0], { dir: -1, tickers: 'NVDA', topic: 'Nvidia', sector: 'tech' });
  assert.equal(r.tags[1], null);
  assert.deepEqual(r.tags[2], { dir: 1, tickers: '', topic: 'Fed', sector: 'macro' });
  assert.equal(r.tags[3].tickers, 'TSLA,2222');
  assert.equal(r.tags[3].sector, 'energy');
  // 旧格式仍然能用
  assert.deepEqual(parseTagged('[{"i":0,"s":9},{"i":1,"s":3}]', 2).scores, [9, 3]);
  assert.deepEqual(parseTagged('[{"i":0,"s":9,"d":1,"k":["AAPL"],"t":"Apple","c":"tech"}]', 1).tags[0], { dir: 1, tickers: 'AAPL', topic: 'Apple', sector: 'tech' });
  assert.deepEqual(parseTagged('[7, 2]', 2).scores, [7, 2]);
  assert.equal(parseTagged('nope', 2), null);
});

test('wallstreetcn information-flow: keep articles only, unwrap resource', async () => {
  const { parseCnJson } = await import('../src/cnfeeds.js');
  const body = { code: 20000, data: { items: [
    { resource_type: 'live', resource: { id: 1, title: '快讯', display_time: 1795515646 } },
    { resource_type: 'ad', resource: { id: 2, kind: 'banner' } },
    { resource_type: 'article', resource: { id: 3, title: '华尔街看黄仁勋回归：卖方狂欢，买方困惑', display_time: 1795515000, uri: 'https://wallstreetcn.com/articles/3' } },
  ] } };
  const out = parseCnJson(JSON.stringify(body), '华尔街见闻文章', 'wscnArticle');
  assert.equal(out.length, 1);
  assert.equal(out[0].title, '华尔街看黄仁勋回归：卖方狂欢，买方困惑');
  assert.equal(out[0].url, 'https://wallstreetcn.com/articles/3');
});

test('relate links in-depth articles to the earliest flash of the same story', async () => {
  const { relate } = await import('../src/index.js');
  const rows = [
    { id: 'wscn:1', source: '华尔街见闻', title: '英伟达宣布黄仁勋回归担任CEO 股价盘前大涨', dup_of: null },
    { id: 'gl:2', source: '格隆汇', title: '黄仁勋回归英伟达担任CEO 英伟达盘前大涨', dup_of: 'wscn:1' },
    { id: 'wscn:3', source: '华尔街见闻', title: '美联储维持利率不变 鲍威尔称通胀仍偏高', dup_of: null },
  ];
  const written = [];
  const stmt = (sql) => ({
    sql,
    args: [],
    bind(...a) { this.args = a; return this; },
    async all() { return { results: sql.includes('FROM items') ? rows : [] }; },
  });
  const env = { DB: { prepare: stmt, async batch(list) { written.push(...list.map((s) => s.args)); } } };
  const cfg = { articles: new Set(['华尔街见闻文章']), relHours: 12, xlangOn: false, relSameVec: false, relSameMin: 0.8, xlangMin: 0.65 };
  const art = { id: 'wscnArticle:9', source: '华尔街见闻文章', title: '黄仁勋回归英伟达CEO引爆美股，英伟达盘前大涨，华尔街怎么看' };
  const n = await relate(env, cfg, { arts: [art], now: Date.now() });
  assert.ok(n >= 1);
  const heads = written.map((a) => a[0]);
  assert.ok(heads.includes('wscn:1'));
  assert.ok(!heads.includes('gl:2'), 'duplicates are stored under their story head');
  assert.ok(!heads.includes('wscn:3'));
});

test('Claude is the first choice for scoring, Workers AI the fallback', async () => {
  const { aiScores } = await import('../src/score.js');
  const { claudeReset, claudeUp, claudeUsd } = await import('../src/claude.js');
  claudeReset();
  const sent = [];
  const reply = (text, stop = 'end_turn') => ({ stop_reason: stop, content: [{ type: 'text', text }], usage: { input_tokens: 700, output_tokens: 40 } });
  const client = (fn) => ({ messages: { create: async (req) => (sent.push(req), fn(req)) } });
  const items = [{ source: 'Reuters', title: 'Fed unexpectedly cuts rates by 50bp' }, { source: 'X', title: 'Analyst raises price target' }];
  const workers = { run: async () => ({ response: '[[0,7],[1,3]]', usage: { prompt_tokens: 5, completion_tokens: 6 } }) };

  let out = await aiScores({ CLAUDE_CLIENT: client(() => reply('[[0,10,1,"","Fed","macro"],[1,2]]')), AI: workers }, items, { tags: true });
  assert.deepEqual([...out], [10, 2]);
  assert.equal(out.provider, 'claude');
  assert.equal(out.tags[0].topic, 'Fed');
  assert.deepEqual(out.usage, { prompt: 700, completion: 40 });
  assert.equal(sent[0].model, 'claude-haiku-5-5');
  assert.equal(sent[0].temperature, undefined);
  assert.match(sent[0].messages[0].content, /^0\. \[Reuters\]/);

  // 拒答、回复不合法、接口报错：都退回 Workers AI
  for (const fn of [() => reply('', 'refusal'), () => reply('sorry'), () => { throw Object.assign(new Error('boom'), { status: 500 }); }]) {
    out = await aiScores({ CLAUDE_CLIENT: client(fn), AI: workers }, items, { tags: true });
    assert.deepEqual([...out], [7, 3]);
    assert.equal(out.provider, 'workers');
  }
  // 没有 Workers AI 时返回 null（调用方用规则）
  assert.equal(await aiScores({ CLAUDE_CLIENT: client(() => reply('nope')) }, items), null);
  // AI_PROVIDER="workers" 可以关掉 Claude
  let called = 0;
  out = await aiScores({ CLAUDE_CLIENT: client(() => (called++, reply('[[0,9],[1,1]]'))), AI: workers, AI_PROVIDER: 'workers' }, items);
  assert.equal(called, 0);
  assert.equal(out.provider, 'workers');

  // 密钥失效：停用一段时间，期间不再请求
  const bad = { CLAUDE_CLIENT: client(() => { called++; throw Object.assign(new Error('invalid x-api-key'), { status: 401 }); }), AI: workers };
  called = 0;
  await aiScores(bad, items);
  await aiScores(bad, items);
  assert.equal(called, 1);
  assert.equal(claudeUp(bad), false);
  claudeReset();
  assert.equal(claudeUsd(1_000_000, 1_000_000), 0.6);
});

test('Claude translation saves what it can and hands the rest to the fallback', async () => {
  const { translatePending } = await import('../src/translate.js');
  const { claudeReset } = await import('../src/claude.js');
  claudeReset();
  const rows = [
    { id: 'a', title: 'Fed unexpectedly cuts rates', body: '', score: 9 },
    { id: 'b', title: 'Nvidia shares plunge 8%', body: '', score: 8 },
    { id: 'c', title: '美联储意外降息', body: '', score: 8 },
  ];
  const saved = [];
  const usage = [];
  const stmt = (sql) => ({
    args: [],
    bind(...a) { this.args = a; return this; },
    async all() { return { results: rows }; },
    async run() { if (/claude_usage/.test(sql)) usage.push(this.args); else saved.push(this.args); },
  });
  const DB = { prepare: stmt, async batch(list) { saved.push(...list.map((s) => s.args)); } };
  const client = { messages: { create: async (req) => ({
    stop_reason: 'end_turn',
    usage: { input_tokens: 300, output_tokens: 50 },
    // 英译中那批漏掉第二条；中译英那批正常
    content: [{ type: 'text', text: /Simplified Chinese/.test(req.system) ? '[{"i":0,"t":"美联储意外降息","b":""}]' : '[{"i":0,"t":"Fed unexpectedly cuts rates","b":""}]' }],
  }) } };
  const fetcher = async () => ({ status: 200, json: async () => ({ responseStatus: 200, responseData: { translatedText: '英伟达股价暴跌8%' } }) });
  const n = await translatePending({ DB, CLAUDE_CLIENT: client }, { provider: 'claude', fallback: 'mymemory', fetcher });
  assert.equal(n, 3);
  assert.deepEqual(saved.map((a) => [a[3], a[0], a[2]]).sort(), [['a', '美联储意外降息', 'zh'], ['b', '英伟达股价暴跌8%', 'zh'], ['c', 'Fed unexpectedly cuts rates', 'en']]);
  assert.equal(usage.length, 2);
  assert.equal(usage[0][1], 'translate');
});
