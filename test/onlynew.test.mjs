// 只补新内容的源（富途）：和别的源已有的对上就删掉，不算多源确认；太新的先不入库
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec('ALTER TABLE source_state ADD COLUMN last_ids TEXT');
  db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT, updated INTEGER)');
  const prep = (sql) => {
    let args = [];
    const s = {
      bind: (...a) => ((args = a), s),
      all: async () => ({ results: db.prepare(sql).all(...args), meta: {} }),
      first: async () => db.prepare(sql).get(...args) || null,
      run: async () => {
        if (/RETURNING/i.test(sql)) return { results: db.prepare(sql).all(...args), meta: {} };
        db.prepare(sql).run(...args);
        return { results: [], meta: {} };
      },
    };
    return s;
  };
  return { prepare: prep, batch: async (l) => Promise.all(l.map((x) => x.run())), raw: db };
}

const T = Date.UTC(2026, 10, 25, 3, 0);
const futuJson = (list) => JSON.stringify({ code: 0, data: { code: '0', data: { hasMore: true, news: list.map(([id, content, ts]) => ({ id, title: '', content, time: String(ts / 1000), detailUrl: `https://news.futunn.com/flash/${id}/x` })) } } });
const glhJson = (list) => JSON.stringify({ result: list.map(([id, content, ts]) => ({ id, content, createTimestamp: ts / 1000 })) });

test('onlyNew source: matches are deleted, unique items kept, too-new items held back, no confirmation boost', async () => {
  const { runOnce } = await import('../src/index.js');
  const db = d1();
  const sources = [
    { type: 'cnjson', format: 'gelonghui', name: '格隆汇', url: 'https://glh.test/' },
    { type: 'cnjson', format: 'futu', name: '富途', onlyNew: true, honestUa: true, url: 'https://futu.test/' },
  ];
  const env = { DB: db, SOURCES: JSON.stringify(sources), AI_SCORING: 'false', TRANSLATE: 'false', BRIEFS: 'false', CROSS_LANGUAGE: 'false' };
  let glh = [['g1', '格隆汇11月25日｜泰国商务部：泰国与美国将努力敲定贸易协议。', T - 30 * 60_000]];
  let futu = [
    ['f1', '泰国商务部：泰国与美国将努力敲定贸易协议。', T - 31 * 60_000],
    ['f2', '杰富瑞：将迪尔股份(DE.N)目标价从560美元上调至610美元。', T - 20 * 60_000],
    ['f3', '德意志银行：将哔哩哔哩(BILI.O)目标价从32.00美元下调至20.00美元。', T - 60_000], // 太新，先不收
  ];
  const uas = {};
  globalThis.fetch = async (url, init) => {
    uas[new URL(url).host] = init.headers['User-Agent'];
    return new Response(String(url).includes('futu') ? futuJson(futu) : glhJson(glh), { status: 200 });
  };
  await runOnce(env, { now: T, notify: false });
  const ids = () => db.raw.prepare('SELECT id FROM items ORDER BY id').all().map((r) => r.id);
  assert.deepEqual(ids(), ['futu:f2', 'gelonghui:g1']);
  assert.match(uas['futu.test'], /^HeadlineWatch/);
  assert.match(uas['glh.test'], /Mozilla/);
  const g = db.raw.prepare("SELECT confirms FROM items WHERE id = 'gelonghui:g1'").get();
  assert.ok(!g.confirms, 'a relay copy must not count as confirmation');
  // 6 分钟后 f3 够“老”了，入库；之前删掉的 f1 不会再插回来
  await runOnce(env, { now: T + 6 * 60_000, notify: false });
  assert.deepEqual(ids(), ['futu:f2', 'futu:f3', 'gelonghui:g1']);
  const st = JSON.parse(db.raw.prepare("SELECT v FROM meta WHERE k = 'onlynew'").get().v);
  const day = st.days['2026-11-25']['富途'];
  assert.deepEqual(day, { seen: 3, dropped: 1, kept: 2 });
  assert.equal(st.samples[0].as, '格隆汇');
});

