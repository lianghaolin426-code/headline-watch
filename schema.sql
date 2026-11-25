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
  dup_of TEXT, -- 同一件事已有更早的重要快讯时，指向那一条（看板合并显示、不重复推送）
  dir INTEGER,    -- AI 标签：1 利好，-1 利空，0 中性
  tickers TEXT,   -- AI 标签：逗号分隔的股票代码
  topic TEXT,     -- AI 标签：话题
  sector TEXT,    -- AI 标签：板块
  story TEXT,     -- AI 标签：属于哪件具体的事（事件名）
  pick REAL,      -- 选题分：这条作为写稿原材料的价值（和突发分 score 分开）
  kind TEXT,      -- 类型：f 事实 / v 观点线索 / d 数据发布 / w 行情综述
  who TEXT,       -- 观点线索是谁说的，"English|中文"
  title_tr TEXT,  -- 标题译文（NULL = 还没翻，空串 = 翻过但没结果）
  body_tr TEXT,   -- 摘要译文
  tr_lang TEXT    -- 译文语言：zh 或 en
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

CREATE TABLE IF NOT EXISTS ai_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0, prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0);
-- Claude API 每天的用量：kind = score（打分和标签）或 translate（翻译）
CREATE TABLE IF NOT EXISTS claude_usage (day TEXT NOT NULL, kind TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind));
-- 深度文章和快讯的对应关系
CREATE TABLE IF NOT EXISTS related (flash_id TEXT NOT NULL, article_id TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (flash_id, article_id));
CREATE INDEX IF NOT EXISTS related_article ON related (article_id);
CREATE TABLE IF NOT EXISTS briefs (key TEXT PRIMARY KEY, title TEXT, body TEXT, srcs TEXT, ids TEXT, n INTEGER, created INTEGER, updated INTEGER, writes INTEGER NOT NULL DEFAULT 0, day TEXT, day_writes INTEGER NOT NULL DEFAULT 0);

-- 选题台（代码里自动建表，这里只是备查）：选题会结果、用户的选择、专题档案
CREATE TABLE IF NOT EXISTS desk_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, slot TEXT, n INTEGER, topics TEXT, usd REAL, model TEXT);
CREATE TABLE IF NOT EXISTS desk_picks (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, run_id INTEGER NOT NULL, rank INTEGER NOT NULL, verdict TEXT NOT NULL, title TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS desk_dossiers (run_id INTEGER NOT NULL, rank INTEGER NOT NULL, title TEXT, body TEXT, srcs TEXT, pasted TEXT, created INTEGER, updated INTEGER, writes INTEGER NOT NULL DEFAULT 0, usd REAL, PRIMARY KEY (run_id, rank));
