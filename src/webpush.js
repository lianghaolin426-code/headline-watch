// 网页推送（Web Push）：浏览器自带的通知标准，不需要第三方 App。
// 浏览器订阅后给我们一个“推送地址”（Chrome 是谷歌的 FCM，Safari 是苹果的 APNs），
// 我们把加密后的消息 POST 过去，由它们送到电脑/手机上弹出系统通知。
//
// 用到两份标准：RFC 8292（VAPID，证明消息是本站发的）和 RFC 8291（消息内容加密，aes128gcm）。
// 全部用 Worker 自带的 WebCrypto 实现，不依赖 Node 的 crypto。
//
// VAPID 密钥：优先用 Worker 密钥 VAPID_PUBLIC_KEY / VAPID_PRIVATE_JWK；没配时第一次用到会自动生成，存进 D1 的 push_keys 表。
// 订阅：D1 的 push_subs 表，每个浏览器一行，带各自的门槛、免打扰时段和时区。

const enc = new TextEncoder();

export function b64u(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(s) {
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

/** RFC 8291：把明文加密成 aes128gcm 消息体 */
export async function encryptPayload(plaintext, p256dh, auth, { salt = crypto.getRandomValues(new Uint8Array(16)), localKeys = null } = {}) {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  const local = localKeys || (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const data = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  const padded = concat(data, new Uint8Array([2])); // 0x02 = 最后一段
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, padded));

  const rs = new Uint8Array([0, 0, 16, 0]); // 记录大小 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

// ---------- VAPID 密钥 ----------

let keyCache = null;

let tablesReady = false;
async function ensureTables(db) {
  if (tablesReady) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS push_keys (id INTEGER PRIMARY KEY, public_key TEXT NOT NULL, private_jwk TEXT NOT NULL, created INTEGER NOT NULL)'),
    db.prepare(
      'CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, min_score REAL NOT NULL DEFAULT 9, mode TEXT NOT NULL DEFAULT \'score\', quiet_from INTEGER, quiet_to INTEGER, tz TEXT, origin TEXT, ua TEXT, created INTEGER NOT NULL, last_ok INTEGER, fails INTEGER NOT NULL DEFAULT 0, last_error TEXT)'
    ),
  ]);
  try {
    await db.prepare('ALTER TABLE push_subs ADD COLUMN sticky INTEGER NOT NULL DEFAULT 0').run(); // 后加的列：通知停留在屏幕上直到手动关掉
  } catch {
    // 已经有这一列
  }
  tablesReady = true;
}

export async function vapidKeys(env) {
  if (keyCache) return keyCache;
  let pub = env.VAPID_PUBLIC_KEY;
  let jwk = env.VAPID_PRIVATE_JWK;
  if (!pub || !jwk) {
    await ensureTables(env.DB);
    let row = await env.DB.prepare('SELECT public_key, private_jwk FROM push_keys WHERE id = 1').first();
    if (!row) {
      const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const p = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
      const j = JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey));
      await env.DB.prepare('INSERT OR IGNORE INTO push_keys (id, public_key, private_jwk, created) VALUES (1, ?, ?, ?)').bind(p, j, Date.now()).run();
      row = await env.DB.prepare('SELECT public_key, private_jwk FROM push_keys WHERE id = 1').first(); // 并发时以先写入的为准
    }
    pub = row.public_key;
    jwk = row.private_jwk;
  }
  const privateKey = await crypto.subtle.importKey('jwk', JSON.parse(jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  keyCache = { publicKey: pub, privateKey };
  return keyCache;
}

async function vapidHeader(endpoint, keys, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

/** 发一条推送；返回 { ok, status, gone } */
export async function sendPush(env, sub, payload, { ttl = 1800, urgency = 'high', topic } = {}) {
  const keys = await vapidKeys(env);
  const body = await encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth);
  let subject = env.PUSH_SUBJECT;
  if (!subject) {
    try {
      subject = new URL(sub.origin).origin; // VAPID 要求 https 网址或 mailto，用看板的网址
    } catch {
      subject = 'https://headline-watch.workers.dev';
    }
  }
  const headers = {
    Authorization: await vapidHeader(sub.endpoint, keys, subject),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: urgency,
  };
  if (topic) headers.Topic = topic;
  const r = await fetch(sub.endpoint, { method: 'POST', headers, body });
  let text = '';
  if (!r.ok) text = (await r.text().catch(() => '')).slice(0, 200);
  return { ok: r.ok, status: r.status, gone: r.status === 404 || r.status === 410, error: r.ok ? null : `HTTP ${r.status} ${text}`.trim() };
}

// ---------- 订阅管理 ----------

const MODES = new Set(['score', 'confirmed']);

function cleanSub(body) {
  const s = body?.subscription || {};
  const endpoint = String(s.endpoint || '');
  const p256dh = String(s.keys?.p256dh || '');
  const auth = String(s.keys?.auth || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || p256dh.length < 80 || p256dh.length > 120 || auth.length < 16 || auth.length > 40) return null;
  const min = Number(body.min);
  const hour = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(23, Math.floor(Number(v)))));
  let tz = String(body.tz || '').slice(0, 60);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC' });
  } catch {
    tz = '';
  }
  return {
    endpoint,
    p256dh,
    auth,
    min: [8, 8.5, 9, 9.5, 10].includes(min) ? min : 9,
    mode: MODES.has(body.mode) ? body.mode : 'score',
    quietFrom: hour(body.quietFrom),
    quietTo: hour(body.quietTo),
    tz: tz || null,
    sticky: body.sticky ? 1 : 0,
  };
}

