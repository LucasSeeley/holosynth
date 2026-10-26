// HoloSynth game server: a Cloudflare Worker over D1. Every reply is JSON; errors are { error: "message" }.
// It also serves the iPhone app download (IPA + SideStore source) from the KV namespace bound as FILES.
import {
  STARTER_TEAM, START_GOLD, PACK_COST, WIN_GOLD, WIN_XP, CAMPAIGN_GOLD, CAMPAIGN, CHAPTERS, NEW_CARD_AFTER,
  levelFor, openPack, newBattle, newCampaignBattle, applyMove, aiMove,
} from './game.js';

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const json = (data, status = 200) => Response.json(data, { status });
const now = () => Date.now();

// ---- passwords & sessions ----
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
  return hex(bits);
}

async function newSession(db, userId) {
  const token = randomHex(32);
  await db.prepare('INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)').bind(token, userId, now()).run();
  return token;
}

async function currentUser(req, db) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
  const row = token && await db.prepare(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').bind(token).first();
  if (!row) throw new HttpError(401, 'Please log in again.');
  return row;
}

async function body(req) {
  try { return await req.json(); } catch { throw new HttpError(400, 'Bad request.'); }
}

// ---- player profile ----
const getProgress = async (db, userId) =>
  await db.prepare('SELECT * FROM progress WHERE user_id = ?').bind(userId).first()
  ?? { user_id: userId, cleared: 0, wins: 0, packs: 0, run: null };

// Starters you can pick after level 3 (null when there's no pick waiting).
const pendingChoice = (prog, owned) => {
  const have = STARTER_TEAM.filter(id => owned[id]);
  return prog.cleared >= NEW_CARD_AFTER[0] && have.length === 1 ? STARTER_TEAM.filter(id => !owned[id]) : null;
};

async function profile(db, user) {
  const { results } = await db.prepare('SELECT card_id, count FROM collection WHERE user_id = ?').bind(user.id).all();
  const collection = Object.fromEntries(results.map(r => [r.card_id, r.count]));
  const prog = await getProgress(db, user.id);
  const next = CAMPAIGN[prog.cleared];
  const chapter = next ? next.chapter : CHAPTERS.length - 1;
  return {
    username: user.username,
    gold: user.gold,
    xp: user.xp,
    level: levelFor(user.xp),
    team: JSON.parse(user.team),
    collection,
    needsStarter: results.length === 0,
    wins: prog.wins,
    packs: prog.packs,
    campaign: {
      chapter: CHAPTERS[chapter].title,
      chapterNum: chapter + 1,
      cleared: prog.cleared,
      total: CAMPAIGN.length,
      next: next ? { num: next.num, title: next.title, enemies: next.enemies, boss: !!next.boss } : null,
      choose: pendingChoice(prog, collection),
      friendsUnlocked: prog.cleared >= NEW_CARD_AFTER[1],
    },
  };
}

const freshUser = (db, id) => db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
const addCard = (db, userId, id) => db.prepare(
  'INSERT INTO collection (user_id, card_id, count) VALUES (?, ?, 1) ON CONFLICT (user_id, card_id) DO UPDATE SET count = count + 1',
).bind(userId, id);

