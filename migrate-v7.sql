-- 深度文章和快讯的对应关系（快讯一律记到这件事最早那条上）
CREATE TABLE IF NOT EXISTS related (flash_id TEXT NOT NULL, article_id TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (flash_id, article_id));
CREATE INDEX IF NOT EXISTS related_article ON related (article_id);
-- 已有的深度文章：不打分、不算重要、不并入快讯
UPDATE items SET score = NULL, base_score = NULL, important = 0, score_by = 'article', dup_of = NULL WHERE source = '华尔街见闻文章';