test('onlyNew source with Claude: AI decides same fact; same speaker saying something else is kept', async () => {
  const { runOnce } = await import('../src/index.js');
  const { claudeReset } = await import('../src/claude.js');
  claudeReset();
  const db = d1();
  db.raw.exec('CREATE TABLE IF NOT EXISTS claude_usage (day TEXT NOT NULL, kind TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind))');
  const sources = [
    { type: 'cnjson', format: 'gelonghui', name: '格隆汇', url: 'https://glh.test/' },
    { type: 'cnjson', format: 'futu', name: '富途', onlyNew: true, url: 'https://futu.test/' },
  ];
  const asked = [];
  const CLAUDE_CLIENT = {
    messages: {
      create: async (req) => {
        const u = req.messages[0].content;
        if (!/already covered/.test(req.system[0].text)) return { stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: '[]' }] };
        asked.push(u);
        // 假 Claude：只有“谈判内容一致”那条算同一事实
        const items = u.split(/\n\n/).map((b) => b.split('\n')[0]);
        const ans = Object.fromEntries(items.map((t, i) => [i + 1, /一致/.test(t) ? 'a' : 0]));
        return { stop_reason: 'end_turn', usage: { input_tokens: 300, output_tokens: 10 }, content: [{ type: 'text', text: JSON.stringify(ans) }] };
      },
    },
  };
  const env = { DB: db, SOURCES: JSON.stringify(sources), AI_SCORING: 'false', TRANSLATE: 'false', BRIEFS: 'false', CROSS_LANGUAGE: 'false', CLAUDE_CLIENT };
  const glh = [['g1', '格隆汇11月26日｜泰国商务部：美国拟对泰国商品征收至高18%的关税，这与此前的谈判内容一致。', T - 40 * 60_000]];
  let futu = [];
  globalThis.fetch = async (url) => new Response(String(url).includes('futu') ? futuJson(futu) : glhJson(glh), { status: 200 });
  await runOnce(env, { now: T, notify: false });
  futu = [
    ['f1', '泰国商务部：美国拟对泰国商品征收至高18%的关税，这与此前的谈判内容一致。', T - 20 * 60_000],
    ['f2', '泰国商务部长：力争将美国关税税率谈判至18%以下。', T - 20 * 60_000],
    ['f3', '杰富瑞：将迪尔股份(DE.N)目标价从560美元上调至610美元。', T - 20 * 60_000],
  ];
  await runOnce(env, { now: T + 60_000, notify: false });
  const ids = db.raw.prepare('SELECT id FROM items ORDER BY id').all().map((r) => r.id);
  assert.deepEqual(ids, ['futu:f2', 'futu:f3', 'gelonghui:g1']);
  assert.equal(asked.length, 1);
  assert.ok(!/迪尔/.test(asked[0]), 'items with no candidate are not sent to Claude');
  const st = JSON.parse(db.raw.prepare("SELECT v FROM meta WHERE k = 'onlynew'").get().v);
  assert.equal(st.samples[0].by, 'ai');
  assert.equal(db.raw.prepare("SELECT calls FROM claude_usage WHERE kind = 'dedup'").get().calls, 1);
});

test('Futu articles: skips sources we already fetch, keeps the original outlet in the body', async () => {
  const { parseCnJson } = await import('../src/cnfeeds.js');
  const json = JSON.stringify({ code: 0, data: { seqMark: 'x', hasMore: true, list: [
    { newsId: '1', title: '“大空头”Burry转多\n', timestamp: '1795641600', source: '华尔街见闻', url: 'https://news.futunn.com/post/1/a', abstract: '' },
    { newsId: '2', title: 'SpaceX被曝下调Blackwell GPU租金最高约35%', timestamp: '1795641000', source: '财联社', url: 'https://news.futunn.com/post/2/b', abstract: '' },
    { newsId: '3', title: '美股收盘：道指翻红', timestamp: '1795640000', source: '快讯', url: 'https://news.futunn.com/post/3/c', abstract: '' },
  ] } });
  const items = parseCnJson(json, '富途文章', 'futuArticle');
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'futuArticle:2');
  assert.equal(items[0].body, '来源：财联社');
  assert.equal(items[0].url, 'https://news.futunn.com/post/2/b');
  assert.equal(items[0].ts, 1795641000000);
});
