CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL,        -- 来源给出的发布时间（毫秒）
  seen_at INTEGER NOT NULL,   -- 本程序第一次抓到的时间（毫秒）
  hits TEXT NOT NULL DEFAULT '', -- 命中的关键词/大数字，空表示没命中
  notified INTEGER,           -- 推送时间，NULL 表示没推送
  score REAL,                 -- 重要性评分 0-10
  important INTEGER NOT NULL DEFAULT 0, -- 1 = 达到阈值，算重要快讯
  score_by TEXT,              -- ai 或 rule
  base_score REAL,            -- 互证加分前的分数
  confirms INTEGER NOT NULL DEFAULT 0, -- 被几个其他来源报道
  dup_of TEXT -- 同一件事已有更早的重要快讯时，指向那一条（看板合并显示、不重复推送）
);
CREATE INDEX IF NOT EXISTS idx_items_ts ON items(ts DESC);
CREATE INDEX IF NOT EXISTS idx_items_seen ON items(seen_at);
CREATE INDEX IF NOT EXISTS idx_items_important ON items(important, ts DESC);

CREATE TABLE IF NOT EXISTS source_state (
  key TEXT PRIMARY KEY,
  runs INTEGER NOT NULL DEFAULT 0,
  last_ok INTEGER,
  last_count INTEGER,
  last_error TEXT,
  last_error_at INTEGER
);


-- 标题向量（跨语言判断同一件事用），只保留几个小时
CREATE TABLE IF NOT EXISTS vecs (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, zh INTEGER NOT NULL, v BLOB NOT NULL);
CREATE INDEX IF NOT EXISTS vecs_ts ON vecs (ts);
