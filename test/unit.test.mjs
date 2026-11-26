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
  assert.deepEqual(r.tags[0], { dir: -1, tickers: 'NVDA', topic: 'Nvidia', sector: 'tech', story: '', kind: '', who: '', hook: 0 });
  assert.equal(r.tags[1], null);
  assert.deepEqual(r.tags[2], { dir: 1, tickers: '', topic: 'Fed', sector: 'macro', story: '', kind: '', who: '', hook: 0 });
  assert.equal(r.tags[3].tickers, 'TSLA,2222');
  assert.equal(r.tags[3].sector, 'energy');
  // 旧格式仍然能用
  assert.deepEqual(parseTagged('[{"i":0,"s":9},{"i":1,"s":3}]', 2).scores, [9, 3]);
  assert.deepEqual(parseTagged('[{"i":0,"s":9,"d":1,"k":["AAPL"],"t":"Apple","c":"tech"}]', 1).tags[0], { dir: 1, tickers: 'AAPL', topic: 'Apple', sector: 'tech', story: '', kind: '', who: '', hook: 0 });
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

  let out = await aiScores({ CLAUDE_CLIENT: client(() => reply('[[0,"Fed unexpect",10,1,"","Fed","macro"],[1,"Analyst rais",2]]')), AI: workers }, items, { tags: true });
  assert.deepEqual([...out], [10, 2]);
  assert.equal(out.provider, 'claude');
  assert.equal(out.tags[0].topic, 'Fed');
  assert.deepEqual(out.usage, { prompt: 700, completion: 40 });
  assert.equal(sent[0].model, 'claude-haiku-5-5');
  assert.equal(sent[0].temperature, undefined);
  assert.equal(sent[0].system[0].cache_control.type, 'ephemeral');
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
  out = await aiScores({ CLAUDE_CLIENT: client(() => (called++, reply('[[0,"Fed unexpect",9],[1,"Analyst rais",1]]'))), AI: workers, AI_PROVIDER: 'workers' }, items);
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
    content: [{ type: 'text', text: /Simplified Chinese/.test(req.system[0].text) ? '[{"i":0,"t":"美联储意外降息","b":""}]' : '[{"i":0,"t":"Fed unexpectedly cuts rates","b":""}]' }],
  }) } };
  const fetcher = async () => ({ status: 200, json: async () => ({ responseStatus: 200, responseData: { translatedText: '英伟达股价暴跌8%' } }) });
  const n = await translatePending({ DB, CLAUDE_CLIENT: client }, { provider: 'claude', fallback: 'mymemory', fetcher });
  assert.equal(n, 3);
  assert.deepEqual(saved.map((a) => [a[3], a[0], a[2]]).sort(), [['a', '美联储意外降息', 'zh'], ['b', '英伟达股价暴跌8%', 'zh'], ['c', 'Fed unexpectedly cuts rates', 'en']]);
  assert.equal(usage.length, 2);
  assert.equal(usage[0][1], 'translate');
});

test('echoed rows: swapped numbers are put back, unknown rows dropped', async () => {
  const { parseEchoed } = await import('../src/score.js');
  const titles = ['Tool Changer. Now Standard. Bambu Lab Launches the P3C', '世卫：美国报告3例感染禽流感病例 1人死亡', 'Mosaic to sell Louisiana ammonia plant', 'OK'];
  // 模型把 0 和 1 的编号写反了
  const out = parseEchoed('[[1,"Tool Changer",1],[0,"世卫：美国报告3例感染禽流",6,-1,"","Bird flu","health"],[2,"Something el",9,1,"MOS","Mosaic","industrial"],[3,"OK",3]]', titles);
  // 第三行开头抄错但编号位置空着：按编号认；"OK" 这种极短标题也按编号认
  assert.deepEqual(out.scores, [1, 6, 9, 3]);
  assert.equal(out.tags[1].topic, 'Bird flu');
  assert.equal(out.tags[0], null);
  assert.equal(out.fixed, 2);
  assert.equal(out.dropped, 0);
  // 两条标题一样：各归各的编号；多出来的一行丢掉
  const dup = parseEchoed('[[0,"JPMorgan say",5,0,"","SOFR","macro"],[1,"JPMorgan say",5,0,"","SOFR","macro"],[1,"JPMorgan say",9]]', ['JPMorgan says SOFR mispriced', 'JPMorgan says SOFR mispriced']);
  assert.deepEqual(dup.scores, [5, 5]);
  assert.equal(dup.dropped, 1);
  assert.equal(parseEchoed('no json', titles), null);
});

