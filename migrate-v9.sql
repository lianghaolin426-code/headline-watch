-- 网页推送（不跑也行：第一次用到时会自动建表）
CREATE TABLE IF NOT EXISTS push_keys (id INTEGER PRIMARY KEY, public_key TEXT NOT NULL, private_jwk TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, min_score REAL NOT NULL DEFAULT 9, mode TEXT NOT NULL DEFAULT 'score', quiet_from INTEGER, quiet_to INTEGER, tz TEXT, origin TEXT, ua TEXT, created INTEGER NOT NULL, last_ok INTEGER, fails INTEGER NOT NULL DEFAULT 0, last_error TEXT);
