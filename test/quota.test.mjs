// 额度相关的行为：源没变化时不重复写 source_state、一直失败的源降频、向量缓存、简报版本号、待评分部分索引
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// node 自带 SQLite 模拟 D1：带 RETURNING 的语句返回行，并统计每条语句读了多少行（用 EXPLAIN 不方便，这里只数返回行）
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec('ALTER TABLE source_state ADD COLUMN last_ids TEXT');
  const log = [];
  const prep = (sql) => {
    let args = [];
    const s = {
      bind: (...a) => ((args = a), s),
      all: async () => {
        log.push(sql);
        return { results: db.prepare(sql).all(...args), meta: {} };
      },
      first: async () => db.prepare(sql).get(...args) || null,
      run: async () => {
        log.push(sql);
        if (/RETURNING/i.test(sql)) return { results: db.prepare(sql).all(...args), meta: {} };
        db.prepare(sql).run(...args);
        return { results: [], meta: {} };
      },
    };
    return s;
  };
  return { prepare: prep, batch: async (l) => Promise.all(l.map((x) => x.run())), raw: db, log };
}

const rss = (ids) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${ids
    .map((i) => `<item><title>Headline number ${i} about markets</title><link>https://ex.com/${i}</link><guid>${i}</guid><pubDate>Sun, 22 Nov 2026 21:00:00 GMT</pubDate></item>`)
    .join('')}</channel></rss>`;

function envWith(db, sources) {
  return { DB: db, SOURCES: JSON.stringify(sources), AI_SCORING: 'false', TRANSLATE: 'false', BRIEFS: 'false', CROSS_LANGUAGE: 'false' };
}

test('source_state is written only when the feed changed, or every 10 minutes', async () => {
  const { runOnce } = await import('../src/index.js');
  const db = d1();
  let feed = ['a', 'b'];
  globalThis.fetch = async () => new Response(rss(feed), { status: 200 });
  const env = envWith(db, [{ type: 'rss', name: 'Feed', url: 'https://feed.test/rss' }]);
  const T = Date.UTC(2026, 10, 25, 1, 1);
  const writes = () => db.log.filter((s) => /INSERT INTO source_state/.test(s)).length;
  await runOnce(env, { now: T, notify: false });
  assert.equal(writes(), 1);
  await runOnce(env, { now: T + 60_000, notify: false }); // 一模一样
  await runOnce(env, { now: T + 120_000, notify: false });
  assert.equal(writes(), 1);
  feed = ['c', 'a', 'b']; // 有新条目
  const r = await runOnce(env, { now: T + 180_000, notify: false });
  assert.equal(r.inserted, 1);
  assert.equal(writes(), 2);
  await runOnce(env, { now: T + 180_000 + 11 * 60_000, notify: false }); // 没变化，但已过 10 分钟
  assert.equal(writes(), 3);
  const st = db.raw.prepare('SELECT * FROM source_state').get();
  assert.equal(st.last_ok, T + 180_000 + 11 * 60_000);
});

test('a source failing for over 30 minutes is retried every 10 minutes, and the same error is not rewritten', async () => {
  const { runOnce } = await import('../src/index.js');
  const db = d1();
  let calls = 0;
  globalThis.fetch = async () => (calls++, new Response('no', { status: 403 }));
  const env = envWith(db, [{ type: 'rss', name: 'Bad', url: 'https://bad.test/rss' }]);
  const T = Date.UTC(2026, 10, 25, 2, 0); // 分钟数是 10 的倍数
  globalThis.fetch = async () => new Response(rss(['y']), { status: 200 });
  await runOnce(env, { now: T - 60_000, notify: false }); // 先成功一次
  globalThis.fetch = async () => (calls++, new Response('no', { status: 403 }));
  const writes = () => db.log.filter((s) => /INSERT INTO source_state/.test(s)).length;
  await runOnce(env, { now: T, notify: false });
  await runOnce(env, { now: T + 60_000, notify: false });
  assert.equal(calls, 2);
  assert.equal(writes(), 2); // 成功一次 + 第一次报错；同样的错误不重复写
  calls = 0;
  for (let m = 31; m <= 40; m++) await runOnce(env, { now: T + m * 60_000, notify: false });
  assert.equal(calls, 1); // 只在第 40 分钟试了一次
  globalThis.fetch = async () => new Response(rss(['z']), { status: 200 });
  await runOnce(env, { now: T + 50 * 60_000, notify: false });
  calls = 0;
  globalThis.fetch = async () => (calls++, new Response(rss(['z']), { status: 200 }));
  await runOnce(env, { now: T + 51 * 60_000, notify: false });
  assert.equal(calls, 1); // 恢复后回到每分钟
});

test('vector cache: later reads only fetch new rows and still return the full window', async () => {
  const { recentVecs, _vecCache } = await import('../src/index.js');
  const V = _vecCache();
  V.rows.clear();
  V.from = Infinity;
  V.max = 0;
  const db = d1();
  const T = Date.UTC(2026, 10, 25, 3, 0);
  const put = (id, ts) => db.raw.prepare('INSERT INTO vecs (id, ts, zh, v) VALUES (?, ?, 0, ?)').run(id, ts, new Uint8Array([1, 2, 3]));
  put('old', T - 3 * 3_600_000);
  put('a', T - 60 * 60_000);
  put('b', T - 30 * 60_000);
  const env = { DB: db };
  let rows = await recentVecs(env, T - 2 * 3_600_000, T);
  assert.deepEqual(rows.map((r) => r.id).sort(), ['a', 'b']);
  put('c', T + 30_000);
  const before = db.log.length;
  rows = await recentVecs(env, T + 60_000 - 2 * 3_600_000, T + 60_000);
  assert.deepEqual(rows.map((r) => r.id).sort(), ['a', 'b', 'c']);
  const q = db.log.slice(before);
  assert.equal(q.length, 1);
  // 6 小时窗口超出了缓存覆盖范围：整段重读
  rows = await recentVecs(env, T - 6 * 3_600_000, T + 120_000);
  assert.deepEqual(rows.map((r) => r.id).sort(), ['a', 'b', 'c', 'old']);
});

test('briefs endpoint answers "same" when the client already has this version', async () => {
  const worker = (await import('../src/index.js')).default;
  const db = d1();
  db.raw.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT, updated INTEGER)');
  const now = Date.now();
  db.raw.prepare('INSERT INTO briefs (key, title, body, srcs, ids, n, created, updated, writes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)').run('$NVDA', 't', 'b', '[]', '[]', 3, now, now);
  const env = { DB: db };
  const get = async (q) => (await worker.fetch(new Request('https://x.test/api/briefs' + q), env, {})).json();
  const a = await get('');
  assert.equal(a.briefs.length, 1);
  assert.ok(a.v);
  const b = await get('?v=' + encodeURIComponent(a.v));
  assert.equal(b.same, 1);
  assert.equal(b.briefs, undefined);
});

test('waiting-for-score lookups can use the partial index', async () => {
  const { ensureSchema } = await import('../src/dbguard.js');
  const db = d1();
  await ensureSchema({ DB: db });
  const plan = (sql) => db.raw.prepare('EXPLAIN QUERY PLAN ' + sql).all(1, 2).map((r) => r.detail).join(' ');
  assert.match(plan("SELECT id FROM items WHERE score_by = 'wait' AND seen_at > ? ORDER BY seen_at LIMIT ?"), /idx_items_wait/);
  assert.match(plan("UPDATE items SET score_by = NULL WHERE seen_at > ? AND seen_at <= ? AND score_by = 'wait'"), /idx_items_wait/);
});