export async function saveSubscription(env, body, { origin, ua }) {
  const s = cleanSub(body);
  if (!s) return { ok: false, error: 'bad subscription' };
  await ensureTables(env.DB);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subs').first();
  const exists = await env.DB.prepare('SELECT 1 FROM push_subs WHERE endpoint = ?').bind(s.endpoint).first();
  if (!exists && (n?.n || 0) >= 50) return { ok: false, error: 'too many subscriptions' };
  await env.DB.prepare(
    `INSERT INTO push_subs (endpoint, p256dh, auth, min_score, mode, quiet_from, quiet_to, tz, origin, ua, created, fails, sticky)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, min_score = excluded.min_score, mode = excluded.mode,
       quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to, tz = excluded.tz, origin = excluded.origin, ua = excluded.ua, sticky = excluded.sticky, fails = 0, last_error = NULL`
  )
    .bind(s.endpoint, s.p256dh, s.auth, s.min, s.mode, s.quietFrom, s.quietTo, s.tz, origin, String(ua || '').slice(0, 200), Date.now(), s.sticky)
    .run();
  return { ok: true };
}

export async function removeSubscription(env, endpoint) {
  await ensureTables(env.DB);
  await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(String(endpoint || '')).run();
  return { ok: true };
}

export async function getSubscription(env, endpoint) {
  await ensureTables(env.DB);
  return env.DB.prepare('SELECT * FROM push_subs WHERE endpoint = ?').bind(String(endpoint || '')).first();
}

export async function listSubscriptions(env) {
  try {
    const { results } = await env.DB.prepare('SELECT * FROM push_subs').all();
    return results || [];
  } catch {
    return []; // 表还没建：还没人订阅
  }
}

/** 这个时刻在订阅者的时区里是不是免打扰时段 */
export function inQuiet(sub, now = Date.now()) {
  const a = sub.quiet_from;
  const b = sub.quiet_to;
  if (a === null || a === undefined || b === null || b === undefined || a === b) return false;
  let h;
  try {
    h = Number(new Intl.DateTimeFormat('en-US', { timeZone: sub.tz || 'UTC', hour: 'numeric', hourCycle: 'h23' }).format(new Date(now)));
  } catch {
    h = new Date(now).getUTCHours();
  }
  return a < b ? h >= a && h < b : h >= a || h < b; // 跨午夜，如 23 点到 7 点
}

export function wants(sub, it) {
  const score = Number(it.score) || 0;
  if (sub.mode === 'confirmed') return score >= 9 || (score >= 8 && (it.confirms || 0) > 0);
  return score >= (Number(sub.min_score) || 9);
}

