// HoloSynth game server: a Cloudflare Worker over D1. Every reply is JSON; errors are { error: "message" }.
// It also serves the iPhone app download (IPA + SideStore source) from the KV namespace bound as FILES.
import {
  BY_ID, STARTER_TEAM, START_GOLD, PACK_COST, PACK_COSTS, WIN_GOLD, WIN_XP, CAMPAIGN_GOLD, CAMPAIGN_XP, CAMPAIGN, CHAPTERS, NEW_CARD_AFTER, OPEN_LEVELS,
  levelFor, levelStart, openPack, newBattle, spinWheel, SPIN_SLOTS, dayStart, nextSpinAt, PACK_TYPES, PACKS_OPEN, freePack, dailyPack, dailyShop, SHOP_PRICES, huntFoes, huntStart, HUNT_MS, huntBattle, huntPack, HUNT_GOLD, HUNT_XP, QUESTS, QUEST_PAY, QUEST_BONUS, pickQuests, RANKS, RANK_REWARDS, RANKED_WIN, RANKED_LOSS, RANKED_GOLD, RANKED_XP, WEEK_MS, weekStart, seasonOf, seasonEnd, rankMove, rankTable, rankedTeam, botName, rankedFusions,
  gauntletEnemies, gauntletBattle, gauntletHeal, fusedHp, FUSE_COST, FUSE_GOLD, FUSE_MAX, SECOND, SECOND_COST, gauntletGold, GAUNTLET_PACK_EVERY, newCampaignBattle, applyMove, aiMove,
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
// The card shown as someone's picture: the one they chose, else their team leader.
const avatarOf = (chosen, team) => chosen || JSON.parse(team || '[]')[0] || 'volt';

const getProgress = async (db, userId) =>
  await db.prepare('SELECT * FROM progress WHERE user_id = ?').bind(userId).first()
  ?? { user_id: userId, cleared: 0, wins: 0, packs: 0, run: null };

// Starters you can pick after level 3 (null when there's no pick waiting).
const pendingChoice = (prog, owned) => {
  const have = STARTER_TEAM.filter(id => owned[id]);
  return prog.cleared >= NEW_CARD_AFTER[0] && have.length === 1 ? STARTER_TEAM.filter(id => !owned[id]) : null;
};

// ---- fusion ----
const fusedRows = async (db, userId, cardId) => (await (cardId
  ? db.prepare('SELECT * FROM fused WHERE user_id = ? AND card_id = ?').bind(userId, cardId)
  : db.prepare('SELECT * FROM fused WHERE user_id = ?').bind(userId)).all()).results;
const fusionScore = r => r.h + r.b + r.s + r.x * 3 + (r.o ? 4 : 0);   // a holo copy beats a lightly fused one
const fusedView = r => ({ id: r.id, card: r.card_id, h: r.h, b: r.b, s: r.s, x: !!r.x, o: !!r.o });
// The best fused copy of each card a player owns: what their battles use.
async function fusionsFor(db, userId) {
  const best = {};
  for (const r of await fusedRows(db, userId)) if (!best[r.card_id] || fusionScore(r) > fusionScore(best[r.card_id])) best[r.card_id] = r;
  return Object.fromEntries(Object.entries(best).map(([id, r]) => [id, { h: r.h, b: r.b, s: r.s, x: !!r.x, o: !!r.o }]));
}
// Fuse spare (plain) copies into your best normal copy of a card, or your best holo copy when `holo` is set
// (a normal copy becomes a fused copy the first time).
async function fuseCard(req, db, user) {
  const { card = '', stat = '', holo = false } = await body(req);
  if (!BY_ID[card] || !['h', 'b', 's', 'x'].includes(stat)) throw new HttpError(400, 'Pick a card and a stat to fuse.');
  const count = (await db.prepare('SELECT count FROM collection WHERE user_id = ? AND card_id = ?').bind(user.id, card).first())?.count ?? 0;
  const rows = await fusedRows(db, user.id, card);
  const target = rows.filter(r => !!r.o === !!holo).sort((a, b) => fusionScore(b) - fusionScore(a))[0];
  if (holo && !target) throw new HttpError(400, "You don't have a holo copy of that card.");
  const need = stat === 'x' ? SECOND_COST.copies : FUSE_COST;
  const plain = count - rows.length;                  // copies not already fused
  if (plain < need + (target ? 0 : 1)) throw new HttpError(400, `You need ${need} spare copies to fuse.`);
  if (stat === 'x') {
    if (!SECOND[card]) throw new HttpError(400, 'Only Epic and Legendary cards have a second special.');
    if (target?.x) throw new HttpError(400, 'Already unlocked.');
    if (user.gold < SECOND_COST.gold) throw new HttpError(400, `You need ${SECOND_COST.gold.toLocaleString('en-US')} gold.`);
  } else if ((target?.[stat] ?? 0) >= FUSE_MAX) throw new HttpError(400, 'That stat is already maxed.');
  const gold = stat === 'x' ? SECOND_COST.gold : FUSE_GOLD[target?.[stat] ?? 0];
  if (user.gold < gold) throw new HttpError(400, `You need ${gold.toLocaleString('en-US')} gold.`);
  const paid = await db.prepare('UPDATE users SET gold = gold - ? WHERE id = ? AND gold >= ?').bind(gold, user.id, gold).run();
  if (!paid.meta.changes) throw new HttpError(400, `You need ${gold.toLocaleString('en-US')} gold.`);
  const take = await db.prepare('UPDATE collection SET count = count - ? WHERE user_id = ? AND card_id = ? AND count >= ?')
    .bind(need, user.id, card, need + rows.length + (target ? 0 : 1)).run();
  if (!take.meta.changes) {
    await db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').bind(gold, user.id).run();   // refund
    throw new HttpError(400, `You need ${need} spare copies to fuse.`);
  }
  const writes = [];
  if (target) writes.push(db.prepare(`UPDATE fused SET ${stat} = ${stat === 'x' ? 1 : `${stat} + 1`} WHERE id = ?`).bind(target.id));
  else writes.push(db.prepare(`INSERT INTO fused (user_id, card_id, ${stat}) VALUES (?, ?, 1)`).bind(user.id, card));
  writes.push(questEvent(db, user.id, 'fuse'));
  await db.batch(writes);
  return json(await profile(db, await freshUser(db, user.id)));
}

// ---- daily quests ----
const questEvent = (db, userId, kind, n = 1, best = false) => db.prepare(
  `INSERT INTO quest_events (user_id, day, kind, n) VALUES (?1, ?2, ?3, ?4)
   ON CONFLICT (user_id, day, kind) DO UPDATE SET n = ${best ? 'MAX(n, ?4)' : 'n + ?4'}`).bind(userId, dayStart(now()), kind, n);

// Today's quests and progress. Picked the first time they're asked for each day, along with the counters they count from.
async function questsFor(db, user, prog, collection, extra, shopped) {
  const day = dayStart(now());
  let row = await db.prepare('SELECT * FROM daily_quests WHERE user_id = ?').bind(user.id).first();
  if (!row || row.day !== day) {
    const can = ['spin', 'pack', 'shop', 'wins'];
    if (prog.cleared + 2 <= OPEN_LEVELS) can.push('levels');
    if (Object.values(collection).some(n => n > FUSE_COST)) can.push('fuse');
    if (prog.cleared >= NEW_CARD_AFTER[1] && extra.friends > 0) can.push('friend');
    if (JSON.parse(user.team).length >= 3) can.push('streak', 'hunt');
    const base = { wins: prog.wins, packs: prog.packs, cleared: prog.cleared };
    await db.prepare(`INSERT INTO daily_quests (user_id, day, quests, base, claimed, bonus) VALUES (?1, ?2, ?3, ?4, '[]', 0)
      ON CONFLICT (user_id) DO UPDATE SET day = ?2, quests = ?3, base = ?4, claimed = '[]', bonus = 0 WHERE daily_quests.day < ?2`)
      .bind(user.id, day, JSON.stringify(pickQuests(user.id, day, can)), JSON.stringify(base)).run();
    row = await db.prepare('SELECT * FROM daily_quests WHERE user_id = ?').bind(user.id).first();
  }
  const { results } = await db.prepare('SELECT kind, n FROM quest_events WHERE user_id = ? AND day = ?').bind(user.id, day).all();
  const ev = Object.fromEntries(results.map(r => [r.kind, r.n]));
  const base = JSON.parse(row.base), claimed = JSON.parse(row.claimed);
  const have = {
    spin: extra.spun >= day ? 1 : 0, pack: prog.packs - base.packs, shop: shopped,
    wins: prog.wins - base.wins, levels: prog.cleared - base.cleared,
    fuse: ev.fuse || 0, friend: ev.friend || 0, streak: ev.streak || 0, hunt: ev.hunt || 0,
  };
  const list = JSON.parse(row.quests).map((id, i) => {
    const q = QUESTS[id], pay = QUEST_PAY[q.tier];
    return { id, name: q.name, hint: q.hint ?? null, n: Math.max(0, Math.min(q.goal, have[id])), goal: q.goal, ...pay, claimed: claimed.includes(i) };
  });
  const bonus = row.bonus ? 'claimed' : list.length && list.every(q => q.claimed) ? 'ready' : 'locked';
  return { list, bonus, bonusPack: QUEST_BONUS, next: day + 86400000 };
}

// Claim a finished quest (0-2), or "bonus" for the free pack once all three are claimed.
async function claimQuest(req, db, user) {
  const { quest } = await body(req);
  const day = dayStart(now());
  const { quests } = await profile(db, user);
  const row = await db.prepare('SELECT * FROM daily_quests WHERE user_id = ? AND day = ?').bind(user.id, day).first();
  if (!row) throw new HttpError(409, 'New quests just arrived. Take a look.');
  if (quest === 'bonus') {
    if (quests.bonus !== 'ready') throw new HttpError(400, quests.bonus === 'claimed' ? 'You already got today\'s pack.' : 'Finish all three quests first.');
    const res = await db.prepare('UPDATE daily_quests SET bonus = 1 WHERE user_id = ? AND day = ? AND bonus = 0').bind(user.id, day).run();
    if (!res.meta.changes) throw new HttpError(400, "You already got today's pack.");
    const pack = openPack(user.packs_since_legend, QUEST_BONUS);
    await db.batch([...packWrites(db, user.id, pack, QUEST_BONUS),
      db.prepare('UPDATE users SET packs_since_legend = ? WHERE id = ?').bind(pack.packsSinceLegend, user.id)]);
    return json({ cards: pack.cards, holo: pack.holo, type: QUEST_BONUS, profile: await profile(db, await freshUser(db, user.id)) });
  }
  const q = Number.isInteger(quest) ? quests.list[quest] : null;
  if (!q) throw new HttpError(400, 'Unknown quest.');
  if (q.claimed) throw new HttpError(400, 'You already claimed that one.');
  if (q.n < q.goal) throw new HttpError(400, "That quest isn't done yet.");
  const res = await db.prepare('UPDATE daily_quests SET claimed = ? WHERE user_id = ? AND day = ? AND claimed = ?')
    .bind(JSON.stringify([...JSON.parse(row.claimed), quest]), user.id, day, row.claimed).run();
  if (!res.meta.changes) throw new HttpError(409, 'Quests changed. Refreshing.');
  await db.prepare('UPDATE users SET gold = gold + ?, xp = xp + ? WHERE id = ?').bind(q.gold, q.xp, user.id).run();
  return json({ cards: null, type: null, profile: await profile(db, await freshUser(db, user.id)) });
}

async function profile(db, user) {
  const { results } = await db.prepare('SELECT card_id, count FROM collection WHERE user_id = ?').bind(user.id).all();
  const collection = Object.fromEntries(results.map(r => [r.card_id, r.count]));
  const prog = await getProgress(db, user.id);
  const extra = await db.prepare(`SELECT (SELECT avatar FROM presence WHERE user_id = ?1) AS avatar,
    (SELECT last FROM spins WHERE user_id = ?1) AS spun,
    (SELECT GROUP_CONCAT(slot) FROM shop_buys WHERE user_id = ?1 AND day = ?2) AS shopped,
    (SELECT CASE WHEN state IS NOT NULL THEN 'playing' ELSE result END FROM hunts WHERE user_id = ?1 AND day = ?3) AS hunted,
    (SELECT best FROM gauntlet WHERE user_id = ?1) AS gbest,
    (SELECT json_group_array(json_object('type', type, 'n', n)) FROM (SELECT type, COUNT(*) AS n, MIN(id) AS first FROM pack_inv
       WHERE user_id = ?1 GROUP BY type ORDER BY first)) AS unopened,
    (SELECT COUNT(*) FROM friends f JOIN friends g ON g.user_id = f.friend_id AND g.friend_id = f.user_id
       JOIN gauntlet x ON x.user_id = f.friend_id
       WHERE f.user_id = ?1 AND x.best > COALESCE((SELECT best FROM gauntlet WHERE user_id = ?1), 0)) AS gahead,
    (SELECT COUNT(*) FROM friends f JOIN friends g ON g.user_id = f.friend_id AND g.friend_id = f.user_id WHERE f.user_id = ?1) AS friends`)
    .bind(user.id, dayStart(now()), huntStart(now())).first();
  const sold = String(extra.shopped ?? '').split(',');
  const quests = await questsFor(db, user, prog, collection, extra, sold.filter(Boolean).length);
  const next = prog.cleared < OPEN_LEVELS ? CAMPAIGN[prog.cleared] : null;   // locked chapters count as done for now
  const chapter = next ? next.chapter : CAMPAIGN[OPEN_LEVELS - 1].chapter;
  return {
    username: user.username,
    gold: user.gold,
    xp: user.xp,
    level: levelFor(user.xp),
    levelXp: user.xp - levelStart(levelFor(user.xp)),                            // XP into the current level
    levelNeed: levelStart(levelFor(user.xp) + 1) - levelStart(levelFor(user.xp)),   // XP the current level takes
    team: JSON.parse(user.team),
    collection,
    needsStarter: results.length === 0,
    avatar: avatarOf(extra.avatar, user.team),
    since: user.created,
    friends: extra.friends,
    nextSpin: nextSpinAt(extra.spun, now()),   // ms when the wheel resets (midnight UTC); 0 = spin now
    spinPack: dailyPack(now()),   // which pack the wheel's pack slot gives today
    packsOpen: PACKS_OPEN,        // packs on sale; the rest say "Coming soon"
    shop: {   // today's cards (slot 0 is the Rare); new ones at midnight UTC
      cards: dailyShop(now()).map((id, i) => ({ id, price: SHOP_PRICES[BY_ID[id].rarity], sold: sold.includes(String(i)) })),
      next: dayStart(now()) + 86400000,
    },
    fused: (await fusedRows(db, user.id)).map(fusedView),
    quests,
    ranked: await rankedTile(db, user),
    hunt: { ...huntFoes(now()), status: extra.hunted ?? 'ready', next: huntStart(now()) + HUNT_MS },   // ready | playing | won | lost
    gauntlet: { best: extra.gbest || 0, rank: extra.gahead + 1 },   // rank among you and your friends
    wins: prog.wins,
    packs: prog.packs,
    unopened: JSON.parse(extra.unopened ?? '[]'),   // packs waiting to be opened, oldest first: [{ type, n }]
    campaign: {
      chapter: CHAPTERS[chapter].title,
      chapterNum: chapter + 1,
      cleared: prog.cleared,
      total: OPEN_LEVELS,
      next: next ? { num: next.num, title: next.title, enemies: next.enemies, boss: !!next.boss } : null,
      choose: pendingChoice(prog, collection),
      friendsUnlocked: prog.cleared >= NEW_CARD_AFTER[1],
    },
  };
}

const freshUser = (db, id) => db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
// A pack's cards go into the collection; each holo one also gets its own copy row (a fused row with o = 1).
const cardWrites = (db, userId, pack) => [...pack.cards.map(id => addCard(db, userId, id)),
  ...pack.holo.map(i => db.prepare('INSERT INTO fused (user_id, card_id, o) VALUES (?, ?, 1)').bind(userId, pack.cards[i]))];
// Won or bought packs wait unopened (contents already rolled) until you open them from the Play tab.
const packWrites = (db, userId, pack, type) => [db.prepare('INSERT INTO pack_inv (user_id, type, cards, holo) VALUES (?, ?, ?, ?)')
  .bind(userId, type, JSON.stringify(pack.cards), JSON.stringify(pack.holo))];

// Opens your oldest unopened pack of `type`.
async function openInv(req, db, user) {
  const { type } = await body(req);
  const row = await db.prepare(`DELETE FROM pack_inv WHERE id = (SELECT id FROM pack_inv WHERE user_id = ? AND type = ? ORDER BY id LIMIT 1)
    RETURNING *`).bind(user.id, String(type)).first();
  if (!row) throw new HttpError(400, "You don't have that pack.");
  const pack = { cards: JSON.parse(row.cards), holo: JSON.parse(row.holo) };
  await db.batch([...cardWrites(db, user.id, pack), bumpProgress(db, user.id, 'packs')]);
  return json({ cards: pack.cards, holo: pack.holo, type: row.type, profile: await profile(db, await freshUser(db, user.id)) });
}
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

async function buyPack(db, user, type = 'cyber') {
  if (!(type in PACK_TYPES)) throw new HttpError(400, 'Unknown pack.');
  if (!PACKS_OPEN.includes(type)) throw new HttpError(400, 'That pack is coming soon.');
  const cost = PACK_COSTS[type] ?? PACK_COST;
  if (user.gold < cost) throw new HttpError(400, `You need ${cost} gold.`);
  const pack = openPack(user.packs_since_legend, type);
  // Guard on gold in the UPDATE so two quick taps can't both spend the same gold.
  const res = await db.prepare(
    'UPDATE users SET gold = gold - ?, packs_since_legend = ? WHERE id = ? AND gold >= ?',
  ).bind(cost, pack.packsSinceLegend, user.id, cost).run();
  if (!res.meta.changes) throw new HttpError(400, `You need ${cost} gold.`);
  await db.batch(packWrites(db, user.id, pack, type));
  return json({ cards: pack.cards, holo: pack.holo, type, profile: await profile(db, await freshUser(db, user.id)) });
}

// Buys one of today's shop cards. The app sends the card too, so a tap just after midnight can't buy a different one.
async function buyShop(req, db, user) {
  const { slot, card } = await body(req);
  const day = dayStart(now());
  const id = dailyShop(day)[slot];
  if (!Number.isInteger(slot) || !id) throw new HttpError(400, 'Unknown shop card.');
  if (id !== card) throw new HttpError(400, 'The shop just changed. Take another look.');
  const price = SHOP_PRICES[BY_ID[id].rarity];
  const claim = await db.prepare('INSERT OR IGNORE INTO shop_buys (user_id, day, slot) VALUES (?, ?, ?)').bind(user.id, day, slot).run();
  if (!claim.meta.changes) throw new HttpError(400, 'You already bought that one today.');
  const paid = await db.prepare('UPDATE users SET gold = gold - ? WHERE id = ? AND gold >= ?').bind(price, user.id, price).run();
  if (!paid.meta.changes) {
    await db.prepare('DELETE FROM shop_buys WHERE user_id = ? AND day = ? AND slot = ?').bind(user.id, day, slot).run();
    throw new HttpError(400, `You need ${price} gold.`);
  }
  await addCard(db, user.id, id).run();
  return json({ card: id, profile: await profile(db, await freshUser(db, user.id)) });
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
  if (prog.cleared >= OPEN_LEVELS) throw new HttpError(400, OPEN_LEVELS < CAMPAIGN.length ? 'The next chapter is coming soon!' : 'You beat the whole campaign!');
  const run = { level: prog.cleared, state: newCampaignBattle(prof.team, prog.cleared, await fusionsFor(db, user.id)) };
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
  const gold = CAMPAIGN_GOLD[CAMPAIGN[level].chapter], xp = CAMPAIGN_XP[CAMPAIGN[level].chapter];
  await db.prepare('UPDATE users SET gold = gold + ?, xp = xp + ? WHERE id = ?').bind(gold, xp, user.id).run();
  const result = { won: true, gold, xp };
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
    const packType = CAMPAIGN[level].pack ?? freePack();
    const pack = openPack(fresh.packs_since_legend, packType);
    await db.batch([...packWrites(db, user.id, pack, packType),
      db.prepare('UPDATE users SET packs_since_legend = ? WHERE id = ?').bind(pack.packsSinceLegend, user.id)]);
    result.pack = pack.cards;
    result.holo = pack.holo;
    result.packType = packType;
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
    invitee: m.status === 'waiting' ? (await db.prepare(
      'SELECT u.username FROM challenges c JOIN users u ON u.id = c.to_id WHERE c.match_id = ?').bind(m.id).first())?.username ?? null : null,
    state: m.state ? JSON.parse(m.state) : null,
  };
}

