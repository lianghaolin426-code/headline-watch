// D1 读取量守护：数每条查询读了多少行（meta.rows_read），按天记进 d1_reads 表；
// 快到免费额度（每天 500 万行）时自动放慢网页刷新、缓存更久、少做可有可无的后台活；
// D1 出错（比如额度用完被封）时不崩，网页用上次的缓存。
// 2026-11-24 出过一次事故：每 15 秒的轮询走了全表扫描，一天读超 500 万行，D1 被封到第二天 08:00（北京时间）。
// 以后改查询之前请先看 README 里“数据库读取量”一节。

export const DAILY_LIMIT = 5_000_000;
const SCHEMA_VERSION = 12;
// 写入额度：免费版每天 10 万行（索引的更新也算）。只统计和显示，不限流。
export const DAILY_WRITE_LIMIT = 100_000;

// 每个 Worker 实例（isolate）里的状态；实例随时可能被回收，所以只放可以丢的东西
const S = {
  pending: { web: 0, cron: 0 },
  writes: { web: 0, cron: 0 },
  queries: { web: 0, cron: 0 },
  lastFlush: 0,
  budget: null, // { at, rows }
  blockedUntil: 0,
  lastError: '',
  schemaOk: false,
  memo: new Map(), // key → { at, val }
};

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** D1 报“超出每日额度”之类的错 */
export function isQuotaError(e) {
  const m = String(e?.message || e || '');
  return /exceed|daily limit|free (plan|tier)|rows? read.*limit|limit.*rows? read|quota/i.test(m);
}

export function dbBlocked(now = Date.now()) {
  return S.blockedUntil > now;
}

/** 记一次 D1 错误；是额度错误就 10 分钟内不再碰数据库（最多到 UTC 零点重置） */
export function noteDbError(e, now = Date.now()) {
  S.lastError = String(e?.message || e).slice(0, 200);
  if (isQuotaError(e)) {
    const midnight = Math.ceil(now / 86_400_000) * 86_400_000;
    S.blockedUntil = Math.min(midnight + 60_000, now + 10 * 60_000);
  }
}

/** 包一层 env.DB：每条查询的 rows_read 记到本实例的计数里 */
export function guard(env, kind) {
  if (!env.DB || env.DB.__guarded) return env;
  const raw = env.DB;
  const add = (meta) => {
    S.pending[kind] += meta?.rows_read || 0;
    S.writes[kind] += meta?.rows_written || 0;
    S.queries[kind]++;
  };
  const wrap = (st) => ({
    __st: st,
    bind: (...a) => wrap(st.bind(...a)),
    async all() {
      try {
        const r = await st.all();
        add(r.meta);
        return r;
      } catch (e) {
        noteDbError(e);
        throw e;
      }
    },
    async run() {
      try {
        const r = await st.run();
        add(r.meta);
        return r;
      } catch (e) {
        noteDbError(e);
        throw e;
      }
    },
    async first(col) {
      const r = await this.all();
      const row = r.results?.[0] ?? null;
      return col ? (row ? row[col] ?? null : null) : row;
    },
    async raw() {
      const r = await this.all();
      return (r.results || []).map((x) => Object.values(x));
    },
  });
  const db = {
    __guarded: true,
    __raw: raw,
    prepare: (sql) => wrap(raw.prepare(sql)),
    async batch(list) {
      try {
        const r = await raw.batch(list.map((s) => s.__st || s));
        r.forEach((x) => add(x.meta));
        return r;
      } catch (e) {
        noteDbError(e);
        throw e;
      }
    },
    exec: (sql) => raw.exec(sql),
    dump: () => raw.dump?.(),
  };
  return { ...env, DB: db, __raw: raw };
}

const READS_TABLE = 'CREATE TABLE IF NOT EXISTS d1_reads (day TEXT NOT NULL, kind TEXT NOT NULL, rows INTEGER NOT NULL DEFAULT 0, queries INTEGER NOT NULL DEFAULT 0, writes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind))';