async function signup(req, db) {
  const { username = '', password = '' } = await body(req);
  const name = String(username).trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new HttpError(400, 'Username must be 3–16 letters, numbers or _.');
  if (String(password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
  if (await db.prepare('SELECT 1 FROM users WHERE username = ?').bind(name).first()) {
    throw new HttpError(409, 'That username is taken.');
  }
  const salt = randomHex(16);
  const user = await db.prepare(
    'INSERT INTO users (username, pass_hash, salt, gold, team, created) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
  ).bind(name, await hashPassword(password, salt), salt, START_GOLD, '[]', now()).first();
  await db.prepare('INSERT INTO progress (user_id) VALUES (?)').bind(user.id).run();
  return json({ token: await newSession(db, user.id), profile: await profile(db, user) });
}

async function login(req, db) {
  const { username = '', password = '' } = await body(req);
  const user = await db.prepare('SELECT * FROM users WHERE username = ?').bind(String(username).trim()).first();
  if (!user || await hashPassword(String(password), user.salt) !== user.pass_hash) {
    throw new HttpError(401, 'Wrong username or password.');
  }
  return json({ token: await newSession(db, user.id), profile: await profile(db, user) });
}

async function setTeam(req, db, user) {
  const { team } = await body(req);
  const owned = (await profile(db, user)).collection;
  const size = Math.min(3, Object.keys(owned).length);   // a full team is 3, fewer while the campaign hands out cards
  if (!Array.isArray(team) || team.length !== size || new Set(team).size !== size) {
    throw new HttpError(400, `Pick ${size} different cards.`);
  }
  if (!team.every(id => owned[id])) throw new HttpError(400, "You don't own all of those cards.");
  await db.prepare('UPDATE users SET team = ? WHERE id = ?').bind(JSON.stringify(team), user.id).run();
  return json(await profile(db, { ...user, team: JSON.stringify(team) }));
}

async function buyPack(db, user) {
  if (user.gold < PACK_COST) throw new HttpError(400, `You need ${PACK_COST} gold.`);
  const pack = openPack(user.packs_since_legend);
  // Guard on gold in the UPDATE so two quick taps can't both spend the same gold.
  const res = await db.prepare(
    'UPDATE users SET gold = gold - ?, packs_since_legend = ? WHERE id = ? AND gold >= ?',
  ).bind(PACK_COST, pack.packsSinceLegend, user.id, PACK_COST).run();
  if (!res.meta.changes) throw new HttpError(400, `You need ${PACK_COST} gold.`);
  await db.batch([...pack.cards.map(id => addCard(db, user.id, id)), bumpProgress(db, user.id, 'packs')]);
  return json({ cards: pack.cards, profile: await profile(db, await freshUser(db, user.id)) });
}

const bumpProgress = (db, userId, field) => db.prepare(
  `INSERT INTO progress (user_id, ${field}) VALUES (?, 1) ON CONFLICT (user_id) DO UPDATE SET ${field} = ${field} + 1`,
).bind(userId);

// ---- starter card & campaign ----
async function pickStarter(req, db, user) {
  const { card } = await body(req);
  if (!STARTER_TEAM.includes(card)) throw new HttpError(400, 'Pick Volt, Fang or Goliath.');
  // Only works while the collection is empty, so it can't be used to grab extra cards.
  const res = await db.prepare(
    'UPDATE users SET team = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM collection WHERE user_id = ?)',
  ).bind(JSON.stringify([card]), user.id, user.id).run();
  if (!res.meta.changes) throw new HttpError(400, 'You already have your first card.');
  await addCard(db, user.id, card).run();
  return json(await profile(db, await freshUser(db, user.id)));
}

async function pickReward(req, db, user) {
  const { card } = await body(req);
  const prof = await profile(db, user);
  if (!prof.campaign.choose?.includes(card)) throw new HttpError(400, "That card isn't on offer.");
  const team = [...prof.team, card];
  await db.batch([addCard(db, user.id, card),
    db.prepare('UPDATE users SET team = ? WHERE id = ?').bind(JSON.stringify(team), user.id)]);
  return json(await profile(db, await freshUser(db, user.id)));
}

const runView = run => run && { level: CAMPAIGN[run.level].num, title: CAMPAIGN[run.level].title, boss: !!CAMPAIGN[run.level].boss, state: run.state };

async function startCampaign(db, user) {
  const prof = await profile(db, user);
  if (prof.needsStarter) throw new HttpError(400, 'Pick your first card.');
  if (prof.campaign.choose) throw new HttpError(400, 'Pick your new card first.');
  const prog = await getProgress(db, user.id);
  if (prog.cleared >= CAMPAIGN.length) throw new HttpError(400, 'You beat the whole campaign!');
  const run = { level: prog.cleared, state: newCampaignBattle(prof.team, prog.cleared) };
  await db.prepare('INSERT INTO progress (user_id, run) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET run = excluded.run')
    .bind(user.id, JSON.stringify(run)).run();
  return json(runView(run));
}

async function campaignMove(req, db, user) {
  const prog = await getProgress(db, user.id);
  if (!prog.run) throw new HttpError(400, 'No campaign battle in progress.');
  const run = JSON.parse(prog.run);
  const { from, move: kind, to } = await body(req);
  try {
    applyMove(run.state, 0, from, kind, to);
    while (run.state.winner === null && run.state.turn === 1) {
      const m = aiMove(run.state, 1);
      applyMove(run.state, 1, m.from, m.move, m.to);
    }
  } catch (e) { throw new HttpError(400, e.message); }

  const done = run.state.winner !== null;
  // Save only if the run hasn't changed since we read it (stops double-submitted moves).
  const res = await db.prepare('UPDATE progress SET run = ? WHERE user_id = ? AND run = ?')
    .bind(done ? null : JSON.stringify(run), user.id, prog.run).run();
  if (!res.meta.changes) throw new HttpError(409, 'The battle changed. Refreshing.');

  let result = null;
  if (done) result = run.state.winner === 0 ? await campaignWin(db, user, run.level) : { won: false };
  return json({ ...runView(run), result, profile: await profile(db, await freshUser(db, user.id)) });
}

// First clear of a level: gold, XP, and the level's prize (new card / boss pack).
async function campaignWin(db, user, level) {
  const res = await db.prepare('UPDATE progress SET cleared = cleared + 1, wins = wins + 1 WHERE user_id = ? AND cleared = ?')
    .bind(user.id, level).run();
  if (!res.meta.changes) return { won: true, gold: 0, xp: 0 };
  await db.prepare('UPDATE users SET gold = gold + ?, xp = xp + ? WHERE id = ?').bind(CAMPAIGN_GOLD, WIN_XP, user.id).run();
  const result = { won: true, gold: CAMPAIGN_GOLD, xp: WIN_XP };
  const num = level + 1;
  const owned = (await profile(db, await freshUser(db, user.id))).collection;
  if (num === NEW_CARD_AFTER[0]) result.chooseCard = true;
  if (num === NEW_CARD_AFTER[1]) {
    const missing = STARTER_TEAM.filter(id => !owned[id]);
    if (missing.length === 1) {   // the one you didn't pick at level 3 joins
      const fresh = await freshUser(db, user.id);
      await db.batch([addCard(db, user.id, missing[0]),
        db.prepare('UPDATE users SET team = ? WHERE id = ?').bind(JSON.stringify([...JSON.parse(fresh.team), missing[0]]), user.id)]);
      result.newCard = missing[0];
    }
  }
  if (CAMPAIGN[level].boss) {
    const fresh = await freshUser(db, user.id);
    const pack = openPack(fresh.packs_since_legend);
    await db.batch([...pack.cards.map(id => addCard(db, user.id, id)),
      db.prepare('UPDATE users SET packs_since_legend = ? WHERE id = ?').bind(pack.packsSinceLegend, user.id),
      bumpProgress(db, user.id, 'packs')]);
    result.pack = pack.cards;
  }
  return result;
}

async function leaveCampaign(db, user) {
  await db.prepare('UPDATE progress SET run = NULL WHERE user_id = ?').bind(user.id).run();
  return json({ ok: true });
}

// ---- matches ----
const needFullTeam = user => {
  if (JSON.parse(user.team).length < 3) throw new HttpError(400, 'Clear campaign level 6 to battle friends.');
};
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), b => CODE_CHARS[b % CODE_CHARS.length]).join('');

