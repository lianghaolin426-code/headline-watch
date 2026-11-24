-- AI 标签：方向、股票代码、话题、板块；以及每天 AI 用量的记录
ALTER TABLE items ADD COLUMN dir INTEGER;   -- 1 利好，-1 利空，0 中性；NULL = AI 没给
ALTER TABLE items ADD COLUMN tickers TEXT;  -- 逗号分隔的股票代码，如 "NVDA,TSLA" 或 "2222"
ALTER TABLE items ADD COLUMN topic TEXT;    -- 话题的统一英文叫法，如 "Nvidia"、"Fed"
ALTER TABLE items ADD COLUMN sector TEXT;   -- tech / finance / energy / health / consumer / industrial / macro / crypto / other
CREATE TABLE IF NOT EXISTS ai_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0, prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0);