/** 把本实例攒的读取行数写进 d1_reads（cron 每轮写一次；网页请求最多每分钟写一次） */
export async function flushReads(env, { force = false, now = Date.now() } = {}) {
  const raw = env.__raw || env.DB?.__raw || env.DB;
  if (!raw || dbBlocked(now)) return;
  if (!force && now - S.lastFlush < 60_000) return;
  const kinds = Object.keys(S.pending).filter((k) => S.pending[k] || S.queries[k] || S.writes[k]);
  if (!kinds.length) return;
  S.lastFlush = now;
  const day = today(now);
  const snap = kinds.map((k) => [k, S.pending[k], S.queries[k], S.writes[k]]);
  for (const k of kinds) (S.pending[k] = 0), (S.queries[k] = 0), (S.writes[k] = 0);
  const up = (k, rows, q, w) =>
    raw
      .prepare('INSERT INTO d1_reads (day, kind, rows, queries, writes) VALUES (?, ?, ?, ?, ?) ON CONFLICT(day, kind) DO UPDATE SET rows = rows + excluded.rows, queries = queries + excluded.queries, writes = writes + excluded.writes')
      .bind(day, k, rows, q, w);
  try {
    await raw.batch(snap.map(([k, r, q, w]) => up(k, r, q, w)));
  } catch (e) {
    try {
      await raw.prepare(READS_TABLE).run();
      try {
        await raw.prepare('ALTER TABLE d1_reads ADD COLUMN writes INTEGER NOT NULL DEFAULT 0').run();
      } catch {}
      await raw.batch(snap.map(([k, r, q, w]) => up(k, r, q, w)));
    } catch (e2) {
      noteDbError(e2);
      for (const [k, r, q, w] of snap) (S.pending[k] += r), (S.queries[k] += q), (S.writes[k] += w); // 下次再记
      return;
    }
  }
  if (S.budget && S.budget.day === day) S.budget.rows += snap.reduce((s, x) => s + x[1], 0);
}

/**
 * 今天用了多少读取额度，以及该用哪一档：
 * ok（< 40%）正常；slow（40–60%）网页 1 分钟刷新一次；save（60–85%）3 分钟一次、后台少做可选的活；
 * critical（≥ 85%）10 分钟一次、后台只抓取和打分。
 */
export async function budget(env, now = Date.now()) {
  const raw = env.__raw || env.DB?.__raw || env.DB;
  const day = today(now);
  if (!S.budget || S.budget.day !== day || now - S.budget.at > 60_000) {
    let rows = S.budget?.day === day ? S.budget.rows : 0;
    if (!dbBlocked(now)) {
      try {
        const r = await raw.prepare('SELECT SUM(rows) AS r FROM d1_reads WHERE day = ?').bind(day).all();
        rows = r.results?.[0]?.r || 0;
      } catch {}
    }
    S.budget = { day, at: now, rows };
  }
  const limit = Number(env.D1_DAILY_READ_LIMIT || DAILY_LIMIT);
  const rows = S.budget.rows + S.pending.web + S.pending.cron;
  const pct = rows / limit;
  const level = dbBlocked(now) ? 'blocked' : pct >= 0.85 ? 'critical' : pct >= 0.6 ? 'save' : pct >= 0.4 ? 'slow' : 'ok';
  return { day, rows, limit, pct: Math.round(pct * 1000) / 10, level };
}

/** 各档的网页刷新间隔（秒）和缓存倍数 */
export const LEVELS = {
  ok: { poll: 30, ttl: 1 },
  slow: { poll: 60, ttl: 3 },
  save: { poll: 180, ttl: 10 },
  critical: { poll: 600, ttl: 30 },
  blocked: { poll: 600, ttl: 1e6 },
};

/**
 * 本实例内存缓存 + Cloudflare 边缘缓存（workers.dev 上边缘缓存可能不生效，内存缓存照样有用）。
 * 数据库出错时，有旧数据就返回旧数据（标上 stale），没有就抛错。
 */
