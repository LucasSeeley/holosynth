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
-- Friends: one row per "user_id added friend_id". Both directions present = friends; one direction = a pending request.
CREATE TABLE IF NOT EXISTS friends (
  user_id INTEGER NOT NULL,
  friend_id INTEGER NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS friends_to ON friends (friend_id);
-- Per-player extras added after launch: when they were last seen (for "online") and their avatar card (null = team leader).
CREATE TABLE IF NOT EXISTS presence (
  user_id INTEGER PRIMARY KEY,
  seen INTEGER NOT NULL DEFAULT 0,
  avatar TEXT
);
-- A friend match sent straight to one friend (the match itself is an ordinary waiting match with a code).
CREATE TABLE IF NOT EXISTS challenges (
  match_id INTEGER PRIMARY KEY,
  to_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS challenges_to ON challenges (to_id);
-- Daily spin: when each player last spun (one spin per 24 hours).
CREATE TABLE IF NOT EXISTS spins (
  user_id INTEGER PRIMARY KEY,
  last INTEGER NOT NULL
);
-- Gauntlet: best streak ever and the run in progress (JSON, null when none).
CREATE TABLE IF NOT EXISTS gauntlet (
  user_id INTEGER PRIMARY KEY,
  best INTEGER NOT NULL DEFAULT 0,
  run TEXT
);
CREATE INDEX IF NOT EXISTS gauntlet_best ON gauntlet (best);
-- Trade offers between friends: up to 3 cards (repeats = copies) and some gold each way.
-- status: open | done | declined | cancelled | countered
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL,
  to_id INTEGER NOT NULL,
  give TEXT NOT NULL,
  get TEXT NOT NULL,
  give_gold INTEGER NOT NULL DEFAULT 0,
  get_gold INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trades_to ON trades (to_id, status);
CREATE INDEX IF NOT EXISTS trades_from ON trades (from_id, status);
