ALTER TABLE items ADD COLUMN base_score REAL;
ALTER TABLE items ADD COLUMN confirms INTEGER NOT NULL DEFAULT 0;
UPDATE items SET base_score = score;
