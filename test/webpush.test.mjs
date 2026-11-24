import test from 'node:test';
import assert from 'node:assert/strict';
import { sendPush, inQuiet, wants, unb64u, b64u, encryptPayload } from '../src/webpush.js';

async function vapidEnv() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    kp,
    env: {
      VAPID_PUBLIC_KEY: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)),
      VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey)),
    },
  };
}

async function uaKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { p256dh: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) };
}

test('sendPush signs a valid VAPID JWT and sends an aes128gcm body', async () => {
  const { kp, env } = await vapidEnv();
  const ua = await uaKeys();
  let seen;
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    seen = { u, init };
    return new Response('', { status: 201 });
  };
  try {
    const r = await sendPush(env, { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', origin: 'https://hw.example.workers.dev/', ...ua }, { title: 't' });
    assert.equal(r.ok, true);
  } finally {
    globalThis.fetch = orig;
  }
  const h = seen.init.headers;
  assert.equal(h['Content-Encoding'], 'aes128gcm');
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h.Authorization);
  assert.ok(m);
  assert.equal(m[4], env.VAPID_PUBLIC_KEY);
  const claims = JSON.parse(new TextDecoder().decode(unb64u(m[2])));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'https://hw.example.workers.dev');
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, unb64u(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
  assert.ok(ok);
  const body = new Uint8Array(seen.init.body);
  assert.equal(body[20], 65); // salt 16 + rs 4，然后是 65 字节的公钥长度
});

test('encryptPayload output layout', async () => {
  const ua = await uaKeys();
  const body = await encryptPayload('hello', ua.p256dh, ua.auth);
  assert.equal(body.length, 16 + 4 + 1 + 65 + 5 + 1 + 16);
});

test('quiet hours across midnight, in the subscriber time zone', () => {
  const at = Date.UTC(2026, 10, 24, 21, 30); // 21:30 UTC = 00:30 Riyadh
  assert.equal(inQuiet({ quiet_from: 23, quiet_to: 7, tz: 'Asia/Riyadh' }, at), true);
  assert.equal(inQuiet({ quiet_from: 23, quiet_to: 7, tz: 'UTC' }, at), false);
  assert.equal(inQuiet({ quiet_from: null, quiet_to: 7, tz: 'UTC' }, at), false);
  assert.equal(inQuiet({ quiet_from: 9, quiet_to: 17, tz: 'UTC' }, Date.UTC(2026, 0, 1, 12)), true);
});

test('threshold modes', () => {
  assert.equal(wants({ mode: 'score', min_score: 9 }, { score: 8.8 }), false);
  assert.equal(wants({ mode: 'score', min_score: 9 }, { score: 9 }), true);
  assert.equal(wants({ mode: 'confirmed' }, { score: 8.2, confirms: 1 }), true);
  assert.equal(wants({ mode: 'confirmed' }, { score: 8.6, confirms: 0 }), false);
  assert.equal(wants({ mode: 'confirmed' }, { score: 9.5, confirms: 0 }), true);
});