test('embed code is stripped from summaries', async () => {
  const { htmlToText } = await import('../src/parse.js');
  assert.equal(htmlToText('<p>Tariffs rise</p><script>var a = 1;</script> new TradingView.chart({width:"100%",container_id:"desc_{{newsid}}"});'), 'Tariffs rise');
  const { buildList } = await import('../src/translate.js');
  assert.equal(buildList([{ title: 'FinancialJuice: US prepares tariffs', body: 'new TradingView.chart({a:1});' }]), '0.\nT: US prepares tariffs');
});

test('claudeRelate maps the numbers Claude returns back to candidate flashes', async () => {
  const { claudeRelate } = await import('../src/index.js');
  const { claudeReset } = await import('../src/claude.js');
  claudeReset();
  let prompt = '';
  const env = {
    CLAUDE_CLIENT: { messages: { create: async (req) => { prompt = req.messages[0].content; const pick = /Flashes:/.test(prompt); return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 3 }, content: [{ type: 'text', text: pick ? '{"subject": "英伟达 (Nvidia)", "ids": [2, 9, 2, 3]}' : 'Nvidia reinstates Huang as CEO' }] }; } } },
  };
  const cands = [{ id: 'a', title: 'Fed holds rates' }, { id: 'b', title: 'Nvidia reinstates Jensen Huang as CEO' }, { id: 'c', title: 'Sanofi strikes $41bn deal' }];
  const hit = await claudeRelate(env, { title: '黄仁勋回归引爆美股', body: '' }, cands);
  assert.deepEqual(hit.map((f) => f.id), ['b']);
  assert.match(prompt, /2\. Nvidia reinstates/);
});

test('topics: "English|中文" is kept, split for the API, and merged onto known topics', async () => {
  const { parseEchoed, splitTopic, canonTopic } = await import('../src/score.js');
  const r = parseEchoed('[[0,"Nvidia short",9,-1,"NVDA","Nvidia|英伟达","tech"],[1,"Fed cuts rat",8,1,"","Fed","macro"],[2,"Odd one here",6,0,"","Oil|Crude","energy"]]', ['Nvidia short sellers', 'Fed cuts rates', 'Odd one here']);
  assert.equal(r.tags[0].topic, 'Nvidia|英伟达');
  assert.equal(r.tags[1].topic, 'Fed');
  assert.equal(r.tags[2].topic, 'Oil'); // 第二段不是中文就不要
  assert.deepEqual(splitTopic({ topic: 'Nvidia|英伟达' }), { topic: 'Nvidia', topic_zh: '英伟达' });
  assert.deepEqual(splitTopic({ topic: 'Fed' }), { topic: 'Fed' });
  const known = ['Nvidia|英伟达', 'Nasdaq|纳指', 'Dell'];
  assert.equal(canonTopic('nvidia', known), 'Nvidia|英伟达');
  assert.equal(canonTopic('Nasdaq 100|纳指', known), 'Nasdaq|纳指');
  assert.equal(canonTopic('Dell|戴尔', known), 'Dell|戴尔');
  assert.equal(canonTopic('Copper|铜', known), 'Copper|铜');
});

