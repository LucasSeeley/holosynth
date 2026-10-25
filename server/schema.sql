CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  gold INTEGER NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  packs_since_legend INTEGER NOT NULL DEFAULT 0,
  team TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS collection (
  user_id INTEGER NOT NULL,
  card_id TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, card_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  p0 INTEGER NOT NULL,
  p1 INTEGER,
  team0 TEXT NOT NULL,
  state TEXT,
  status TEXT NOT NULL,          -- waiting | active | done
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_p0 ON matches (p0, status);
CREATE INDEX IF NOT EXISTS matches_p1 ON matches (p1, status);
-- One row per player: campaign progress, stats, and the campaign battle in progress (JSON, null when none).
CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER PRIMARY KEY,
  cleared INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  packs INTEGER NOT NULL DEFAULT 0,
  run TEXT
);
