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