export async function cached(key, ttlMs, fn, { now = Date.now() } = {}) {
  const hit = S.memo.get(key);
  if (hit && now - hit.at < ttlMs) return hit.val;
  const edgeKey = new Request('https://hw-cache.invalid/' + encodeURIComponent(key));
  const edge = typeof caches !== 'undefined' ? caches.default : null;
  if (edge && !hit) {
    try {
      const r = await edge.match(edgeKey);
      if (r) {
        const at = Number(r.headers.get('X-At')) || 0;
        const val = await r.json();
        if (now - at < ttlMs) {
          S.memo.set(key, { at, val });
          return val;
        }
        if (!S.memo.has(key)) S.memo.set(key, { at, val }); // 过期的也留着当后备
      }
    } catch {}
  }
  if (dbBlocked(now)) {
    const old = S.memo.get(key);
    if (old) return { ...old.val, stale: true };
  }
  try {
    const val = await fn();
    S.memo.set(key, { at: now, val });
    if (S.memo.size > 200) S.memo.delete(S.memo.keys().next().value);
    if (edge) {
      try {
        await edge.put(edgeKey, new Response(JSON.stringify(val), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=172800', 'X-At': String(now) } }));
      } catch {}
    }
    return val;
  } catch (e) {
    noteDbError(e);
    const old = S.memo.get(key);
    if (old) return { ...old.val, stale: true };
    throw e;
  }
}

/** 网页“状态”里显示的读取量 */
export async function readsStatus(env, now = Date.now()) {
  const b = await budget(env, now);
  let days = [];
  if (!dbBlocked(now)) {
    try {
      days = (await (env.__raw || env.DB).prepare('SELECT day, kind, rows, queries, writes FROM d1_reads ORDER BY day DESC, kind LIMIT 14').all()).results;
    } catch {
      try {
        days = (await (env.__raw || env.DB).prepare('SELECT day, kind, rows, queries FROM d1_reads ORDER BY day DESC, kind LIMIT 14').all()).results;
      } catch {}
    }
  }
  // 写入量（今天，已记账的部分；最多差一分钟）
  const writes = days.filter((d) => d.day === b.day).reduce((n, d) => n + (d.writes || 0), 0);
  return { ...b, writes, writes_limit: DAILY_WRITE_LIMIT, writes_pct: Math.round((writes / DAILY_WRITE_LIMIT) * 1000) / 10, blocked_until: S.blockedUntil || null, last_error: S.lastError || null, days };
}

/**
 * 自动建表、建索引（第一次跑新代码时做一次，之后每个实例只读一行确认版本）。
 * 建索引要把整张表读一遍（约 1–2 万行），只发生一次。
 */
export async function ensureSchema(env) {
  if (S.schemaOk) return;
  const raw = env.__raw || env.DB;
  let v = 0;
  try {
    v = Number((await raw.prepare("SELECT v FROM meta WHERE k = 'schema'").all()).results?.[0]?.v || 0);
  } catch {}
  if (v >= SCHEMA_VERSION) {
    S.schemaOk = true;
    return;
  }
  const stmts = [
    'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT, updated INTEGER)',
    READS_TABLE,
    'CREATE INDEX IF NOT EXISTS idx_items_dupof ON items (dup_of) WHERE dup_of IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_items_src_ts ON items (source, ts)',
    'CREATE INDEX IF NOT EXISTS idx_items_tr ON items (ts) WHERE title_tr IS NULL AND score >= 6',
    'CREATE INDEX IF NOT EXISTS idx_items_brief ON items (ts) WHERE score >= 5 AND dup_of IS NULL',
    'CREATE INDEX IF NOT EXISTS related_ts ON related (ts)',
    'ALTER TABLE source_state ADD COLUMN last_ids TEXT',
    // v12：攒批打分的“待评分”条目单独建部分索引。以前每分钟按 seen_at 把最近 30 分钟/3 小时的快讯扫一遍找 score_by = 'wait'（一天约 50 万行读取）
    "CREATE INDEX IF NOT EXISTS idx_items_wait ON items (seen_at) WHERE score_by = 'wait'",
    'ALTER TABLE d1_reads ADD COLUMN writes INTEGER NOT NULL DEFAULT 0',
  ];
  for (const s of stmts) {
    try {
      await raw.prepare(s).run();
    } catch (e) {
      if (!/duplicate column|already exists|no such table/i.test(String(e?.message))) {
        noteDbError(e);
        throw e;
      }
    }
  }
  await raw.prepare("INSERT INTO meta (k, v, updated) VALUES ('schema', ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated").bind(String(SCHEMA_VERSION), Date.now()).run();
  S.schemaOk = true;
}

/** meta 表的小工具：存取一段 JSON */
export async function metaGet(env, k) {
  try {
    const r = (await env.DB.prepare('SELECT v, updated FROM meta WHERE k = ?').bind(k).all()).results?.[0];
    return r ? { v: JSON.parse(r.v), updated: r.updated } : null;
  } catch {
    return null;
  }
}
export async function metaSet(env, k, v, now = Date.now()) {
  await env.DB.prepare('INSERT INTO meta (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated').bind(k, JSON.stringify(v), now).run();
}

export function _state() {
  return S;
}