async function createMatch(db, user) {
  return json(await matchView(db, await openInvite(db, user), user));
}

// A waiting match with a fresh code; any older invite of yours closes.
async function openInvite(db, user) {
  needFullTeam(user);
  await db.prepare("UPDATE matches SET status = 'done', updated = ? WHERE p0 = ? AND status = 'waiting'")
    .bind(now(), user.id).run();  // only one open invite per player
  for (let tries = 0; tries < 5; tries++) {
    const m = await db.prepare(
      "INSERT INTO matches (code, p0, team0, status, updated) VALUES (?, ?, ?, 'waiting', ?) ON CONFLICT (code) DO NOTHING RETURNING *",
    ).bind(makeCode(), user.id, user.team, now()).first();
    if (m) return m;
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
  const state = newBattle(JSON.parse(m.team0), JSON.parse(user.team), Math.random, await fusionsFor(db, m.p0), await fusionsFor(db, user.id));
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
    "SELECT * FROM matches WHERE (p0 = ? OR p1 = ?) AND status IN ('waiting', 'active') AND code NOT LIKE '#%' ORDER BY updated DESC LIMIT 1",
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
    if (m.code.startsWith('#')) await finishRankedMatch(db, m, winnerId);
    else await db.batch([db.prepare('UPDATE users SET gold = gold + ?, xp = xp + ? WHERE id = ?').bind(WIN_GOLD, WIN_XP, winnerId),
      bumpProgress(db, winnerId, 'wins'), questEvent(db, winnerId, 'friend')]);   // forfeits don't count for the quest
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
    if (m.code.startsWith('#')) await finishRankedMatch(db, m, winnerId);
    else await db.batch([db.prepare('UPDATE users SET gold = gold + ?, xp = xp + ? WHERE id = ?').bind(WIN_GOLD, WIN_XP, winnerId),
      bumpProgress(db, winnerId, 'wins')]);
  }
  return json({ ok: true });
}

