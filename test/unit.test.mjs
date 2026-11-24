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