test('stories: scoring files each headline under a specific event', async () => {
  const { aiScores, parseEchoed, resolveStory } = await import('../src/score.js');
  const { claudeReset } = await import('../src/claude.js');
  claudeReset();
  // 编号换成已有事件的名字；新名字整理后保留；只差标点的并到已有的；不是一件事的留空
  const known = ['黄仁勋复任英伟达CEO', '特朗普提议政府入股英伟达'];
  assert.equal(resolveStory('S2', known), known[1]);
  assert.equal(resolveStory('s1', known), known[0]);
  assert.equal(resolveStory('S7', known), '');
  assert.equal(resolveStory('“黄仁勋 复任英伟达CEO”。', known), known[0]);
  assert.equal(resolveStory('赛诺菲收购Insmed', known), '赛诺菲收购Insmed');
  assert.equal(resolveStory('', known), '');
  assert.equal(resolveStory('none', known), '');
  const r = parseEchoed('[[0,"Trump floats",8,1,"NVDA","Nvidia|英伟达","tech","S2"],[1,"Analyst rais",2]]', ['Trump floats US stake in Nvidia', 'Analyst raises target']);
  assert.equal(r.tags[0].story, 'S2');

  const sent = [];
  const client = { messages: { create: async (req) => (sent.push(req), { stop_reason: 'end_turn', content: [{ type: 'text', text: '[[0,"Trump floats",8,1,"NVDA","Nvidia|英伟达","tech","S2"],[1,"Sanofi to bu",9,1,"SNY","Sanofi|赛诺菲","health","赛诺菲收购Insmed"],[2,"Analyst rais",2]]' }], usage: { input_tokens: 900, output_tokens: 60 } }) } };
  const items = [{ source: 'A', title: 'Trump floats US stake in Nvidia' }, { source: 'B', title: 'Sanofi to buy Insmed for $41 billion' }, { source: 'C', title: 'Analyst raises target' }];
  const out = await aiScores({ CLAUDE_CLIENT: client }, items, { tags: true, topics: ['Nvidia|英伟达'], stories: known });
  assert.match(sent[0].messages[0].content, /^Known topics: Nvidia\|英伟达\nOpen stories: S1 黄仁勋复任英伟达CEO; S2 特朗普提议政府入股英伟达\n\n0\. \[A\]/);
  assert.equal(out.tags[0].story, known[1]);
  assert.equal(out.tags[1].story, '赛诺菲收购Insmed');
  assert.equal(out.tags[2], null);
  // 后备模型不分事件
  const w = await aiScores({ AI: { run: async () => ({ response: '[[0,8,1,"NVDA","Nvidia","tech"],[1,2],[2,2]]' }) } }, items, { tags: true, stories: known });
  assert.equal(w.tags[0].story, '');
});

test('stories: near-identical names join the existing story', async () => {
  const { sameStory, resolveStory } = await import('../src/score.js');
  const known = ['厦门航空拟购50架波音飞机', '黄仁勋复任英伟达CEO', '特朗普提议政府入股英伟达'];
  assert.equal(sameStory('厦门航空拟购50架波音飞机，价值74亿美元', known), known[0]);
  assert.equal(resolveStory('厦门航空拟购50架波音飞机，价值74亿美元', known), known[0]);
  assert.equal(sameStory('特朗普提议美国政府入股英伟达', known), known[2]);
  assert.equal(sameStory('黄仁勋重返英伟达任CEO', known), '');
  assert.equal(sameStory('特朗普称可赦免黄仁勋', known), '');
  assert.equal(sameStory('美国拟加征多国关税', known), '');
});

test('score: pick score is read from the new row shapes only', async () => {
  const { parseEchoed } = await import('../src/score.js');
  const titles = ['Goldman sees four Fed hikes next year', 'Oil tanker ablaze in Hormuz strait', 'Old format row about earnings'];
  const raw = JSON.stringify([
    [1, 'Goldman sees', 2, 8, 0, '', 'Fed', '', 'Fed path', 'v', 'Goldman Sachs|高盛'],
    [2, 'Oil tanker ab', 9, 7],
    [3, 'Old format ro', 5, 1, 'AAPL', 'Earnings', 'tech'],
  ]);
  const r = parseEchoed(raw, titles);
  assert.deepEqual(r.picks, [8, 7, null]);
  assert.equal(r.tags[0].kind, 'v');
  assert.equal(r.tags[0].who, 'Goldman Sachs|高盛');
});

test('feeds: article list page is parsed into items with summary and time', async () => {
  const { parseHtmlList } = await import('../src/cnfeeds.js');
  const now = Date.UTC(2026, 10, 25, 12, 0);
  const html = `<div><a href="/content/detail/1234567.html"><img src="x.jpg"></a><a href="/content/detail/1234567.html">高盛：预计美联储明年加息四次，上调美债收益率预测</a>
    <p>高盛首席经济学家在最新报告中表示，通胀回落的速度慢于预期，美联储明年可能加息四次。</p><span>2026-11-25 19:30</span></div>
    <div><a href="/content/detail/1234568.html">德银将标普 500 目标价上调至 9000 点</a><span>12分钟前</span></div><a href="/about.html">关于我们的一些说明文字</a>`;
  const src = { type: 'htmllist', format: 'zhitong', name: '智通财经', link: '/content/detail/(\\d+)\\.html', url: 'https://www.zhitongcaijing.com/content/meigu.html' };
  const items = parseHtmlList(html, src, now);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'zhitong:1234567');
  assert.equal(items[0].url, 'https://www.zhitongcaijing.com/content/detail/1234567.html');
  assert.match(items[0].title, /^高盛/);
  assert.match(items[0].body, /通胀回落/);
  assert.equal(items[0].ts, Date.UTC(2026, 10, 25, 11, 30));
  assert.equal(items[1].ts, now - 12 * 60000);
});