// ---- social ----
const ONLINE_MS = 5 * 60 * 1000;
const PERSON = `u.id, u.username, u.xp, u.team, p.seen, p.avatar`;
const person = r => ({ name: r.username, level: levelFor(r.xp), avatar: avatarOf(r.avatar, r.team),
  online: !!r.seen && now() - r.seen < ONLINE_MS, seen: r.seen || null });

async function socialView(db, user) {
  const [friends, requests, challenges, trades] = await db.batch([
    db.prepare(`SELECT ${PERSON} FROM friends f JOIN friends g ON g.user_id = f.friend_id AND g.friend_id = f.user_id
      JOIN users u ON u.id = f.friend_id LEFT JOIN presence p ON p.user_id = u.id WHERE f.user_id = ?1`).bind(user.id),
    db.prepare(`SELECT ${PERSON} FROM friends f JOIN users u ON u.id = f.user_id LEFT JOIN presence p ON p.user_id = u.id
      WHERE f.friend_id = ?1 AND NOT EXISTS (SELECT 1 FROM friends g WHERE g.user_id = ?1 AND g.friend_id = f.user_id)
      ORDER BY f.created DESC`).bind(user.id),
    db.prepare(`SELECT m.id AS match_id, m.code, ${PERSON} FROM challenges c JOIN matches m ON m.id = c.match_id AND m.status = 'waiting'
      JOIN users u ON u.id = m.p0 LEFT JOIN presence p ON p.user_id = u.id WHERE c.to_id = ?1 ORDER BY m.updated DESC`).bind(user.id),
    db.prepare(`SELECT t.id AS trade_id, t.from_id, t.give, t.get, t.give_gold, t.get_gold, t.status, ${PERSON} FROM trades t
      JOIN users u ON u.id = CASE WHEN t.from_id = ?1 THEN t.to_id ELSE t.from_id END LEFT JOIN presence p ON p.user_id = u.id
      WHERE ((t.from_id = ?1 OR t.to_id = ?1) AND t.status = 'open') OR (t.from_id = ?1 AND t.status = 'accepted')
      ORDER BY t.created DESC`).bind(user.id),
  ]);
  const list = friends.results.map(person)
    .sort((a, b) => (b.online - a.online) || ((b.seen || 0) - (a.seen || 0)) || a.name.localeCompare(b.name));
  return {
    friends: list,
    requests: requests.results.map(person),
    challenges: challenges.results.map(r => ({ id: r.match_id, code: r.code, ...person(r) })),
    trades: await withFusions(db, trades.results.map(tradeView(user.id))),
  };
}