/** 把一批快讯推给所有订阅的浏览器；返回 { sent, items:Set(推到了的快讯 id), errors } */
export async function pushToSubscribers(env, items, { dashboard, now = Date.now() } = {}) {
  const out = { sent: 0, ids: new Set(), errors: [] };
  const subs = await listSubscriptions(env);
  if (!subs.length || !items.length) return out;
  for (const sub of subs) {
    if (inQuiet(sub, now)) continue;
    const mine = items.filter((it) => wants(sub, it));
    for (const it of mine) {
      const base = (sub.origin || dashboard || '').split('#')[0];
      const payload = {
        title: it.title.slice(0, 180),
        body: `${it.source} · ${Math.round((Number(it.score) || 0) * 10) / 10} 分${it.confirms ? ` · ${it.confirms + 1} 个来源` : ''}`,
        id: it.id,
        url: base ? `${base}#i=${encodeURIComponent(it.id)}` : it.url,
        src: it.url,
        ts: it.ts,
        sticky: !!sub.sticky,
      };
      try {
        const r = await sendPush(env, sub, payload, { topic: String(it.id).replace(/[^A-Za-z0-9_-]/g, '').slice(-32) || undefined });
        if (r.ok) {
          out.sent++;
          out.ids.add(it.id);
          await env.DB.prepare('UPDATE push_subs SET last_ok = ?, fails = 0, last_error = NULL WHERE endpoint = ?').bind(now, sub.endpoint).run();
        } else if (r.gone) {
          await removeSubscription(env, sub.endpoint); // 浏览器已经退订或清了数据
          out.errors.push(`webpush: 订阅已失效，已删除 (${r.status})`);
          break;
        } else {
          out.errors.push(`webpush: ${r.error}`);
          await env.DB.prepare('UPDATE push_subs SET fails = fails + 1, last_error = ? WHERE endpoint = ?').bind(r.error, sub.endpoint).run();
        }
      } catch (e) {
        out.errors.push(`webpush: ${e?.message || e}`);
      }
    }
  }
  return out;
}

/** 过去 24 小时各门槛大概会推几条（给设置面板看） */
export async function dailyCounts(env, now = Date.now()) {
  try {
    const r = await env.DB.prepare(
      `SELECT SUM(CASE WHEN score >= 8 THEN 1 ELSE 0 END) AS s8, SUM(CASE WHEN score >= 8.5 THEN 1 ELSE 0 END) AS s85,
              SUM(CASE WHEN score >= 9 THEN 1 ELSE 0 END) AS s9, SUM(CASE WHEN score >= 9.5 THEN 1 ELSE 0 END) AS s95,
              SUM(CASE WHEN score >= 9 OR (score >= 8 AND confirms > 0) THEN 1 ELSE 0 END) AS conf
       FROM items WHERE ts > ? AND important = 1 AND dup_of IS NULL`
    )
      .bind(now - 24 * 3600_000)
      .first();
    return { 8: r?.s8 || 0, 8.5: r?.s85 || 0, 9: r?.s9 || 0, 9.5: r?.s95 || 0, confirmed: r?.conf || 0 };
  } catch {
    return null;
  }
}

// 后台脚本（Service Worker）：收到推送就弹系统通知；点通知打开看板并定位到这条快讯。
export const SW_JS = `
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
// 网页外壳：先给上次存下的版本（刷新不用等网络），同时在后台取新的存起来；没存过就走网络
self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.method !== 'GET' || r.mode !== 'navigate') return;
  var u = new URL(r.url);
  if (u.origin !== self.location.origin || u.pathname !== '/') return;
  e.respondWith(caches.open('hw-shell').then(function (c) {
    return c.match(r.url).then(function (hit) {
      var net = fetch(r).then(function (res) {
        if (res && res.ok) return c.put(r.url, res.clone()).then(function () { return res; });
        return res;
      });
      if (!hit) return net;
      e.waitUntil(net.catch(function () {}));
      return hit;
    });
  }));
});
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: e.data ? e.data.text() : 'Headline Watch' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Headline Watch', {
    body: d.body || '',
    tag: d.id || undefined,
    renotify: !!d.id, // 同一个 tag 的新通知也要再弹一次横幅，不然 macOS 只会悄悄替换
    requireInteraction: !!d.sticky, // 停留在屏幕上直到手动关掉
    silent: false,
    timestamp: d.ts || Date.now(),
    data: { url: d.url || '/', id: d.id || '', src: d.src || '' }
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var d = e.notification.data || {};
  var target = new URL(d.url || '/', self.location.origin);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (new URL(c.url).origin === target.origin && 'focus' in c) {
        c.postMessage({ hwOpen: d.id });
        return c.focus();
      }
    }
    return self.clients.openWindow(target.href);
  }));
});
`;
