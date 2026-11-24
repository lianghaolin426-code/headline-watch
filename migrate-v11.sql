-- 省 D1 读取量（2026-11-24 读超免费额度后加的）。不用手动跑：新代码第一次跑 cron 时会自动执行（见 src/dbguard.js 的 ensureSchema）。
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT, updated INTEGER);
CREATE TABLE IF NOT EXISTS d1_reads (day TEXT NOT NULL, kind TEXT NOT NULL, rows INTEGER NOT NULL DEFAULT 0, queries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind));
CREATE INDEX IF NOT EXISTS idx_items_dupof ON items (dup_of) WHERE dup_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_src_ts ON items (source, ts);
CREATE INDEX IF NOT EXISTS idx_items_tr ON items (ts) WHERE title_tr IS NULL AND score >= 6;
CREATE INDEX IF NOT EXISTS idx_items_brief ON items (ts) WHERE score >= 5 AND dup_of IS NULL;
CREATE INDEX IF NOT EXISTS related_ts ON related (ts);
ALTER TABLE source_state ADD COLUMN last_ids TEXT;