async function matchView(db, m, user) {
  const names = await db.prepare('SELECT id, username FROM users WHERE id IN (?, ?)').bind(m.p0, m.p1 ?? -1).all();
  const nameOf = id => names.results.find(r => r.id === id)?.username ?? null;
  return {
    id: m.id,
    code: m.code,
    status: m.status,
    you: m.p0 === user.id ? 0 : 1,
    players: [nameOf(m.p0), nameOf(m.p1)],
    state: m.state ? JSON.parse(m.state) : null,
  };
}

async function createMatch(db, user) {
  needFullTeam(user);
  await db.prepare("UPDATE matches SET status = 'done', updated = ? WHERE p0 = ? AND status = 'waiting'")
    .bind(now(), user.id).run();  // only one open invite per player
  for (let tries = 0; tries < 5; tries++) {
    const m = await db.prepare(
      "INSERT INTO matches (code, p0, team0, status, updated) VALUES (?, ?, ?, 'waiting', ?) ON CONFLICT (code) DO NOTHING RETURNING *",
    ).bind(makeCode(), user.id, user.team, now()).first();
    if (m) return json(await matchView(db, m, user));
  }
  throw new HttpError(500, 'Could not make an invite code. Try again.');
}

async function joinMatch(req, db, user) {
  needFullTeam(user);
  const { code = '' } = await body(req);
  const m = await db.prepare("SELECT * FROM matches WHERE code = ? AND status = 'waiting'")
    .bind(String(code).trim().toUpperCase()).first();
  if (!m) throw new HttpError(404, 'No open match with that code.');
  if (m.p0 === user.id) throw new HttpError(400, "That's your own invite. Send the code to a friend.");
  const state = newBattle(JSON.parse(m.team0), JSON.parse(user.team));
  const res = await db.prepare(
    "UPDATE matches SET p1 = ?, state = ?, status = 'active', updated = ? WHERE id = ? AND status = 'waiting'",
  ).bind(user.id, JSON.stringify(state), now(), m.id).run();
  if (!res.meta.changes) throw new HttpError(409, 'Someone else joined that match first.');
  return json(await matchView(db, { ...m, p1: user.id, state: JSON.stringify(state), status: 'active' }, user));
}

async function getMatch(db, user, id) {
  const m = await db.prepare('SELECT * FROM matches WHERE id = ? AND (p0 = ? OR p1 = ?)').bind(id, user.id, user.id).first();
  if (!m) throw new HttpError(404, 'Match not found.');
  return m;
}

async function currentMatch(db, user) {
  const m = await db.prepare(
    "SELECT * FROM matches WHERE (p0 = ? OR p1 = ?) AND status IN ('waiting', 'active') ORDER BY updated DESC LIMIT 1",
  ).bind(user.id, user.id).first();
  return json(m ? await matchView(db, m, user) : null);
}

