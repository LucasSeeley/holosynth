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
-- Fused copies: each row is one of the player's copies of card_id (it counts in collection.count) with its fusion levels.
-- h/b/s: HP, basic, special levels (0-3); x: second special unlocked; o: holo. user_id 0 = held in a trade until the other side claims it.
CREATE TABLE IF NOT EXISTS fused (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  card_id TEXT NOT NULL,
  h INTEGER NOT NULL DEFAULT 0,
  b INTEGER NOT NULL DEFAULT 0,
  s INTEGER NOT NULL DEFAULT 0,
  x INTEGER NOT NULL DEFAULT 0,
  o INTEGER NOT NULL DEFAULT 0,  -- holo copy (added to the live table by hand: ALTER TABLE fused ADD COLUMN o ...)
  p INTEGER NOT NULL DEFAULT 0   -- passive unlocked (added to the live table by hand: ALTER TABLE fused ADD COLUMN p ...)
);
CREATE INDEX IF NOT EXISTS fused_user ON fused (user_id, card_id);
-- Daily shop: which of today's cards (slot 0-3) each player has bought. day = midnight UTC in ms.
CREATE TABLE IF NOT EXISTS shop_buys (
  user_id INTEGER NOT NULL,
  day INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  PRIMARY KEY (user_id, day, slot)
);
-- Legend Hunt: one try a day. day = midnight UTC (ms) of the try; state = the fight while it's on; result = won | lost.
CREATE TABLE IF NOT EXISTS hunts (
  user_id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL,
  legend TEXT NOT NULL,
  state TEXT,
  result TEXT
);
-- Daily quests: today's three quest ids, the counters they count from, which are claimed, and whether the bonus pack was taken.
CREATE TABLE IF NOT EXISTS daily_quests (
  user_id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL,
  quests TEXT NOT NULL,
  base TEXT NOT NULL,
  claimed TEXT NOT NULL,
  bonus INTEGER NOT NULL DEFAULT 0
);
-- Quest progress that no other counter keeps (fuses, friend wins, best Gauntlet streak), per player per day.
CREATE TABLE IF NOT EXISTS quest_events (
  user_id INTEGER NOT NULL,
  day INTEGER NOT NULL,
  kind TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (user_id, day, kind)
);
-- Ranked: one row per player (missing = Rookie on 0). week = the Monday (ms) the points belong to; best = highest rank this
-- season; run = a fight against another player's team played by the computer; moved = last week's result (shown once);
-- reward = last season's reward waiting to be claimed.
CREATE TABLE IF NOT EXISTS ranked (
  user_id INTEGER PRIMARY KEY,
  rank INTEGER NOT NULL DEFAULT 0,
  week INTEGER NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  best INTEGER NOT NULL DEFAULT 0,
  run TEXT,
  moved TEXT,
  reward TEXT
);
-- Players searching for a live ranked match right now.
CREATE TABLE IF NOT EXISTS ranked_queue (
  user_id INTEGER PRIMARY KEY,
  since INTEGER NOT NULL
);
-- Ranked bookkeeping: the week and season the standings were last moved on.
CREATE TABLE IF NOT EXISTS ranked_meta (
  k TEXT PRIMARY KEY,
  v INTEGER NOT NULL
);

-- Packs won or bought but not opened yet. Contents are rolled when you get the pack (cards and holo as JSON lists).
CREATE TABLE IF NOT EXISTS pack_inv (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  cards TEXT NOT NULL,
  holo TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pack_inv_user ON pack_inv (user_id);

-- Power cards each player owns (used up when played in battle), and the (up to) 2 they take into battle.
CREATE TABLE IF NOT EXISTS powers (
  user_id INTEGER NOT NULL,
  power TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, power)
);
CREATE TABLE IF NOT EXISTS power_team (
  user_id INTEGER PRIMARY KEY,
  team TEXT NOT NULL DEFAULT '[]'
);

-- Main quest line: which step you're on, and the lifetime event counts when it started (action quests count from there).
CREATE TABLE IF NOT EXISTS main_quest (
  user_id INTEGER PRIMARY KEY,
  step INTEGER NOT NULL DEFAULT 0,
  base TEXT NOT NULL DEFAULT '{}'
);
-- Login / sign-up tries per name or network, for rate limits (key like 'login:name', n tries since `since`).
CREATE TABLE IF NOT EXISTS attempts (
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  since INTEGER NOT NULL
);
-- Each account's email (its own table: the schema step only creates tables, it can't add columns to users).
-- `verified` is for when email checks / password resets arrive.
CREATE TABLE IF NOT EXISTS emails (
  user_id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  verified INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);

-- When each player agreed to the Terms and the Privacy Policy at sign-up (and which versions: their "last updated" dates).
CREATE TABLE IF NOT EXISTS agreements (
  user_id INTEGER PRIMARY KEY,
  terms TEXT NOT NULL,
  privacy TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- Cards a player has looked at (JSON array of ids), so NEW tags match on every device: new = owned but not seen.
CREATE TABLE IF NOT EXISTS seen_cards (
  user_id INTEGER PRIMARY KEY,
  ids TEXT NOT NULL
);

-- One-time links sent by email: verify an address, or reset a password. Only a hash of the token is kept.
CREATE TABLE IF NOT EXISTS email_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,          -- verify | reset
  email TEXT NOT NULL,         -- the address it was sent to
  expires INTEGER NOT NULL
);

-- One inventory change at a time per player (trades, fusing, team, recruit). `until`: a lock left by a crashed request expires.
CREATE TABLE IF NOT EXISTS locks (
  user_id INTEGER PRIMARY KEY,
  until INTEGER NOT NULL
);
