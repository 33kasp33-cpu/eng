-- D1 Database Schema for SpeedTOEIC 600

CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    part INTEGER NOT NULL,            -- 5, 6, 7 (またはリスニング 2, 3)
    pattern_type TEXT NOT NULL,       -- 'POS_NOUN', 'POS_ADV', 'POS_ADJ', 'POS_VERB', 'PURPOSE_TRIGGER' 等
    question_text TEXT NOT NULL,      -- 設問本文（空欄は _____）
    option_0 TEXT NOT NULL,
    option_1 TEXT NOT NULL,
    option_2 TEXT NOT NULL,
    option_3 TEXT NOT NULL,
    answer_index INTEGER NOT NULL,    -- 0, 1, 2, 3
    trigger_text TEXT NOT NULL,       -- 20?40文字の秒殺ルール解説
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_questions_part ON questions(part, pattern_type);

CREATE TABLE IF NOT EXISTS rankings (
    id TEXT PRIMARY KEY,
    player_name TEXT NOT NULL,
    mode TEXT NOT NULL,               -- 'part5', 'part67', 'all'
    clear_time_ms INTEGER NOT NULL,   -- ミリ秒クリアタイム
    streak_count INTEGER NOT NULL,    -- 10
    penalty_ms INTEGER DEFAULT 0,     -- ペナルティ
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rankings_mode_time ON rankings(mode, clear_time_ms ASC);
CREATE INDEX IF NOT EXISTS idx_rankings_created ON rankings(created_at DESC);