async function move(req, db, user, id) {
  const m = await getMatch(db, user, id);
  if (m.status !== 'active') throw new HttpError(400, 'This match is not in progress.');
  const { from, move: kind, to } = await body(req);
  const state = JSON.parse(m.state);
  try { applyMove(state, m.p0 === user.id ? 0 : 1, from, kind, to); }
  catch (e) { throw new HttpError(400, e.message); }

  const done = state.winner !== null;
  // Only save if nobody else changed the match since we read it (stops double-submitted moves).
  const res = await db.prepare('UPDATE matches SET state = ?, status = ?, updated = ? WHERE id = ? AND updated = ?')
    .bind(JSON.stringify(state), done ? 'done' : 'active', now(), m.id, m.updated).run();
  if (!res.meta.changes) throw new HttpError(409, 'The match changed. Refreshing.');
  if (done) {
    const winnerId = state.winner === 0 ? m.p0 : m.p1;
    await db.batch([db.prepare('UPDATE users SET gold = gold + ?, xp = xp + ? WHERE id = ?').bind(WIN_GOLD, WIN_XP, winnerId),
      bumpProgress(db, winnerId, 'wins')]);
  }
  return json(await matchView(db, { ...m, state: JSON.stringify(state), status: done ? 'done' : 'active' }, user));
}

async function leaveMatch(db, user, id) {
  const m = await getMatch(db, user, id);
  if (m.status === 'waiting') {
    await db.prepare("UPDATE matches SET status = 'done', updated = ? WHERE id = ?").bind(now(), m.id).run();
  } else if (m.status === 'active') {  // forfeit: the other player wins
    const state = JSON.parse(m.state);
    const you = m.p0 === user.id ? 0 : 1;
    state.winner = 1 - you;
    await db.prepare("UPDATE matches SET state = ?, status = 'done', updated = ? WHERE id = ?")
      .bind(JSON.stringify(state), now(), m.id).run();
    const winnerId = you === 0 ? m.p1 : m.p0;
    await db.batch([db.prepare('UPDATE users SET gold = gold + ?, xp = xp + ? WHERE id = ?').bind(WIN_GOLD, WIN_XP, winnerId),
      bumpProgress(db, winnerId, 'wins')]);
  }
  return json({ ok: true });
}

// ---- app download (SideStore) ----
async function file(env, key, type) {
  const body = await env.FILES.get(key, { type: 'stream' });
  if (!body) return new Response('Not built yet.', { status: 404 });
  return new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
}

async function route(req, env) {
  const db = env.DB;
  const { pathname } = new URL(req.url);
  const [, a, b, c] = pathname.split('/');
  const method = req.method;

  if (method === 'GET' && pathname === '/') return json({ name: 'HoloSynth', ok: true });
  if (method === 'GET' && pathname === '/HoloSynth.ipa') return file(env, 'HoloSynth.ipa', 'application/octet-stream');
  if (method === 'GET' && pathname === '/source.json') return file(env, 'source.json', 'application/json');
  if (method === 'GET' && pathname === '/icon.png') return file(env, 'icon.png', 'image/png');
  if (method === 'GET' && pathname === '/build.txt') return file(env, 'build.txt', 'text/plain');
  if (method === 'POST' && pathname === '/signup') return signup(req, db);
  if (method === 'POST' && pathname === '/login') return login(req, db);

  const user = await currentUser(req, db);
  if (method === 'GET' && pathname === '/me') return json(await profile(db, user));
  if (method === 'POST' && pathname === '/team') return setTeam(req, db, user);
  if (method === 'POST' && pathname === '/packs') return buyPack(db, user);
  if (method === 'POST' && pathname === '/starter') return pickStarter(req, db, user);
  if (a === 'campaign') {
    if (method === 'GET' && b === 'current') return json(runView(JSON.parse((await getProgress(db, user.id)).run)));
    if (method === 'POST' && b === 'start') return startCampaign(db, user);
    if (method === 'POST' && b === 'move') return campaignMove(req, db, user);
    if (method === 'POST' && b === 'leave') return leaveCampaign(db, user);
    if (method === 'POST' && b === 'reward') return pickReward(req, db, user);
  }
  if (a === 'matches') {
    if (method === 'POST' && !b) return createMatch(db, user);
    if (method === 'GET' && b === 'current') return currentMatch(db, user);
    if (method === 'POST' && b === 'join') return joinMatch(req, db, user);
    const id = Number(b);
    if (method === 'GET' && !c) return json(await matchView(db, await getMatch(db, user, id), user));
    if (method === 'POST' && c === 'move') return move(req, db, user, id);
    if (method === 'POST' && c === 'leave') return leaveMatch(db, user, id);
  }
  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(req, env) {
    try { return await route(req, env); }
    catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Server error. Try again.' }, 500);
    }
  },
};