test('fulltext: robots rules, page text extraction, refusals', async () => {
  const { parseRobots, robotsAllows, htmlText, fetchFullText } = await import('../src/fulltext.js');
  const rules = parseRobots('User-agent: *\nDisallow: /api/\nAllow: /api/public\nDisallow: /*.pdf$\n\nUser-agent: badbot\nDisallow: /');
  assert.equal(robotsAllows(rules, '/p/123'), true);
  assert.equal(robotsAllows(rules, '/api/x'), false);
  assert.equal(robotsAllows(rules, '/api/public/x'), true);
  assert.equal(robotsAllows(rules, '/a.pdf'), false);
  const body = '<p>' + '第一段。'.repeat(100) + '</p><p>第二段 &amp; 更多。</p><p>第三段。</p>';
  assert.match(htmlText(`<html><nav><p>菜单</p></nav><article>${body}</article><script>x()</script></html>`), /^第一段。.*\n第二段 & 更多。\n第三段。$/s);
  const page = (status, html) => async (u) => (String(u).endsWith('/robots.txt') ? new Response('User-agent: *\nDisallow: /private/', { status: 200 }) : new Response(html, { status }));
  assert.equal((await fetchFullText({ id: 'x:1', url: 'https://a.example/p/1' }, { fetcher: page(200, `<article>${body}</article>`) })).ok, true);
  assert.equal((await fetchFullText({ id: 'x:2', url: 'https://b.example/p/1' }, { fetcher: page(403, 'no') })).error, 'refused');
  assert.equal((await fetchFullText({ id: 'x:3', url: 'https://c.example/private/1' }, { fetcher: page(200, body) })).error, 'robots');
});

test('events: story list, merge plan, alias chain', async () => {
  const { storyList, parseGroups, planMerges, plausible, resolveAlias, listText } = await import('../src/events.js');
  const t = Date.UTC(2026, 10, 26, 8, 0);
  const rows = [
    { story: '白宫新关税计划致股市走低', title: 'Stocks slide as White House unveils new tariff plan', ts: t, score: 7, topic: 'Tariffs|关税', tickers: '' },
    { story: '白宫新关税计划致股市走低', title: '白宫公布新关税计划，美股走低', ts: t + 1000, score: 6, topic: 'Tariffs|关税', tickers: '' },
    { story: '日本就美国拟对其进口加征15%关税提出抗议', title: 'Japan protests planned 15% US tariff', ts: t + 2000, score: 6, topic: 'Tariffs|关税', tickers: '' },
    { story: '英伟达暂停对东南亚芯片交付', title: 'Nvidia halts chip deliveries to Southeast Asia', ts: t + 3000, score: 10, topic: 'Nvidia|英伟达', tickers: 'NVDA' },
    { story: '北欧大西洋航空可能申请破产', title: 'Norse Atlantic may file for bankruptcy', ts: t + 4000, score: 9, topic: 'Norse Atlantic', tickers: '' },
  ];
  const list = storyList(rows);
  assert.equal(list.length, 4);
  assert.equal(list.find((s) => s.name.startsWith('白宫')).n, 2);
  assert.match(listText(list), /^1\. 北欧大西洋航空可能申请破产 \| Norse Atlantic \| - \| 1 \| 11-26 16:00 \| Norse/);
  const idx = (p) => list.findIndex((s) => s.name.startsWith(p)) + 1;
  // 模型的回答：关税两件并成一件；另把英伟达和航空公司乱并（没有共同之处，应被拦下）
  const groups = parseGroups(`ok {"groups": [[${idx('白宫')}, ${idx('日本')}], [${idx('英伟达')}, ${idx('北欧')}], [99, 1]]}`, list.length);
  assert.equal(groups.length, 2);
  const plan = planMerges(list, groups);
  assert.deepEqual(plan, [{ canon: '白宫新关税计划致股市走低', aliases: ['日本就美国拟对其进口加征15%关税提出抗议'] }]);
  assert.equal(plausible(list[idx('英伟达') - 1], list[idx('北欧') - 1]), false);
  assert.equal(parseGroups('nothing', 3), null);
  assert.equal(resolveAlias('a', { a: { to: 'b' }, b: { to: 'c' } }), 'c');
  assert.equal(resolveAlias('x', {}), 'x');
});
