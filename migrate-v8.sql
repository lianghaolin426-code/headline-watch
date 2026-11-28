-- Claude API 每天的用量（不跑也行：第一次记用量时会自动建表）
CREATE TABLE IF NOT EXISTS claude_usage (day TEXT NOT NULL, kind TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind));