// ---- trading ----
// Adds each trade's fused copies' levels ({ "12": {h,b,s,x} }) so the app can draw them.
async function withFusions(db, list) {
  const ids = [...new Set(list.flatMap(t => [...t.give, ...t.get]).filter(x => x.includes('#')).map(fusedIdOf))];
  if (!ids.length) return list;
  const rows = (await db.prepare(`SELECT * FROM fused WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results;
  const map = Object.fromEntries(rows.map(r => [String(r.id), fusedView(r)]));
  return list.map(t => ({ ...t, fusions: map }));
}
// A trade seen by `me`: `mine` = I sent it; give/get are always from my side.
const tradeView = me => r => {
  const mine = r.from_id === me, give = JSON.parse(r.give), get = JSON.parse(r.get);
  return { id: r.trade_id, mine, status: r.status, ...person(r),
    give: mine ? give : get, get: mine ? get : give, giveGold: mine ? r.give_gold : r.get_gold, getGold: mine ? r.get_gold : r.give_gold };
};
// Trade items: "apex" is a plain copy, "apex#12" is fused copy 12 (it keeps its fusion when traded).
const cardOf = tok => tok.split('#')[0];
const fusedIdOf = tok => (tok.includes('#') ? Number(tok.split('#')[1]) : null);
// What a player can trade: plain copies beyond the fused ones, and their fused copies; one copy of each team card stays
// (ignoreTeam: what they could trade once they change their team).
async function tradeable(db, u, ignoreTeam = false) {
  const team = ignoreTeam ? [] : JSON.parse(u.team);
  const rows = (await db.prepare('SELECT card_id, count FROM collection WHERE user_id = ?').bind(u.id).all()).results;
  const fused = await fusedRows(db, u.id);
  const plain = {}, total = {};
  for (const r of rows) {
    const nf = fused.filter(f => f.card_id === r.card_id).length;
    total[r.card_id] = r.count - (team.includes(r.card_id) ? 1 : 0);
    const n = Math.min(r.count - nf, total[r.card_id]);
    if (n > 0) plain[r.card_id] = n;
  }
  return { plain, total, fused };
}
const covers = (t, toks) => {
  const plain = {}, all = {};
  for (const tok of toks) {
    const c = cardOf(tok), fid = fusedIdOf(tok);
    if (fid !== null && !t.fused.some(f => f.id === fid && f.card_id === c)) return false;
    if (fid === null) plain[c] = (plain[c] || 0) + 1;
    all[c] = (all[c] || 0) + 1;
  }
  return new Set(toks.filter(x => x.includes('#'))).size === toks.filter(x => x.includes('#')).length
    && Object.entries(plain).every(([c, n]) => (t.plain[c] || 0) >= n)
    && Object.entries(all).every(([c, n]) => (t.total[c] || 0) >= n);
};
const tradeSide = (cards, gold) => {
  if (!Array.isArray(cards) || cards.length > 3 || !cards.every(t => typeof t === 'string' && BY_ID[cardOf(t)] && (!t.includes('#') || Number.isInteger(fusedIdOf(t)))))
    throw new HttpError(400, 'Pick up to 3 cards each side.');
  const g = Number(gold ?? 0);
  if (!Number.isInteger(g) || g < 0 || g > 1e7) throw new HttpError(400, 'That gold amount is not valid.');
  return [cards, g];
};
async function friendByName(db, user, name) {
  const other = await db.prepare('SELECT * FROM users WHERE username = ?').bind(String(name).trim()).first();
  if (!other || !(await areFriends(db, user.id, other.id))) throw new HttpError(404, 'You can only trade with friends.');
  return other;
}
// Accepted: the accepter got their side at once; the sender's side waits here until they claim it.
async function claimTrade(req, db, user) {
  const { id } = await body(req);
  const t = await db.prepare("SELECT * FROM trades WHERE id = ? AND from_id = ? AND status = 'accepted'").bind(Number(id), user.id).first();
  if (!t) throw new HttpError(404, 'Nothing to claim.');
  const claim = await db.prepare("UPDATE trades SET status = 'done' WHERE id = ? AND status = 'accepted'").bind(t.id).run();
  if (!claim.meta.changes) throw new HttpError(404, 'Nothing to claim.');
  const get = JSON.parse(t.get), other = await freshUser(db, t.to_id);
  await batch(db, handTo(db, user.id, get, t.get_gold));
  return json({ received: get.map(cardOf), gold: t.get_gold, from: other?.username ?? 'your friend',
    social: await socialView(db, user), profile: await profile(db, await freshUser(db, user.id)) });
}

// Both players' tradeable cards, for building an offer.
async function tradeCards(db, user, name) {
  const other = await friendByName(db, user, name);
  const mine = await tradeable(db, user), theirs = await tradeable(db, other, true);   // you may ask for their team cards; they'd have to swap them out to accept
  return json({ mine: mine.plain, theirs: theirs.plain, mineFused: mine.fused.map(fusedView), theirsFused: theirs.fused.map(fusedView), gold: user.gold });
}
// While an offer is open the sender's side is held: those cards leave their collection (fused copies go to user 0) and the gold
// leaves their balance. Declined, cancelled or countered offers hand it all back.
const holdOut = (db, uid, toks) => [
  ...toks.map(tok => db.prepare('UPDATE collection SET count = count - 1 WHERE user_id = ? AND card_id = ?').bind(uid, cardOf(tok))),
  ...toks.filter(tok => tok.includes('#')).map(tok => db.prepare('UPDATE fused SET user_id = 0 WHERE id = ? AND user_id = ?').bind(fusedIdOf(tok), uid)),
  db.prepare('DELETE FROM collection WHERE count <= 0 AND user_id = ?').bind(uid)];
const handTo = (db, uid, toks, gold = 0) => [
  ...toks.map(tok => addCard(db, uid, cardOf(tok))),
  ...toks.filter(tok => tok.includes('#')).map(tok => db.prepare('UPDATE fused SET user_id = ? WHERE id = ? AND user_id = 0').bind(uid, fusedIdOf(tok))),
  ...(gold ? [db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').bind(gold, uid)] : [])];
const giveBack = (db, t) => handTo(db, t.from_id, JSON.parse(t.give), t.give_gold);
const batch = (db, writes) => (writes.length ? db.batch(writes) : null);   // D1 refuses an empty batch

async function offerTrade(req, db, user) {
  const b = await body(req);
  const other = await friendByName(db, user, b.to ?? '');
  const [give, giveGold] = tradeSide(b.give ?? [], b.giveGold);
  const [get, getGold] = tradeSide(b.get ?? [], b.getGold);
  if (!give.length && !get.length && !giveGold && !getGold) throw new HttpError(400, 'Add something to the trade.');
  // a counter offer answers one of theirs: what they put in it is held, so count it as theirs again
  const old = b.counter ? await db.prepare("SELECT * FROM trades WHERE id = ? AND to_id = ? AND from_id = ? AND status = 'open'")
    .bind(Number(b.counter), user.id, other.id).first() : null;
  const theirs = await tradeable(db, other, true);
  if (old) {
    const held = JSON.parse(old.give);
    for (const tok of held) {
      const c = cardOf(tok);
      theirs.total[c] = (theirs.total[c] || 0) + 1;
      if (!tok.includes('#')) theirs.plain[c] = (theirs.plain[c] || 0) + 1;
    }
    const ids = held.filter(tok => tok.includes('#')).map(fusedIdOf);
    if (ids.length) theirs.fused.push(...(await db.prepare(`SELECT * FROM fused WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results);
  }
  if (!covers(await tradeable(db, user), give)) throw new HttpError(400, "You don't have spare copies of those cards.");
  if (!covers(theirs, get)) throw new HttpError(400, `${other.username} doesn't have spare copies of those cards.`);
  const paid = await db.prepare('UPDATE users SET gold = gold - ? WHERE id = ? AND gold >= ?').bind(giveGold, user.id, giveGold).run();
  if (!paid.meta.changes) throw new HttpError(400, "You don't have that much gold.");
  const writes = [db.prepare('INSERT INTO trades (from_id, to_id, give, get, give_gold, get_gold, status, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(user.id, other.id, JSON.stringify(give), JSON.stringify(get), giveGold, getGold, 'open', now()), ...holdOut(db, user.id, give)];
  // the counter closes the offer it answers and hands its sender back what they put in
  if (old) {
    const closed = await db.prepare("UPDATE trades SET status = 'countered' WHERE id = ? AND status = 'open'").bind(old.id).run();
    if (closed.meta.changes) writes.push(...giveBack(db, old));
  }
  await db.batch(writes);
  return json({ message: `Trade offer sent to ${other.username}.`, social: await socialView(db, user) });
}
async function answerTrade(req, db, user, action) {
  const { id } = await body(req);
  const t = await db.prepare("SELECT * FROM trades WHERE id = ? AND status = 'open'").bind(Number(id)).first();
  if (!t || (action === 'cancel' ? t.from_id : t.to_id) !== user.id) throw new HttpError(404, 'That trade is no longer open.');
  const status = { cancel: 'cancelled', decline: 'declined', accept: 'accepted' }[action];
  // close it first so it can only be answered once
  const closed = await db.prepare('UPDATE trades SET status = ? WHERE id = ? AND status = ?').bind(status, t.id, 'open').run();
  if (!closed.meta.changes) throw new HttpError(404, 'That trade is no longer open.');
  if (action !== 'accept') {
    await batch(db, giveBack(db, t));
    return json({ message: null, social: await socialView(db, user) });
  }
  const from = await freshUser(db, t.from_id), give = JSON.parse(t.give), get = JSON.parse(t.get);
  const fail = msg => db.prepare("UPDATE trades SET status = 'open' WHERE id = ?").bind(t.id).run().then(() => { throw new HttpError(400, msg); });
  if (!covers(await tradeable(db, user), get)) {
    const team = JSON.parse(user.team);
    const blocked = covers(await tradeable(db, user, true), get) && get.map(cardOf).find(c => team.includes(c));
    await fail(blocked ? `Can't accept: ${BY_ID[blocked].name} is on your team. Take it off your team first.` : 'You no longer have everything this offer asks for.');
  }
  if (user.gold < t.get_gold) await fail("You don't have the gold this offer asks for.");
  // I get their held side now; mine is held for them until they claim it from the Social tab
  await db.batch([...handTo(db, user.id, give, t.give_gold), ...holdOut(db, user.id, get),
    db.prepare('UPDATE users SET gold = gold - ? WHERE id = ?').bind(t.get_gold, user.id)]);
  return json({ message: null, received: give.map(cardOf), gold: t.give_gold, from: from.username,
    social: await socialView(db, user), profile: await profile(db, await freshUser(db, user.id)) });
}

async function otherUser(req, db, user) {
  const { name = '' } = await body(req);
  const other = await db.prepare('SELECT * FROM users WHERE username = ?').bind(String(name).trim()).first();
  if (!other) throw new HttpError(404, `No player called "${String(name).trim()}".`);
  if (other.id === user.id) throw new HttpError(400, "That's you!");
  return other;
}

const areFriends = async (db, a, b) => (await db.prepare(
  'SELECT COUNT(*) AS n FROM friends WHERE (user_id = ?1 AND friend_id = ?2) OR (user_id = ?2 AND friend_id = ?1)').bind(a, b).first()).n === 2;

// Sends a request, or accepts theirs if they already asked you.
async function addFriend(req, db, user) {
  const other = await otherUser(req, db, user);
  if (await areFriends(db, user.id, other.id)) throw new HttpError(400, `You're already friends with ${other.username}.`);
  await db.prepare('INSERT INTO friends (user_id, friend_id, created) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .bind(user.id, other.id, now()).run();
  const message = await areFriends(db, user.id, other.id)
    ? `You and ${other.username} are now friends.` : `Friend request sent to ${other.username}.`;
  return json({ message, social: await socialView(db, user) });
}

// Unfriend, or ignore their request.
async function removeFriend(req, db, user) {
  const other = await otherUser(req, db, user);
  await db.prepare('DELETE FROM friends WHERE (user_id = ?1 AND friend_id = ?2) OR (user_id = ?2 AND friend_id = ?1)')
    .bind(user.id, other.id).run();
  return json({ message: null, social: await socialView(db, user) });
}

async function challengeFriend(req, db, user) {
  const other = await otherUser(req, db, user);
  if (!await areFriends(db, user.id, other.id)) throw new HttpError(400, `Add ${other.username} as a friend first.`);
  if (JSON.parse(other.team).length < 3) throw new HttpError(400, `${other.username} can battle once they clear campaign level 6.`);
  const m = await openInvite(db, user);
  await db.prepare('INSERT INTO challenges (match_id, to_id) VALUES (?, ?)').bind(m.id, other.id).run();
  return json(await matchView(db, m, user));
}

async function declineChallenge(req, db, user) {
  const { id } = await body(req);
  const c = await db.prepare('SELECT * FROM challenges WHERE match_id = ? AND to_id = ?').bind(Number(id), user.id).first();
  if (c) {
    await db.batch([db.prepare("UPDATE matches SET status = 'done', updated = ? WHERE id = ? AND status = 'waiting'").bind(now(), c.match_id),
      db.prepare('DELETE FROM challenges WHERE match_id = ?').bind(c.match_id)]);
  }
  return json({ message: null, social: await socialView(db, user) });
}

// Daily spin: the server picks the slot; the app spins the wheel to land on it.
async function spin(db, user) {
  const t = now();
  // claim today's spin first so two quick taps can't both win
  const res = await db.prepare(`INSERT INTO spins (user_id, last) VALUES (?1, ?2)
    ON CONFLICT (user_id) DO UPDATE SET last = ?2 WHERE spins.last < ?3`).bind(user.id, t, dayStart(t)).run();
  if (!res.meta.changes) throw new HttpError(400, 'You already spun today. Come back tomorrow!');
  const slot = spinWheel();
  const prize = SPIN_SLOTS[slot];
  let cards = null;
  if (prize.kind === 'gold') await db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').bind(prize.amount, user.id).run();
  if (prize.kind === 'xp') await db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').bind(prize.amount, user.id).run();
  let packType = null, holo = null;
  if (prize.kind === 'pack') {
    packType = dailyPack(t);
    const pack = openPack(user.packs_since_legend, packType);
    await db.batch([...packWrites(db, user.id, pack, packType),
      db.prepare('UPDATE users SET packs_since_legend = ? WHERE id = ?').bind(pack.packsSinceLegend, user.id)]);
    cards = pack.cards; holo = pack.holo;
  }
  return json({ slot, kind: prize.kind, amount: prize.amount, cards, holo, packType, profile: await profile(db, await freshUser(db, user.id)) });
}

// Someone's public card, shown when you tap a friend request. Only between people linked by a request or friendship.
async function playerCard(db, user, name) {
  const other = await db.prepare('SELECT * FROM users WHERE username = ?').bind(name).first();
  const linked = other && await db.prepare(
    'SELECT 1 FROM friends WHERE (user_id = ?1 AND friend_id = ?2) OR (user_id = ?2 AND friend_id = ?1)').bind(user.id, other.id).first();
  if (!linked) throw new HttpError(404, 'Player not found.');
  const p = await profile(db, other);
  return json({
    name: p.username, level: p.level, avatar: p.avatar, since: p.since, wins: p.wins, team: p.team,
    cards: Object.keys(p.collection).length,
    campaign: p.campaign.next ? `Ch ${p.campaign.chapterNum} · ${p.campaign.next.num}` : 'Done',
  });
}

async function setAvatar(req, db, user) {
  const { card = '' } = await body(req);
  if (!await db.prepare('SELECT 1 FROM collection WHERE user_id = ? AND card_id = ?').bind(user.id, String(card)).first()) {
    throw new HttpError(400, "You don't own that card.");
  }
  await db.prepare('INSERT INTO presence (user_id, avatar) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET avatar = excluded.avatar')
    .bind(user.id, String(card)).run();
  return json(await profile(db, user));
}

// ---- ranked ----
// ranked row per player: rank (0-7), week (the Monday the points belong to), points, best (highest rank this season),
// run (a fight against a real player's team played by the computer), moved (last week's result, shown once),
// reward (last season's reward, waiting to be claimed). Players without a row are Rookies on 0.
const rankedRow = async (db, userId) => await db.prepare('SELECT * FROM ranked WHERE user_id = ?').bind(userId).first()
  ?? { user_id: userId, rank: 0, week: weekStart(now()), points: 0, best: 0, run: null, moved: null, reward: null };
const weekPoints = (r, week) => (r.week === week ? r.points : 0);

// Week and season changes, done once by whoever asks first. Everyone is in the standings, played or not.
async function rankedRollover(db) {
  const t = now(), week = weekStart(t), season = seasonOf(t);
  const meta = await db.prepare("SELECT (SELECT v FROM ranked_meta WHERE k = 'week') AS week, (SELECT v FROM ranked_meta WHERE k = 'season') AS season").first();
  if (meta.week === null) {   // first run: start counting from this week
    await db.batch([db.prepare("INSERT OR IGNORE INTO ranked_meta (k, v) VALUES ('week', ?)").bind(week),
      db.prepare("INSERT OR IGNORE INTO ranked_meta (k, v) VALUES ('season', ?)").bind(season)]);
    return;
  }
  for (let w = meta.week; w < week; w += WEEK_MS) {
    const claim = await db.prepare("UPDATE ranked_meta SET v = ? WHERE k = 'week' AND v = ?").bind(w + WEEK_MS, w).run();
    if (!claim.meta.changes) return;   // someone else is doing it
    const { results } = await db.prepare('SELECT u.id, u.username, r.rank, r.week, r.points, r.best FROM users u LEFT JOIN ranked r ON r.user_id = u.id').all();
    const byRank = {};
    for (const u of results) (byRank[u.rank ?? 0] ??= []).push({ id: u.id, name: u.username, points: u.week === w ? u.points : 0, best: u.best ?? 0 });
    const writes = [];
    for (const [rank, real] of Object.entries(byRank)) {
      for (const r of rankTable(real, w, Number(rank), w + WEEK_MS).filter(x => !x.bot)) {
        const to = Math.max(0, Math.min(RANKS.length - 1, Number(rank) + rankMove(r.place)));
        writes.push(db.prepare(`INSERT INTO ranked (user_id, rank, week, points, best, moved) VALUES (?1, ?2, ?3, 0, ?4, ?5)
          ON CONFLICT (user_id) DO UPDATE SET rank = ?2, week = ?3, points = 0, best = MAX(best, ?2), moved = ?5`)
          .bind(r.id, to, w + WEEK_MS, Math.max(r.best, to), JSON.stringify({ place: r.place, from: Number(rank), to, points: r.points })));
      }
    }
    for (let i = 0; i < writes.length; i += 50) await db.batch(writes.slice(i, i + 50));
  }
  if (meta.season < season) {
    const claim = await db.prepare("UPDATE ranked_meta SET v = ? WHERE k = 'season' AND v = ?").bind(season, meta.season).run();
    if (!claim.meta.changes) return;
    // last season's reward for everyone, by the best rank they reached; then everyone drops 2 ranks
    await db.batch([
      db.prepare(`INSERT INTO ranked (user_id, rank, week, points, best, reward)
        SELECT id, 0, ?1, 0, 0, json_object('season', ?2, 'rank', 0) FROM users WHERE id NOT IN (SELECT user_id FROM ranked)`).bind(week, meta.season),
      db.prepare(`UPDATE ranked SET reward = json_object('season', ?1, 'rank', MAX(best, rank)), rank = MAX(0, rank - 2), best = MAX(0, rank - 2)`).bind(meta.season),
    ]);
  }
}

async function rankedView(db, user) {
  await rankedRollover(db);
  const t = now(), week = weekStart(t), me = await rankedRow(db, user.id);
  const { results } = await db.prepare(`SELECT u.id, u.username AS name, COALESCE(r.rank, 0) AS rank, r.week, r.points
    FROM users u LEFT JOIN ranked r ON r.user_id = u.id WHERE COALESCE(r.rank, 0) = ?`).bind(me.rank).all();
  const table = rankTable(results.map(r => ({ id: r.id, name: r.name, points: r.week === week ? r.points : 0 })), week, me.rank, t)
    .map(r => ({ place: r.place, name: r.name, points: r.points, me: r.id === user.id, bot: r.bot }));
  const live = await db.prepare("SELECT id FROM matches WHERE (p0 = ?1 OR p1 = ?1) AND status = 'active' AND code LIKE '#%' LIMIT 1").bind(user.id).first();
  const reward = me.reward && JSON.parse(me.reward);
  return {
    rank: me.rank, ranks: RANKS, rewards: RANK_REWARDS.map(([gold, pack]) => ({ gold, pack })),
    points: weekPoints(me, week), place: table.find(r => r.me).place, table,
    weekEnds: week + WEEK_MS, season: seasonOf(t) + 1, seasonEnds: seasonEnd(seasonOf(t)), best: me.best,
    run: me.run ? JSON.parse(me.run) : null, liveMatch: live?.id ?? null,
    moved: me.moved ? JSON.parse(me.moved) : null,
    reward: reward ? { season: reward.season + 1, rank: reward.rank, gold: RANK_REWARDS[reward.rank][0], pack: RANK_REWARDS[reward.rank][1] } : null,
  };
}

// What the Play tab's Ranked row shows.
async function rankedTile(db, user) {
  const v = await rankedView(db, user);
  return { rank: v.rank, name: RANKS[v.rank], place: v.place, points: v.points, weekEnds: v.weekEnds, alert: !!(v.moved || v.reward) };
}

// A ranked win or loss: week points, and gold + XP for a win.
function rankedResult(db, me, won, week) {
  const points = Math.max(0, weekPoints(me, week) + (won ? RANKED_WIN : -RANKED_LOSS));
  const writes = [db.prepare(`INSERT INTO ranked (user_id, rank, week, points, best) VALUES (?1, ?2, ?3, ?4, ?2)
    ON CONFLICT (user_id) DO UPDATE SET week = ?3, points = ?4, run = NULL`).bind(me.user_id, me.rank, week, points)];
  if (won) writes.push(db.prepare('UPDATE users SET gold = gold + ?, xp = xp + ? WHERE id = ?').bind(RANKED_GOLD, RANKED_XP, me.user_id),
    bumpProgress(db, me.user_id, 'wins'));
  return { writes, delta: won ? RANKED_WIN : -Math.min(RANKED_LOSS, weekPoints(me, week)), points };
}

// Live ranked matches are friend-battle matches whose code starts with '#'; they pay out here instead.
async function finishRankedMatch(db, m, winnerId) {
  await rankedRollover(db);
  const week = weekStart(now()), writes = [];
  for (const id of [m.p0, m.p1]) writes.push(...rankedResult(db, await rankedRow(db, id), id === winnerId, week).writes);
  await db.batch(writes);
}

// Find a match: pair with someone else searching right now, otherwise keep waiting (the app asks again every few seconds).
async function rankedSearch(db, user) {
  needFullTeam(user);
  await rankedRollover(db);
  const view = await rankedView(db, user);
  if (view.liveMatch || view.run) return json({ view });
  await db.prepare('DELETE FROM ranked_queue WHERE since < ?').bind(now() - 20000).run();
  const other = await db.prepare('SELECT q.user_id, u.team FROM ranked_queue q JOIN users u ON u.id = q.user_id WHERE q.user_id != ? ORDER BY q.since LIMIT 1').bind(user.id).first();
  if (other) {
    const claimed = await db.prepare('DELETE FROM ranked_queue WHERE user_id = ?').bind(other.user_id).run();
    if (claimed.meta.changes) {
      const state = newBattle(JSON.parse(other.team), JSON.parse(user.team), Math.random, await fusionsFor(db, other.user_id), await fusionsFor(db, user.id));
      await db.batch([db.prepare('DELETE FROM ranked_queue WHERE user_id = ?').bind(user.id),
        db.prepare("INSERT INTO matches (code, p0, p1, team0, state, status, updated) VALUES (?, ?, ?, ?, ?, 'active', ?)")
          .bind('#' + makeCode() + makeCode(), other.user_id, user.id, other.team, JSON.stringify(state), now())]);
      return json({ view: await rankedView(db, user) });
    }
  }
  await db.prepare('INSERT INTO ranked_queue (user_id, since) VALUES (?1, ?2) ON CONFLICT (user_id) DO UPDATE SET since = ?2').bind(user.id, now()).run();
  return json({ view, searching: true });
}

async function rankedCancel(db, user) {
  await db.prepare('DELETE FROM ranked_queue WHERE user_id = ?').bind(user.id).run();
  return json({ ok: true });
}

// Nobody to play live: face a computer player, or a real player's team (nearest rank first) played by the computer.
async function rankedGhost(db, user) {
  needFullTeam(user);
  await db.prepare('DELETE FROM ranked_queue WHERE user_id = ?').bind(user.id).run();
  const view = await rankedView(db, user);
  if (view.liveMatch || view.run) return json({ view });
  const me = await rankedRow(db, user.id);
  const { results } = await db.prepare(`SELECT u.id, u.username, u.team, COALESCE(r.rank, 0) AS rank, p.avatar FROM users u
    LEFT JOIN ranked r ON r.user_id = u.id LEFT JOIN presence p ON p.user_id = u.id WHERE u.id != ?`).bind(user.id).all();
  const pool = results.filter(u => JSON.parse(u.team).length >= 3).sort((a, b) => Math.abs(a.rank - me.rank) - Math.abs(b.rank - me.rank));
  const near = pool.filter(u => Math.abs(u.rank - pool[0]?.rank) === 0);
  // With only a few players around, mostly face computer players so you're not always fighting the same team.
  const pick = Math.random() < Math.max(0.5, 1 - pool.length / 10) ? null : near[Math.floor(Math.random() * near.length)];
  const opp = pick
    ? { name: pick.username, rank: pick.rank, team: JSON.parse(pick.team), avatar: avatarOf(pick.avatar, pick.team), fus: await fusionsFor(db, pick.id) }
    : { name: botName(), rank: me.rank, team: rankedTeam(me.rank), avatar: null, fus: {}, bot: true };
  if (opp.bot) opp.fus = rankedFusions(me.rank, opp.team);
  opp.avatar ??= opp.team[0];
  // you move first (like the Gauntlet), so no computer move happens before the board is on screen
  const run = { opp, state: newBattle(JSON.parse(user.team), opp.team, () => 0, await fusionsFor(db, user.id), opp.fus) };
  await db.prepare(`INSERT INTO ranked (user_id, rank, week, points, best, run) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT (user_id) DO UPDATE SET run = ?6`).bind(user.id, me.rank, me.week, me.points, me.best, JSON.stringify(run)).run();
  return json({ view: await rankedView(db, user) });
}

async function rankedMove(req, db, user) {
  await rankedRollover(db);
  const me = await rankedRow(db, user.id);
  const run = me.run && JSON.parse(me.run);
  if (!run) throw new HttpError(400, 'No ranked fight in progress.');
  const { from, move: kind, to } = await body(req);
  try {
    applyMove(run.state, 0, from, kind, to);
    while (run.state.winner === null && run.state.turn === 1) { const m = aiMove(run.state, 1); applyMove(run.state, 1, m.from, m.move, m.to); }
  } catch (e) { throw new HttpError(400, e.message); }
  if (run.state.winner === null) {
    const res = await db.prepare('UPDATE ranked SET run = ? WHERE user_id = ? AND run = ?').bind(JSON.stringify(run), user.id, me.run).run();
    if (!res.meta.changes) throw new HttpError(409, 'The fight changed. Refreshing.');
    return json({ state: run.state, result: null, profile: null });
  }
  return json({ state: run.state, ...(await endRankedRun(db, user, me, run.state.winner === 0)) });
}

async function endRankedRun(db, user, me, won) {
  const claim = await db.prepare('UPDATE ranked SET run = NULL WHERE user_id = ? AND run = ?').bind(user.id, me.run).run();   // claim first: no double pay
  if (!claim.meta.changes) throw new HttpError(409, 'The fight changed. Refreshing.');
  const before = (await rankedView(db, user)).place;
  const r = rankedResult(db, me, won, weekStart(now()));
  await db.batch(r.writes);
  const view = await rankedView(db, user);
  return { result: { won, delta: r.delta, points: r.points, from: before, place: view.place, gold: won ? RANKED_GOLD : 0, xp: won ? RANKED_XP : 0 },
    view, profile: await profile(db, await freshUser(db, user.id)) };
}

// Giving up a ranked fight counts as a loss.
async function rankedLeave(db, user) {
  const me = await rankedRow(db, user.id);
  if (!me.run) return json({ result: null });
  return json(await endRankedRun(db, user, me, false));
}

async function rankedSeen(db, user) {
  await db.prepare('UPDATE ranked SET moved = NULL WHERE user_id = ?').bind(user.id).run();
  return json({ ok: true });
}

// Last season's reward: gold, and a pack for Elite and up.
async function rankedClaim(db, user) {
  const view = await rankedView(db, user);
  if (!view.reward) throw new HttpError(400, 'No season reward to claim.');
  const res = await db.prepare('UPDATE ranked SET reward = NULL WHERE user_id = ? AND reward IS NOT NULL').bind(user.id).run();
  if (!res.meta.changes) throw new HttpError(400, 'Already claimed.');
  const writes = [db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').bind(view.reward.gold, user.id)];
  let pack = null;
  if (view.reward.pack) {
    pack = openPack(user.packs_since_legend, view.reward.pack);
    writes.push(...packWrites(db, user.id, pack, view.reward.pack), db.prepare('UPDATE users SET packs_since_legend = ? WHERE id = ?').bind(pack.packsSinceLegend, user.id));
  }
  await db.batch(writes);
  return json({ cards: pack?.cards ?? null, holo: pack?.holo ?? null, type: view.reward.pack, gold: view.reward.gold,
    profile: await profile(db, await freshUser(db, user.id)) });
}

// ---- legend hunt ----
// One try per 8-hour hunt. hunts.day = the start of the hunt (ms) the try belongs to.
const getHunt = (db, userId) => db.prepare('SELECT * FROM hunts WHERE user_id = ?').bind(userId).first();
const huntView = (h, period) => {
  const now = h && h.day === period;
  return { ...huntFoes(period), status: !now ? 'ready' : h.state ? 'playing' : h.result,
    state: now && h.state ? JSON.parse(h.state) : null, next: period + HUNT_MS };
};

async function huntHome(db, user) {
  return json(huntView(await getHunt(db, user.id), huntStart(now())));
}

// Uses this hunt's try. A fight already on picks up where it was.
async function startHunt(db, user) {
  const period = huntStart(now()), h = await getHunt(db, user.id);
  if (h && h.day === period) {
    if (h.state) return json(huntView(h, period));
    throw new HttpError(400, 'You already hunted this one. A new legend appears soon.');
  }
  const team = JSON.parse(user.team);
  if (team.length < 3) throw new HttpError(400, 'Clear campaign level 6 to hunt legends.');
  const foes = huntFoes(period);
  const state = JSON.stringify(huntBattle(team, foes, await fusionsFor(db, user.id)));
  const res = await db.prepare(`INSERT INTO hunts (user_id, day, legend, state, result) VALUES (?1, ?2, ?3, ?4, NULL)
    ON CONFLICT (user_id) DO UPDATE SET day = ?2, legend = ?3, state = ?4, result = NULL WHERE hunts.day < ?2`)
    .bind(user.id, period, foes.legend, state).run();
  if (!res.meta.changes) throw new HttpError(409, 'The hunt changed. Refreshing.');
  return json(huntView(await getHunt(db, user.id), period));
}

// Saves the fight (or ends it) only if nobody else changed it first, so a double-submit can't pay twice.
async function saveHunt(db, userId, old, state, result) {
  const res = await db.prepare('UPDATE hunts SET state = ?, result = ? WHERE user_id = ? AND day = ? AND state = ?')
    .bind(state && JSON.stringify(state), result, userId, old.day, old.state).run();
  if (!res.meta.changes) throw new HttpError(409, 'The hunt changed. Refreshing.');
}

// A fight started in one hunt can be finished after the next one begins.
async function huntMove(req, db, user) {
  const h = await getHunt(db, user.id);
  if (!h || !h.state) throw new HttpError(400, 'No hunt in progress.');
  const state = JSON.parse(h.state);
  const { from, move: kind, to } = await body(req);
  try {
    applyMove(state, 0, from, kind, to);
    while (state.winner === null && state.turn === 1) {
      const m = aiMove(state, 1);
      applyMove(state, 1, m.from, m.move, m.to);
    }
  } catch (e) { throw new HttpError(400, e.message); }
  if (state.winner === null) {
    await saveHunt(db, user.id, h, state, null);
    return json({ legend: h.legend, state, result: null, profile: null });
  }
  if (state.winner === 1) {
    await saveHunt(db, user.id, h, null, 'lost');
    return json({ legend: h.legend, state, result: { won: false }, profile: await profile(db, await freshUser(db, user.id)) });
  }
  await saveHunt(db, user.id, h, null, 'won');   // claim the win first
  const pack = huntPack(user.packs_since_legend, h.legend);
  await db.batch([...packWrites(db, user.id, pack, 'overload'),
    db.prepare('UPDATE users SET packs_since_legend = ?, gold = gold + ?, xp = xp + ? WHERE id = ?')
      .bind(pack.packsSinceLegend, HUNT_GOLD, HUNT_XP, user.id),
    bumpProgress(db, user.id, 'wins'), questEvent(db, user.id, 'hunt')]);
  return json({ legend: h.legend, state, result: { won: true, pack: pack.cards, holo: pack.holo, packType: 'overload', gold: HUNT_GOLD, xp: HUNT_XP },
    profile: await profile(db, await freshUser(db, user.id)) });
}

// Giving up mid-fight uses up the try.
async function leaveHunt(db, user) {
  const h = await getHunt(db, user.id);
  if (h && h.state) await saveHunt(db, user.id, h, null, 'lost');
  return json({ profile: await profile(db, await freshUser(db, user.id)) });
}

// ---- gauntlet ----
// run: { team, hp, fight (the fight in progress or up next), wins, gold, packs, enemies, state (null between fights) }
const getGauntlet = async (db, userId) =>
  await db.prepare('SELECT * FROM gauntlet WHERE user_id = ?').bind(userId).first() ?? { best: 0, run: null };
const gauntletView = run => run && { ...run, nextGold: gauntletGold(run.fight),
  nextPack: Math.ceil((run.wins + 1) / GAUNTLET_PACK_EVERY) * GAUNTLET_PACK_EVERY };

async function saveGauntlet(db, userId, oldRun, run, best) {
  const res = await db.prepare(`INSERT INTO gauntlet (user_id, best, run) VALUES (?1, ?2, ?3)
    ON CONFLICT (user_id) DO UPDATE SET best = MAX(best, ?2), run = ?3 WHERE run IS ?4`)
    .bind(userId, best, run && JSON.stringify(run), oldRun).run();
  if (!res.meta.changes) throw new HttpError(409, 'The run changed. Refreshing.');
}

async function gauntletHome(db, user) {
  const g = await getGauntlet(db, user.id);
  return json({ best: g.best, run: gauntletView(JSON.parse(g.run)), top: (await leaderboard(db, user, 'friends')).slice(0, 3) });
}

async function startGauntlet(db, user) {
  const g = await getGauntlet(db, user.id);
  if (g.run) return json(gauntletView(JSON.parse(g.run)));   // already running: pick it up
  if (JSON.parse(user.team).length < 3) throw new HttpError(400, 'Clear campaign level 6 to play the Gauntlet.');
  const team = JSON.parse(user.team), fus = await fusionsFor(db, user.id);
  const hp = team.map(id => fusedHp(id, fus[id]));
  const enemies = gauntletEnemies(1);
  const run = { team, hp, fus, fight: 1, wins: 0, gold: 0, packs: 0, startBest: g.best, enemies, state: gauntletBattle(team, hp, enemies, fus) };
  await saveGauntlet(db, user.id, g.run, run, g.best);
  return json(gauntletView(run));
}

async function nextGauntletFight(db, user) {
  const g = await getGauntlet(db, user.id);
  const run = JSON.parse(g.run);
  if (!run) throw new HttpError(400, 'No Gauntlet run in progress.');
  if (!run.state) {
    run.state = gauntletBattle(run.team, run.hp, run.enemies, run.fus || {});
    await saveGauntlet(db, user.id, g.run, run, g.best);
  }
  return json(gauntletView(run));
}

// The run ends (lost or quit): bank the streak. The final state is kept in the reply so the last hits can play out.
async function endGauntlet(db, user, g, run) {
  await saveGauntlet(db, user.id, g.run, null, run.wins);
  return { streak: run.wins, newBest: run.wins > (run.startBest ?? g.best), gold: run.gold, packs: run.packs,
    rank: (await leaderboard(db, user, 'friends')).find(r => r.me)?.rank ?? 1 };
}

async function gauntletMove(req, db, user) {
  const g = await getGauntlet(db, user.id);
  const run = JSON.parse(g.run);
  if (!run?.state) throw new HttpError(400, 'No Gauntlet fight in progress.');
  const { from, move: kind, to } = await body(req);
  try {
    applyMove(run.state, 0, from, kind, to);
    while (run.state.winner === null && run.state.turn === 1) {
      const m = aiMove(run.state, 1);
      applyMove(run.state, 1, m.from, m.move, m.to);
    }
  } catch (e) { throw new HttpError(400, e.message); }

  const view = gauntletView(run);
  if (run.state.winner === 1) {
    const over = await endGauntlet(db, user, g, run);
    return json({ run: view, result: { won: false, ...over }, profile: await profile(db, await freshUser(db, user.id)) });
  }
  if (run.state.winner === null) {
    await saveGauntlet(db, user.id, g.run, run, g.best);
    return json({ run: view, result: null, profile: null });
  }
  // won: pay out, heal, line up the next fight
  const gold = gauntletGold(run.fight);
  const next = { ...run, wins: run.wins + 1, gold: run.gold + gold, fight: run.fight + 1,
    hp: gauntletHeal(run.state.teams[0]), enemies: gauntletEnemies(run.fight + 1), state: null };
  let pack = null, packType = null, holo = null;
  const writes = [db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').bind(gold, user.id), bumpProgress(db, user.id, 'wins'),
    questEvent(db, user.id, 'streak', next.wins, true)];
  if (next.wins % GAUNTLET_PACK_EVERY === 0) {
    packType = freePack();
    const opened = openPack(user.packs_since_legend, packType);
    pack = opened.cards; holo = opened.holo;
    next.packs++;
    writes.push(...packWrites(db, user.id, opened, packType),
      db.prepare('UPDATE users SET packs_since_legend = ? WHERE id = ?').bind(opened.packsSinceLegend, user.id));
  }
  await saveGauntlet(db, user.id, g.run, next, next.wins);   // claim the win first so a double-submit can't pay twice
  await db.batch(writes);
  return json({ run: { ...view, ...gauntletView(next), state: run.state }, result: { won: true, gold, pack, packType, holo },
    profile: await profile(db, await freshUser(db, user.id)) });
}

async function leaveGauntlet(db, user) {
  const g = await getGauntlet(db, user.id);
  const run = JSON.parse(g.run);
  if (!run) return json({ result: null });
  const over = await endGauntlet(db, user, g, run);
  return json({ result: { won: false, ...over }, profile: await profile(db, await freshUser(db, user.id)) });
}

// Best Gauntlet streaks: you and your friends, or everyone (top 50, plus you if you're further down).
async function leaderboard(db, user, scope) {
  const q = scope === 'friends'
    ? db.prepare(`SELECT u.id, u.username, u.team, p.avatar, COALESCE(x.best, 0) AS best FROM users u
        LEFT JOIN gauntlet x ON x.user_id = u.id LEFT JOIN presence p ON p.user_id = u.id
        WHERE u.id = ?1 OR u.id IN (SELECT f.friend_id FROM friends f JOIN friends g ON g.user_id = f.friend_id AND g.friend_id = f.user_id WHERE f.user_id = ?1)
        ORDER BY best DESC, u.username`).bind(user.id)
    : db.prepare(`SELECT u.id, u.username, u.team, p.avatar, x.best FROM gauntlet x JOIN users u ON u.id = x.user_id
        LEFT JOIN presence p ON p.user_id = u.id WHERE x.best > 0 ORDER BY x.best DESC, u.username LIMIT 50`);
  const rows = (await q.all()).results.map((r, i) => ({ rank: i + 1, name: r.username, avatar: avatarOf(r.avatar, r.team), best: r.best, me: r.id === user.id }));
  if (scope !== 'friends' && !rows.some(r => r.me)) {
    const mine = (await getGauntlet(db, user.id)).best;
    const r = await db.prepare(`SELECT (SELECT COUNT(*) FROM gauntlet WHERE best > ?2) AS ahead,
      (SELECT avatar FROM presence WHERE user_id = ?1) AS avatar`).bind(user.id, mine).first();
    rows.push({ rank: r.ahead + 1, name: user.username, avatar: avatarOf(r.avatar, user.team), best: mine, me: true });
  }
  return rows;
}

// Deletes your account and everything tied to it (the build's live test uses this to clean up after itself).
async function deleteAccount(db, user) {
  const id = user.id;
  await db.batch([
    db.prepare('DELETE FROM friends WHERE user_id = ?1 OR friend_id = ?1').bind(id),
    db.prepare('DELETE FROM challenges WHERE to_id = ?1 OR match_id IN (SELECT id FROM matches WHERE p0 = ?1 OR p1 = ?1)').bind(id),
    db.prepare('DELETE FROM matches WHERE p0 = ?1 OR p1 = ?1').bind(id),
    db.prepare('DELETE FROM trades WHERE from_id = ?1 OR to_id = ?1').bind(id),
    db.prepare('DELETE FROM fused WHERE user_id = ?1').bind(id),
    ...['collection', 'sessions', 'progress', 'presence', 'spins', 'gauntlet', 'shop_buys', 'hunts', 'daily_quests', 'quest_events', 'ranked', 'ranked_queue'].map(t => db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(id)),
    db.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ]);
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
  // card art the app downloads (and keeps); the ?v=hash in the app's request makes a long cache safe
  if (method === 'GET' && pathname === '/art/manifest.json') return file(env, 'art/manifest.json', 'application/json');
  if (method === 'GET' && /^\/art\/[a-z0-9_]+\.webp$/.test(pathname)) {
    const res = await file(env, pathname.slice(1), 'image/webp');
    if (res.ok) res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res;
  }
  if (method === 'POST' && pathname === '/signup') return signup(req, db);
  if (method === 'POST' && pathname === '/login') return login(req, db);

  const user = await currentUser(req, db);
  // last seen, for "online" on friends lists (written at most every 30 s)
  await db.prepare(`INSERT INTO presence (user_id, seen) VALUES (?1, ?2)
    ON CONFLICT (user_id) DO UPDATE SET seen = ?2 WHERE presence.seen < ?2 - 30000`).bind(user.id, now()).run();
  if (method === 'GET' && pathname === '/me') return json(await profile(db, user));
  if (method === 'POST' && pathname === '/me/delete') return deleteAccount(db, user);
  if (method === 'POST' && pathname === '/team') return setTeam(req, db, user);
  if (method === 'POST' && pathname === '/fuse') return fuseCard(req, db, user);
  if (method === 'POST' && pathname === '/shop') return buyShop(req, db, user);
  if (method === 'POST' && pathname === '/packs/open') return openInv(req, db, user);
  if (method === 'POST' && pathname === '/packs') return buyPack(db, user, String((await body(req)).type ?? 'cyber'));
  if (method === 'POST' && pathname === '/starter') return pickStarter(req, db, user);
  if (method === 'POST' && pathname === '/avatar') return setAvatar(req, db, user);
  if (method === 'POST' && pathname === '/spin') return spin(db, user);
  if (method === 'GET' && pathname === '/social') return json(await socialView(db, user));
  if (method === 'GET' && a === 'players' && b) return playerCard(db, user, decodeURIComponent(b));
  if (method === 'POST' && pathname === '/friends') return addFriend(req, db, user);
  if (method === 'POST' && pathname === '/friends/remove') return removeFriend(req, db, user);
  if (method === 'POST' && pathname === '/friends/challenge') return challengeFriend(req, db, user);
  if (method === 'POST' && pathname === '/challenges/decline') return declineChallenge(req, db, user);
  if (method === 'GET' && a === 'trades' && b === 'cards' && c) return tradeCards(db, user, decodeURIComponent(c));
  if (method === 'POST' && pathname === '/trades') return offerTrade(req, db, user);
  if (method === 'POST' && pathname === '/trades/claim') return claimTrade(req, db, user);
  if (method === 'POST' && a === 'trades' && ['accept', 'decline', 'cancel'].includes(b)) return answerTrade(req, db, user, b);
  if (a === 'campaign') {
    if (method === 'GET' && b === 'current') return json(runView(JSON.parse((await getProgress(db, user.id)).run)));
    if (method === 'POST' && b === 'start') return startCampaign(db, user);
    if (method === 'POST' && b === 'move') return campaignMove(req, db, user);
    if (method === 'POST' && b === 'leave') return leaveCampaign(db, user);
    if (method === 'POST' && b === 'reward') return pickReward(req, db, user);
  }
  if (method === 'POST' && pathname === '/quests/claim') return claimQuest(req, db, user);
  if (a === 'ranked') {
    if (method === 'GET' && !b) return json(await rankedView(db, user));
    if (method === 'POST' && b === 'search') return rankedSearch(db, user);
    if (method === 'POST' && b === 'cancel') return rankedCancel(db, user);
    if (method === 'POST' && b === 'ghost') return rankedGhost(db, user);
    if (method === 'POST' && b === 'move') return rankedMove(req, db, user);
    if (method === 'POST' && b === 'leave') return rankedLeave(db, user);
    if (method === 'POST' && b === 'seen') return rankedSeen(db, user);
    if (method === 'POST' && b === 'claim') return rankedClaim(db, user);
  }
  if (a === 'hunt') {
    if (method === 'GET' && !b) return huntHome(db, user);
    if (method === 'POST' && b === 'start') return startHunt(db, user);
    if (method === 'POST' && b === 'move') return huntMove(req, db, user);
    if (method === 'POST' && b === 'leave') return leaveHunt(db, user);
  }
  if (a === 'gauntlet') {
    if (method === 'GET' && !b) return gauntletHome(db, user);
    if (method === 'POST' && b === 'start') return startGauntlet(db, user);
    if (method === 'POST' && b === 'next') return nextGauntletFight(db, user);
    if (method === 'POST' && b === 'move') return gauntletMove(req, db, user);
    if (method === 'POST' && b === 'leave') return leaveGauntlet(db, user);
  }
  if (method === 'GET' && a === 'leaderboard' && (b === 'friends' || b === 'everyone')) return json(await leaderboard(db, user, b));
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
