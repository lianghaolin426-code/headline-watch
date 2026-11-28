-- v12（代码会在 cron 第一次运行时自动执行，这里留档）
CREATE INDEX IF NOT EXISTS idx_items_wait ON items (seen_at) WHERE score_by = 'wait';
ALTER TABLE d1_reads ADD COLUMN writes INTEGER NOT NULL DEFAULT 0;
