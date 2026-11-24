-- 事件简报（不跑也行：第一次写简报时会自动建表）
CREATE TABLE IF NOT EXISTS briefs (key TEXT PRIMARY KEY, title TEXT, body TEXT, srcs TEXT, ids TEXT, n INTEGER, created INTEGER, updated INTEGER, writes INTEGER NOT NULL DEFAULT 0, day TEXT, day_writes INTEGER NOT NULL DEFAULT 0);
