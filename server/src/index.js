// HoloSynth game server: a Cloudflare Worker over D1. Every reply is JSON; errors are { error: "message" }.
// It also serves the iPhone app download (IPA + SideStore source) from the KV namespace bound as FILES.
import {
  BY_ID, STARTER_TEAM, START_GOLD, PACK_COST, PACK_COSTS, WIN_GOLD, WIN_XP, CAMPAIGN_GOLD, CAMPAIGN_XP, CAMPAIGN, CHAPTERS, CHAPTERS_OPEN, NEW_CARD_AFTER, OPEN_LEVELS,
  levelFor, levelStart, openPack, newBattle, spinWheel, SPIN_SLOTS, dayStart, nextSpinAt, PACK_TYPES, PACKS_OPEN, freePack, dailyPack, dailyShop, shopPrice, huntFoes, huntStart, HUNT_MS, huntBattle, huntPack, HUNT_GOLD, HUNT_XP, QUESTS, QUEST_PAY, questBonus, pickQuests, RANKS, RANK_REWARDS, RANKED_WIN, RANKED_LOSS, RANKED_GOLD, RANKED_XP, WEEK_MS, weekStart, seasonOf, seasonEnd, rankMove, rankTable, rankedTeam, botName, rankedFusions,
  gauntletEnemies, gauntletBattle, gauntletHeal, gauntletCooldowns, fusedHp, FUSE_COPIES, FUSE_GOLD, FUSE_MAX, SECOND, SECOND_COST, PASSIVE_COST, POWERS, POWER_SLOTS, rankedPowers, gauntletGold, GAUNTLET_PACK_EVERY, newCampaignBattle, applyMove, aiMove,
  UNLOCKS, isUnlocked, recruitsOwed, mainProgress, MAIN_QUESTS, gauntletXp,
} from './game.js';
import CARDS from '../../shared/cards.json' with { type: 'json' };

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

// Sessions: the app holds the token, the database only its SHA-256 (a leaked table can't log anyone in).
// `created` is when it was last used; a session unused for SESSION_MS is gone.
const SESSION_MS = 30 * 86400000;
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
async function newSession(db, userId) {
  const token = randomHex(32);
  await db.prepare('INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)').bind(await sha256(token), userId, now()).run();
  return token;
}
// The app sends its token as a Bearer header; the web client never sees one: it rides in an HttpOnly cookie.
const COOKIE = '__Host-hs';
const cookieToken = req => (req.headers.get('Cookie') || '').match(/(?:^|;\s*)__Host-hs=([0-9a-f]{64})/)?.[1] || '';
const bearer = req => { const h = req.headers.get('Authorization'); return h === null ? cookieToken(req) : h.replace(/^Bearer /, ''); };
const sessionCookie = (token, maxAge) => `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;

// Too many tries from one name or network: refuse for the rest of the window. Counts every try, kept in D1.
async function limit(db, key, max, windowMs) {
  const t = now();
  const row = await db.prepare(`INSERT INTO attempts (key, n, since) VALUES (?1, 1, ?2) ON CONFLICT (key) DO UPDATE SET
    n = CASE WHEN since < ?3 THEN 1 ELSE n + 1 END, since = CASE WHEN since < ?3 THEN ?2 ELSE since END RETURNING n`).bind(key, t, t - windowMs).first();
  if (row.n > max) throw new HttpError(429, 'Too many tries. Wait a few minutes and try again.');
}
// IPv6 counts per /64 (one connection usually owns the whole block, so single addresses are free to rotate)
export function ipKey(ip, groups = 4) {   // IPv6: the first `groups` groups (4: the /64, 3: the /48)
  if (!ip.includes(':')) return ip;
  const [head, tail] = ip.split('::'), h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const full = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];   // "::" expanded
  return full.slice(0, groups).map(g => (parseInt(g, 16) || 0).toString(16)).join(':') + `::/${groups * 16}`;
}
const clientIp = (req, groups) => ipKey(req.headers.get('CF-Connecting-IP') || 'unknown', groups);

// One inventory change at a time per player (trades, fusing, team, recruit): a burst of parallel requests can't all pass
// the same "do you own it" check. fn gets the player re-read inside the lock.
async function locked(db, userId, fn) {
  const t = now(), until = t + 15000;
  const got = await db.prepare(`INSERT INTO locks (user_id, until) VALUES (?1, ?2)
    ON CONFLICT (user_id) DO UPDATE SET until = ?2 WHERE locks.until < ?3`).bind(userId, until, t).run();
  if (!got.meta.changes) throw new HttpError(409, 'Still busy with your last action. Try again.');
  try { return await fn(await freshUser(db, userId)); }
  finally { await db.prepare('DELETE FROM locks WHERE user_id = ? AND until = ?').bind(userId, until).run(); }
}

async function currentUser(req, db, ctx) {
  const token = bearer(req);
  if (!req.headers.get('Authorization') && req.headers.get('X-HoloSynth') !== 'web') throw new HttpError(401, 'Please log in again.');
  if (!/^[0-9a-f]{64}$/.test(token)) throw new HttpError(401, 'Please log in again.');
  const hashed = await sha256(token), t = now();
  // the progress row comes along (one trip instead of two for campaign moves, which need it straight away)
  const row = await db.prepare(`SELECT u.*, s.created AS _sused,
    (SELECT json_object('user_id', p.user_id, 'cleared', p.cleared, 'wins', p.wins, 'packs', p.packs, 'run', p.run) FROM progress p WHERE p.user_id = u.id) AS _prog
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?1 AND s.created > ?2`).bind(hashed, t - SESSION_MS).first();
  if (!row) throw new HttpError(401, 'Please log in again.');
  if (row._sused < t - 86400000) {   // in the background: keep the session alive (once a day)
    ctx?.waitUntil(db.prepare('UPDATE sessions SET created = ?1 WHERE token = ?2').bind(t, hashed).run());
  }
  return row;
}

const MAX_BODY = 16384;   // every request the game makes is tiny
async function body(req) {
  if (Number(req.headers.get('Content-Length') || 0) > MAX_BODY) throw new HttpError(413, 'Request too large.');
  let text = '';   // read in chunks and stop past the cap (a chunked upload has no Content-Length to check)
  if (req.body) {
    const reader = req.body.pipeThrough(new TextDecoderStream()).getReader();
    for (let r; !(r = await reader.read()).done;) {
      text += r.value;
      if (text.length > MAX_BODY) { reader.cancel(); throw new HttpError(413, 'Request too large.'); }
    }
  }
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'Bad request.'); }
}

// ---- player profile ----
// The card shown as someone's picture: the one they chose, else their team leader.
const avatarOf = (chosen, team) => chosen || JSON.parse(team || '[]')[0] || 'volt';

const getProgress = async (db, userId) =>
  await db.prepare('SELECT * FROM progress WHERE user_id = ?').bind(userId).first()
  ?? { user_id: userId, cleared: 0, wins: 0, packs: 0, run: null };

// ---- fusion ----
const fusedRows = async (db, userId, cardId) => (await (cardId
  ? db.prepare('SELECT * FROM fused WHERE user_id = ? AND card_id = ?').bind(userId, cardId)
  : db.prepare('SELECT * FROM fused WHERE user_id = ?').bind(userId)).all()).results;
const fusionScore = r => r.h + r.b + r.s + r.x * 3 + (r.p ? 2 : 0) + (r.o ? 4 : 0);   // a holo copy beats a lightly fused one
const fusedView = r => ({ id: r.id, card: r.card_id, h: r.h, b: r.b, s: r.s, x: !!r.x, o: !!r.o, p: !!r.p });
// The best fused copy of each card a player owns: what their battles use.
async function fusionsFor(db, userId) {
  const best = {};
  for (const r of await fusedRows(db, userId)) if (!best[r.card_id] || fusionScore(r) > fusionScore(best[r.card_id])) best[r.card_id] = r;
  return Object.fromEntries(Object.entries(best).map(([id, r]) => [id, { h: r.h, b: r.b, s: r.s, x: !!r.x, o: !!r.o, p: !!r.p }]));
}
// Fuse spare (plain) copies into your best normal copy of a card, or your best holo copy when `holo` is set
// (a normal copy becomes a fused copy the first time).
async function fuseCard(req, db, user) {
  const { card = '', stat = '', holo = false } = await body(req);
  if (!BY_ID[card] || !['h', 'b', 's', 'x', 'p'].includes(stat)) throw new HttpError(400, 'Pick a card and a stat to fuse.');
  const count = (await db.prepare('SELECT count FROM collection WHERE user_id = ? AND card_id = ?').bind(user.id, card).first())?.count ?? 0;
  const rows = await fusedRows(db, user.id, card);
  const target = rows.filter(r => !!r.o === !!holo).sort((a, b) => fusionScore(b) - fusionScore(a))[0];
  if (holo && !target) throw new HttpError(400, "You don't have a holo copy of that card.");
  const need = stat === 'x' ? SECOND_COST.copies : stat === 'p' ? PASSIVE_COST.copies : FUSE_COPIES[Math.min(target?.[stat] ?? 0, FUSE_MAX - 1)];
  const plain = count - rows.length;                  // copies not already fused
  if (plain < need + (target ? 0 : 1)) throw new HttpError(400, `You need ${need} spare copies to fuse.`);
  if (stat === 'x') {
    if (!SECOND[card]) throw new HttpError(400, 'Only Epic and Legendary cards have a second special.');
    if (target?.x) throw new HttpError(400, 'Already unlocked.');
    if (user.gold < SECOND_COST.gold) throw new HttpError(400, `You need ${SECOND_COST.gold.toLocaleString('en-US')} gold.`);
  } else if (stat === 'p') {
    if (target?.p) throw new HttpError(400, 'Already unlocked.');
  } else if ((target?.[stat] ?? 0) >= FUSE_MAX) throw new HttpError(400, 'That stat is already maxed.');
  const gold = stat === 'x' ? SECOND_COST.gold : stat === 'p' ? PASSIVE_COST.gold : FUSE_GOLD[target?.[stat] ?? 0];
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
  if (target) writes.push(db.prepare(`UPDATE fused SET ${stat} = ${stat === 'x' || stat === 'p' ? 1 : `${stat} + 1`} WHERE id = ?`).bind(target.id));
  else writes.push(db.prepare(`INSERT INTO fused (user_id, card_id, ${stat}) VALUES (?, ?, 1)`).bind(user.id, card));
  writes.push(questEvent(db, user.id, stat === 'p' ? 'passive' : 'fuse'));
  await db.batch(writes);
  return json(await profile(db, await freshUser(db, user.id)));
}

// ---- daily quests ----
// Also counts into day 0: lifetime totals, which the main quest line reads.
const questEvent = (db, userId, kind, n = 1, best = false) => db.prepare(
  `INSERT INTO quest_events (user_id, day, kind, n) VALUES (?1, ?2, ?3, ?4), (?1, 0, ?3, ?4)
   ON CONFLICT (user_id, day, kind) DO UPDATE SET n = ${best ? 'MAX(n, excluded.n)' : 'n + excluded.n'}`).bind(userId, dayStart(now()), kind, n);
// Throws unless the player has unlocked `key` (see UNLOCKS).
async function needUnlock(db, user, key) {
  if (!isUnlocked(key, (await getProgress(db, user.id)).cleared, levelFor(user.xp))) throw new HttpError(400, `${UNLOCKS[key].text} to unlock this.`);
}

// Today's quests and progress. Picked the first time they're asked for each day, along with the counters they count from.
async function questsFor(db, user, prog, collection, extra, shopped, pre = null) {   // pre: { row, events } already read
  const day = dayStart(now());
  let row = pre ? pre.row : await db.prepare('SELECT * FROM daily_quests WHERE user_id = ?').bind(user.id).first();
  // re-pick if today's were picked while quests were still locked (they count only from when they open)
  const pickedLocked = row && JSON.parse(row.base).cleared < UNLOCKS.quests.cleared;
  if (!row || row.day !== day || pickedLocked) {
    const lvl = levelFor(user.xp), open = k => isUnlocked(k, prog.cleared, lvl);
    const can = ['wins', 'win1', ...(open('spin') ? ['spin'] : []), ...(open('shop') ? ['pack', 'shop'] : [])];
    if (prog.cleared + 2 <= OPEN_LEVELS) can.push('levels');
    if (prog.cleared + 1 <= OPEN_LEVELS) can.push('level1');
    if (Object.values(collection).some(n => n > 1)) can.push('fuse');
    if (prog.cleared >= NEW_CARD_AFTER[1] && extra.friends > 0) can.push('friend');
    if (open('gauntlet')) can.push('streak');
    if (open('hunt')) can.push('hunt');
    const base = { wins: prog.wins, packs: prog.packs, cleared: prog.cleared };
    await db.prepare(`INSERT INTO daily_quests (user_id, day, quests, base, claimed, bonus) VALUES (?1, ?2, ?3, ?4, '[]', 0)
      ON CONFLICT (user_id) DO UPDATE SET day = ?2, quests = ?3, base = ?4, claimed = '[]', bonus = 0
      WHERE daily_quests.day < ?2 OR json_extract(daily_quests.base, '$.cleared') < ?5`)
      .bind(user.id, day, JSON.stringify(pickQuests(user.id, day, can)), JSON.stringify(base), UNLOCKS.quests.cleared).run();
    row = await db.prepare('SELECT * FROM daily_quests WHERE user_id = ?').bind(user.id).first();
  }
  const results = pre ? pre.events : (await db.prepare('SELECT kind, n FROM quest_events WHERE user_id = ? AND day = ?').bind(user.id, day).all()).results;
  const ev = Object.fromEntries(results.map(r => [r.kind, r.n]));
  const base = JSON.parse(row.base), claimed = JSON.parse(row.claimed);
  const have = {
    spin: extra.spun >= day ? 1 : 0, pack: prog.packs - base.packs, shop: shopped,
    wins: prog.wins - base.wins, levels: prog.cleared - base.cleared, win1: prog.wins - base.wins, level1: prog.cleared - base.cleared,
    fuse: ev.fuse || 0, friend: ev.friend || 0, streak: ev.streak || 0, hunt: ev.hunt || 0,
  };
  const list = JSON.parse(row.quests).map((id, i) => {
    const q = QUESTS[id], pay = QUEST_PAY[q.tier];
    return { id, name: q.name, hint: q.hint ?? null, n: Math.max(0, Math.min(q.goal, have[id])), goal: q.goal, ...pay, claimed: claimed.includes(i) };
  });
  const bonus = row.bonus ? 'claimed' : list.length && list.every(q => q.claimed) ? 'ready' : 'locked';
  return { list, bonus, bonusPack: questBonus(prog.cleared, now()), next: day + 86400000 };
}

// Claim a finished quest (0-2), or "bonus" for the free pack once all three are claimed.
async function claimQuest(req, db, user) {
  await needUnlock(db, user, 'quests');
  const { quest } = await body(req);
  const day = dayStart(now());
  const { quests } = await profile(db, user);
  const row = await db.prepare('SELECT * FROM daily_quests WHERE user_id = ? AND day = ?').bind(user.id, day).first();
  if (!row) throw new HttpError(409, 'New quests just arrived. Take a look.');
  if (quest === 'bonus') {
    if (quests.bonus !== 'ready') throw new HttpError(400, quests.bonus === 'claimed' ? 'You already got today\'s pack.' : 'Finish all three quests first.');
    const res = await db.prepare('UPDATE daily_quests SET bonus = 1 WHERE user_id = ? AND day = ? AND bonus = 0').bind(user.id, day).run();
    if (!res.meta.changes) throw new HttpError(400, "You already got today's pack.");
    const type = questBonus((await getProgress(db, user.id)).cleared, now());
    const pack = openPack(user.packs_since_legend, type);
    await db.batch([...packWrites(db, user.id, pack, type),
      db.prepare('UPDATE users SET packs_since_legend = ? WHERE id = ?').bind(pack.packsSinceLegend, user.id)]);
    return json({ cards: pack.cards, holo: pack.holo, type, profile: await profile(db, await freshUser(db, user.id)) });
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

// ---- main quest line ----
const mainHave = (user, prog, collection, extra, ev0) => ({ cleared: prog.cleared, level: levelFor(user.xp), team: JSON.parse(user.team).length,
  friends: extra.friends, ev: { ...ev0, packs: prog.packs, g10: ev0.g10 || 0 } });
async function mainRow(db, userId) {
  return await db.prepare('SELECT * FROM main_quest WHERE user_id = ?').bind(userId).first() ?? { step: 0, base: '{}' };
}
// Claim the active main quest; the next one starts counting its events from now.
async function claimMain(db, user) {
  const prof = await profile(db, user), q = prof.mainQuest;
  if (!q) throw new HttpError(400, 'Every main quest is done.');
  if (!q.done) throw new HttpError(400, "That quest isn't done yet.");
  const row = await mainRow(db, user.id), prog = await getProgress(db, user.id);
  const ev0 = Object.fromEntries((await db.prepare('SELECT kind, n FROM quest_events WHERE user_id = ? AND day = 0').bind(user.id).all()).results.map(r => [r.kind, r.n]));
  const base = JSON.stringify({ ...ev0, packs: prog.packs });
  const res = await db.prepare(`INSERT INTO main_quest (user_id, step, base) VALUES (?1, ?2, ?3)
    ON CONFLICT (user_id) DO UPDATE SET step = ?2, base = ?3 WHERE main_quest.step = ?4`).bind(user.id, row.step + 1, base, row.step).run();
  if (!res.meta.changes) throw new HttpError(409, 'Already claimed.');
  await db.prepare('UPDATE users SET gold = gold + ?, xp = xp + ? WHERE id = ?').bind(q.gold, q.xp, user.id).run();
  return json({ profile: await profile(db, await freshUser(db, user.id)) });
}

async function profile(db, user) {
  // Every read in one batch, so one round trip: separate queries queue one after another in the database.
  const t = now(), day = dayStart(t), week = weekStart(t);
  const q = (sql, ...args) => db.prepare(sql).bind(...args);
  const [results, [progRow], [extra], ev0rows, fused, powerRows, [teamRow], [mainRowRead], [meta], [rankRow], rankPeers, [questRow], todayEvents, [emailRow]] =
    (await db.batch([
      q('SELECT card_id, count FROM collection WHERE user_id = ?', user.id),
      q('SELECT * FROM progress WHERE user_id = ?', user.id),
      q(`SELECT (SELECT avatar FROM presence WHERE user_id = ?1) AS avatar,
    (SELECT last FROM spins WHERE user_id = ?1) AS spun,
    (SELECT GROUP_CONCAT(slot) FROM shop_buys WHERE user_id = ?1 AND day = ?2) AS shopped,
    (SELECT CASE WHEN state IS NOT NULL THEN 'playing' ELSE result END FROM hunts WHERE user_id = ?1 AND day = ?3) AS hunted,
    (SELECT best FROM gauntlet WHERE user_id = ?1) AS gbest,
    (SELECT json_group_array(json_object('type', type, 'n', n)) FROM (SELECT type, COUNT(*) AS n, MIN(id) AS first FROM pack_inv
       WHERE user_id = ?1 GROUP BY type ORDER BY first)) AS unopened,
    (SELECT COUNT(*) FROM friends f JOIN friends g ON g.user_id = f.friend_id AND g.friend_id = f.user_id
       JOIN gauntlet x ON x.user_id = f.friend_id
       WHERE f.user_id = ?1 AND x.best > COALESCE((SELECT best FROM gauntlet WHERE user_id = ?1), 0)) AS gahead,
    (SELECT COUNT(*) FROM friends f JOIN friends g ON g.user_id = f.friend_id AND g.friend_id = f.user_id WHERE f.user_id = ?1) AS friends`,
        user.id, day, huntStart(t)),
      q('SELECT kind, n FROM quest_events WHERE user_id = ? AND day = 0', user.id),
      q('SELECT * FROM fused WHERE user_id = ?', user.id),
      q('SELECT power, count FROM powers WHERE user_id = ? AND count > 0', user.id),
      q('SELECT team FROM power_team WHERE user_id = ?', user.id),
      q('SELECT * FROM main_quest WHERE user_id = ?', user.id),
      q("SELECT (SELECT v FROM ranked_meta WHERE k = 'week') AS week, (SELECT v FROM ranked_meta WHERE k = 'season') AS season"),
      q('SELECT * FROM ranked WHERE user_id = ?', user.id),
      q(`SELECT u.id, u.username AS name, r.week, r.points FROM users u LEFT JOIN ranked r ON r.user_id = u.id
         WHERE COALESCE(r.rank, 0) = COALESCE((SELECT rank FROM ranked WHERE user_id = ?1), 0) AND (${RANKED_IN} OR u.id = ?1)`, user.id),
      q('SELECT * FROM daily_quests WHERE user_id = ?', user.id),
      q('SELECT kind, n FROM quest_events WHERE user_id = ? AND day = ?', user.id, day),
      q(`SELECT (SELECT email FROM emails WHERE user_id = ?1) AS email,
         (SELECT terms || '|' || privacy FROM agreements WHERE user_id = ?1) AS agreed,
         (SELECT ids FROM seen_cards WHERE user_id = ?1) AS seen,
         (SELECT verified FROM emails WHERE user_id = ?1) AS verified`, user.id),
    ])).map(r => r.results);
  const prog = progRow ?? { user_id: user.id, cleared: 0, wins: 0, packs: 0, run: null };
  const mainRowNow = mainRowRead ?? { step: 0, base: '{}' };
  const powers = Object.fromEntries(powerRows.map(r => [r.power, r.count]));
  const powerTeam = [];   // as loadout(): your picks, as far as your copies go
  for (const id of JSON.parse(teamRow?.team ?? '[]')) if ((powers[id] || 0) > powerTeam.filter(x => x === id).length) powerTeam.push(id);
  let ranked;
  if (meta.week === null || meta.week < week || meta.season < seasonOf(t)) ranked = await rankedTile(db, user);   // a new week or season to roll over first
  else {
    const me = rankRow ?? { rank: 0, week, points: 0, moved: null, reward: null };
    const table = rankTable(rankPeers.map(r => ({ id: r.id, name: r.name, points: r.week === week ? r.points : 0 })), week, me.rank, t);
    ranked = { rank: me.rank, name: RANKS[me.rank], place: table.find(r => r.id === user.id).place, points: weekPoints(me, week),
      weekEnds: week + WEEK_MS, alert: !!(me.moved || me.reward) };
  }
  const collection = Object.fromEntries(results.map(r => [r.card_id, r.count]));
  // NEW tags: owned cards not looked at yet. The first time (no list yet) everything owned counts as seen.
  let seen = emailRow?.seen ? JSON.parse(emailRow.seen) : null;
  if (!seen && JSON.parse(user.team || '[]').length) {
    seen = Object.keys(collection);
    await db.prepare('INSERT OR IGNORE INTO seen_cards (user_id, ids) VALUES (?, ?)').bind(user.id, JSON.stringify(seen)).run();
  }
  const newCards = seen ? Object.keys(collection).filter(id => !seen.includes(id)) : [];
  const sold = String(extra.shopped ?? '').split(',');
  const ev0 = Object.fromEntries(ev0rows.map(r => [r.kind, r.n]));
  const quests = isUnlocked('quests', prog.cleared, levelFor(user.xp))
    ? await questsFor(db, user, prog, collection, extra, sold.filter(Boolean).length, { row: questRow, events: todayEvents })
    : { list: [], bonus: 'locked', bonusPack: questBonus(prog.cleared, now()), next: dayStart(now()) + 86400000 };   // locked: nothing to claim, no badge
  const next = prog.cleared < OPEN_LEVELS ? CAMPAIGN[prog.cleared] : null;   // locked chapters count as done for now
  const chapter = next ? next.chapter : CAMPAIGN[OPEN_LEVELS - 1].chapter;
  return {
    username: user.username,
    email: emailRow?.email ?? null,   // null: an older account; the app asks for one
    emailVerified: !!emailRow?.verified,
    agreed: emailRow?.agreed === `${TERMS_VERSION}|${PRIVACY_VERSION}`,   // false: asked to agree (again, after either page changes)
    gold: user.gold,
    xp: user.xp,
    level: levelFor(user.xp),
    levelXp: user.xp - levelStart(levelFor(user.xp)),                            // XP into the current level
    levelNeed: levelStart(levelFor(user.xp) + 1) - levelStart(levelFor(user.xp)),   // XP the current level takes
    team: JSON.parse(user.team),
    collection,
    newCards,                     // owned but not looked at yet (NEW tag on every device)
    needsStarter: false,   // old app builds read this; starters now come from Recruit Packs
    recruit: Math.max(0, recruitsOwed(prog.cleared) - Math.max(ev0.recruit || 0, STARTER_TEAM.filter(id => collection[id]).length)),   // Recruit Packs to open
    locked: Object.fromEntries(Object.keys(UNLOCKS).filter(k => !isUnlocked(k, prog.cleared, levelFor(user.xp))).map(k => [k, UNLOCKS[k].text])),
    mainQuest: mainProgress(mainRowNow.step, mainHave(user, prog, collection, extra, ev0), JSON.parse(mainRowNow.base)),
    avatar: avatarOf(extra.avatar, user.team),
    since: user.created,
    friends: extra.friends,
    nextSpin: nextSpinAt(extra.spun, now()),   // ms when the wheel resets (midnight UTC); 0 = spin now
    spinPack: dailyPack(now()),   // which pack the wheel's pack slot gives today
    packsOpen: PACKS_OPEN,        // packs on sale; the rest say "Coming soon"
    shop: {   // today's cards (slot 0 is the Rare); new ones at midnight UTC
      cards: dailyShop(now()).map((id, i) => ({ id, price: shopPrice(id), sold: sold.includes(String(i)) })),
      next: dayStart(now()) + 86400000,
    },
    fused: fused.map(fusedView),
    quests,
    ranked,
    hunt: { ...huntFoes(now()), status: extra.hunted ?? 'ready', next: huntStart(now()) + HUNT_MS },   // ready | playing | won | lost
    gauntlet: { best: extra.gbest || 0, rank: extra.gahead + 1 },   // rank among you and your friends
    wins: prog.wins,
    packs: prog.packs,
    unopened: JSON.parse(extra.unopened ?? '[]'),
    powers,        // power cards you own: { id: count }
    powerTeam,     // the (up to) 2 you take into battle   // packs waiting to be opened, oldest first: [{ type, n }]
    campaign: {
      chapter: CHAPTERS[chapter].title,
      chapterNum: chapter + 1,
      cleared: prog.cleared,
      total: OPEN_LEVELS,
      next: next ? { num: next.num, title: next.title, enemies: next.enemies, boss: !!next.boss } : null,
      friendsUnlocked: prog.cleared >= NEW_CARD_AFTER[1],
    },
  };
}

const freshUser = (db, id) => db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
// A pack's cards go into the collection; each holo one also gets its own copy row (a fused row with o = 1).
const cardWrites = (db, userId, pack) => [...pack.cards.map(id => (id.startsWith('pw:') ? addPower(db, userId, id.slice(3)) : addCard(db, userId, id))),
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
const addPower = (db, userId, id) => db.prepare(
  'INSERT INTO powers (user_id, power, count) VALUES (?, ?, 1) ON CONFLICT (user_id, power) DO UPDATE SET count = count + 1',
).bind(userId, id);

// ---- power cards ----
const powerCounts = async (db, userId) => Object.fromEntries((await db.prepare('SELECT power, count FROM powers WHERE user_id = ? AND count > 0')
  .bind(userId).all()).results.map(r => [r.power, r.count]));
const powerTeam = async (db, userId) => JSON.parse((await db.prepare('SELECT team FROM power_team WHERE user_id = ?').bind(userId).first())?.team ?? '[]');
// The power cards a player takes into a battle: their picks, as far as their copies go.
async function loadout(db, userId) {
  const have = await powerCounts(db, userId), out = [];
  for (const id of await powerTeam(db, userId)) if ((have[id] || 0) > out.filter(x => x === id).length) out.push(id);
  return out;
}
async function setPowerTeam(req, db, user) {
  const { powers } = await body(req);
  if (!Array.isArray(powers) || powers.length > POWER_SLOTS || !powers.every(id => typeof id === 'string' && POWERS[id])) throw new HttpError(400, 'Pick up to 2 power cards.');
  const have = await powerCounts(db, user.id);
  if (!powers.every(id => (have[id] || 0) >= powers.filter(x => x === id).length)) throw new HttpError(400, "You don't have enough of those power cards.");
  await db.prepare('INSERT INTO power_team (user_id, team) VALUES (?1, ?2) ON CONFLICT (user_id) DO UPDATE SET team = ?2').bind(user.id, JSON.stringify(powers)).run();
  return json(await profile(db, user));
}
// After a player's move: a power card they played (already paid for by withPower) comes off the equipped slots,
// unless another copy still covers it.
async function spendPowers(db, userId, before, after = []) {
  if (after.length < before.length) await db.prepare('UPDATE power_team SET team = ? WHERE user_id = ?').bind(JSON.stringify(await loadout(db, userId)), userId).run();
}
// A battle move that plays a power card uses up a copy first, so one copy can't be played in several battles at once.
// The copy comes back if the move doesn't go through (bad move, or a double-submit).
async function withPower(req, db, user, fn) {
  const kind = (await body(req.clone())).move;
  const id = typeof kind === 'string' && kind.startsWith('pw:') ? kind.slice(3) : null;
  if (!id) return fn();
  const took = await db.prepare('UPDATE powers SET count = count - 1 WHERE user_id = ? AND power = ? AND count > 0').bind(user.id, id).run();
  if (!took.meta.changes) throw new HttpError(400, "You don't have that power card any more.");
  try { return await fn(); }
  catch (e) { await db.prepare('UPDATE powers SET count = count + 1 WHERE user_id = ? AND power = ?').bind(user.id, id).run(); throw e; }
}
const addCard = (db, userId, id) => db.prepare(
  'INSERT INTO collection (user_id, card_id, count) VALUES (?, ?, 1) ON CONFLICT (user_id, card_id) DO UPDATE SET count = count + 1',
).bind(userId, id);

// The "last updated" dates on site/terms.html and site/privacy.html (holosynth.app): change these with them.
const TERMS_VERSION = '2026-10-28', PRIVACY_VERSION = '2026-10-28';
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Names that could pass as the game or its staff; checked without case, _ or digits ("Admin_1" counts).
export const reservedName = n => { const k = n.toLowerCase().replace(/[_0-9]/g, '');
  return /holosynth|admin|moderator|official/.test(k) || ['support', 'staff', 'system', 'dev', 'developer', 'help', 'team', 'mod', 'root', 'owner', 'server', 'null', 'undefined'].includes(k); };
async function signup(req, db, env, ctx) {
  const { username = '', password = '', email = '', agree } = await body(req);
  const name = String(username).trim(), mail = String(email).trim().toLowerCase();
  if (agree !== true) throw new HttpError(400, 'Agree to the Terms and Conditions and the Privacy Policy to create an account.');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new HttpError(400, 'Username must be 3–16 letters, numbers or _.');
  if (mail.length > 254 || !EMAIL_RE.test(mail)) throw new HttpError(400, 'Enter a valid email address.');
  if (String(password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (String(password).length > 128) throw new HttpError(400, 'Password must be at most 128 characters.');
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw new HttpError(400, 'Password needs at least one letter and one number.');
  // checking names and emails is limited too (20 an hour per network), so the form can't be used to list accounts.
  // IPv6 networks count per /48 here: anyone can get a /48 of /64s for free, so new accounts can't be made one /64 after another
  await limit(db, 'signupchk:' + clientIp(req, 3), 20, 3600000);
  if (reservedName(name) || await db.prepare('SELECT 1 FROM users WHERE username = ?').bind(name).first()) {
    throw new HttpError(409, 'That username is taken.');
  }
  if (await emailTaken(db, mail)) throw new HttpError(409, 'That email already has an account.');
  await limit(db, 'signup:' + clientIp(req, 3), 3, 3600000);   // 3 new accounts an hour per network (typos and taken names don't count)
  const salt = randomHex(16);
  const user = await db.prepare(
    'INSERT INTO users (username, pass_hash, salt, gold, team, created) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
  ).bind(name, await hashPassword(password, salt), salt, START_GOLD, '[]', now()).first();
  await db.batch([db.prepare('INSERT INTO progress (user_id) VALUES (?)').bind(user.id),
    db.prepare('INSERT INTO emails (user_id, email, created) VALUES (?, ?, ?)').bind(user.id, mail, now()),
    db.prepare('INSERT INTO agreements (user_id, terms, privacy, at) VALUES (?, ?, ?, ?)').bind(user.id, TERMS_VERSION, PRIVACY_VERSION, now())]);
  ctx?.waitUntil(sendVerify(db, env, user, mail).catch(e => console.error(e)));
  return json({ token: await newSession(db, user.id), profile: await profile(db, user) });
}

async function login(req, db, ctx) {
  const { username = '', password = '' } = await body(req);
  const name = String(username).trim().slice(0, 254), pw = String(password).slice(0, 128);
  // 5 tries per name typed and 10 per network every 15 minutes, right or wrong; a right one clears the name's count.
  // Counted by what was typed, not by account, so the counts don't tell which name and email go together.
  await limit(db, 'loginip:' + clientIp(req), 10, 900000);
  const key = 'login:' + name.toLowerCase();
  await limit(db, key, 5, 900000);
  const user = name.includes('@')   // a username or the account's email
    ? await db.prepare('SELECT u.* FROM emails e JOIN users u ON u.id = e.user_id WHERE e.email = ?').bind(name.toLowerCase()).first()
    : await db.prepare('SELECT * FROM users WHERE username = ?').bind(name).first();
  // a name that doesn't exist takes as long as a wrong password, so timing doesn't tell which names are real
  const hash = await hashPassword(pw, user ? user.salt : 'no-such-user');
  if (!user || hash !== user.pass_hash) throw new HttpError(401, 'Wrong username or password.');
  ctx?.waitUntil(db.batch([   // tidy up: this account's counter, and sessions and counters long gone
    db.prepare('DELETE FROM attempts WHERE key = ?').bind(key),
    db.prepare('DELETE FROM sessions WHERE created < ?').bind(now() - SESSION_MS),
    db.prepare('DELETE FROM attempts WHERE since < ?').bind(now() - 86400000)]));
  return json({ token: await newSession(db, user.id), profile: await profile(db, user) });
}

// An email is taken if another account has verified it, or claimed it within the last week (its verify link still works).
// An older unverified claim is dropped, so nobody can hold on to an address they don't own.
async function emailTaken(db, mail, userId = 0) {
  const row = await db.prepare('SELECT user_id, verified, created FROM emails WHERE email = ? AND user_id != ?').bind(mail, userId).first();
  if (!row) return false;
  if (row.verified || row.created > now() - VERIFY_MS) return true;
  await db.prepare('DELETE FROM emails WHERE user_id = ? AND verified = 0').bind(row.user_id).run();
  return false;
}
// The password asked again before a big change: 5 tries per 15 minutes, so a stolen session can't guess it.
async function checkPassword(db, user, password) {
  await limit(db, 'pwcheck:' + user.id, 5, 900000);
  if (await hashPassword(String(password).slice(0, 128), user.salt) !== user.pass_hash) throw new HttpError(401, 'Wrong password.');
}
// Add or change your email (asks for the password): accounts made before sign-up asked for one.
async function setEmail(req, db, user, env, ctx) {
  const { email = '', password = '' } = await body(req);
  const mail = String(email).trim().toLowerCase();
  if (mail.length > 254 || !EMAIL_RE.test(mail)) throw new HttpError(400, 'Enter a valid email address.');
  await checkPassword(db, user, password);
  if (await emailTaken(db, mail, user.id)) throw new HttpError(409, 'That email already has an account.');
  await limit(db, 'verifymail:' + user.id, 3, 3600000);   // each change sends an email
  await db.batch([db.prepare(`INSERT INTO emails (user_id, email, created) VALUES (?1, ?2, ?3)
    ON CONFLICT (user_id) DO UPDATE SET email = ?2, verified = 0, created = ?3`).bind(user.id, mail, now()),
    db.prepare('DELETE FROM email_tokens WHERE user_id = ?').bind(user.id)]);   // links sent to the old address stop working
  ctx?.waitUntil(sendVerify(db, env, user, mail).catch(e => console.error(e)));
  return json(await profile(db, user));
}

// ---- email (Resend): verification and password reset links ----
const SITE = 'https://play.holosynth.app';
const VERIFY_MS = 7 * 86400000, RESET_MS = 3600000;
const SAME_ANSWER = "If that account exists, we've emailed a reset link to its address.";
const esc = t => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
async function sendEmail(env, to, subject, lines, button, url) {
  if (!env.RESEND_API_KEY) { console.log('email not sent (no RESEND_API_KEY):', subject); return; }   // local runs
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1a1626">
    <h2 style="margin:0 0 16px">HoloSynth</h2>${lines.map(l => `<p style="font-size:15px;line-height:1.5">${esc(l)}</p>`).join('')}
    <p style="margin:24px 0"><a href="${url}" style="background:#E0A12A;color:#1A0D05;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold">${esc(button)}</a></p>
    <p style="font-size:12px;color:#777">If the button doesn't work, open this link: ${esc(url)}</p>
    <p style="font-size:12px;color:#777">© 2026 Lucas Seeley · Questions? support@holosynth.app</p></div>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'HoloSynth <noreply@holosynth.app>', to: [to], reply_to: 'support@holosynth.app', subject, html,
      text: `${lines.join('\n\n')}\n\n${button}: ${url}` }),
  });
  if (!res.ok) console.error('email failed', res.status, await res.text());
}
async function emailToken(db, userId, kind, email, ms) {
  const token = randomHex(32);
  await db.batch([db.prepare('DELETE FROM email_tokens WHERE user_id = ? AND kind = ?').bind(userId, kind),   // only the newest link works
    db.prepare('INSERT INTO email_tokens (token, user_id, kind, email, expires) VALUES (?, ?, ?, ?, ?)').bind(await sha256(token), userId, kind, email, now() + ms)]);
  return token;
}
async function sendVerify(db, env, user, email) {
  const token = await emailToken(db, user.id, 'verify', email, VERIFY_MS);
  await sendEmail(env, email, 'Verify your HoloSynth email', [`Hi ${user.username}, tap below to confirm this is your email.`, 'The link works for 7 days.'],
    'Verify email', `${SITE}/verify?t=${token}`);
}
// Takes a link's token (it works once): its row if it's still valid, else null.
async function useToken(db, token, kind) {
  if (!/^[0-9a-f]{64}$/.test(String(token))) return null;
  const row = await db.prepare('DELETE FROM email_tokens WHERE token = ? AND kind = ? RETURNING *').bind(await sha256(token), kind).first();
  return row && row.expires > now() ? row : null;
}
// The link in the verify email (a browser page load): marks the address verified, then opens the game.
async function verifyLink(req, db) {
  const row = await useToken(db, new URL(req.url).searchParams.get('t'), 'verify');
  if (row) await db.prepare('UPDATE emails SET verified = 1 WHERE user_id = ? AND email = ?').bind(row.user_id, row.email).run();
  return new Response(null, { status: 302, headers: { Location: `/#/${row ? 'verified' : 'linkexpired'}` } });
}
async function resendVerify(db, env, user) {
  const e = await db.prepare('SELECT email, verified FROM emails WHERE user_id = ?').bind(user.id).first();
  if (!e) throw new HttpError(400, 'Add an email first.');
  if (e.verified) return json({ ok: true, message: 'Already verified.' });
  await limit(db, 'verifymail:' + user.id, 3, 3600000);
  await sendVerify(db, env, user, e.email);
  return json({ ok: true, message: `Sent to ${e.email}` });
}
// Forgot password: emails a reset link. Always the same answer, so it can't be used to find accounts.
async function forgotPassword(req, db, env, ctx) {
  const name = String((await body(req)).name ?? '').trim().slice(0, 254);
  await limit(db, 'forgotip:' + clientIp(req), 5, 3600000);
  const user = name.includes('@')
    ? await db.prepare('SELECT u.*, e.email AS mail FROM emails e JOIN users u ON u.id = e.user_id WHERE e.email = ?').bind(name.toLowerCase()).first()
    : await db.prepare('SELECT u.*, e.email AS mail FROM users u JOIN emails e ON e.user_id = u.id WHERE u.username = ?').bind(name).first();
  // sent in the background, so a real account doesn't answer slower than a made-up one
  if (user) ctx.waitUntil((async () => {
    await limit(db, 'forgot:' + user.id, 3, 3600000);
    const token = await emailToken(db, user.id, 'reset', user.mail, RESET_MS);
    await sendEmail(env, user.mail, 'Reset your HoloSynth password', [`Hi ${user.username}, someone (hopefully you) asked to reset your password.`,
      "The link works for 1 hour. If it wasn't you, ignore this email: your password stays the same."], 'Reset password', `${SITE}/#/reset?t=${token}`);
  })().catch(e => { if (!(e instanceof HttpError)) console.error(e); }));
  return json({ ok: true, message: SAME_ANSWER });
}
async function resetPassword(req, db) {
  const { token, password = '' } = await body(req);
  const pw = String(password);
  if (pw.length < 8 || pw.length > 128 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw new HttpError(400, 'Password: 8+ characters with a letter and a number.');
  const row = await useToken(db, token, 'reset');
  if (!row) throw new HttpError(400, 'That link has expired or was already used. Ask for a new one.');
  const salt = randomHex(16);
  await db.batch([db.prepare('UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?').bind(await hashPassword(pw, salt), salt, row.user_id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.user_id),   // logged out everywhere
    db.prepare('UPDATE emails SET verified = 1 WHERE user_id = ? AND email = ?').bind(row.user_id, row.email),   // they got the email
    db.prepare("DELETE FROM attempts WHERE key IN ('login:' || lower((SELECT username FROM users WHERE id = ?1)), 'login:' || ?2)").bind(row.user_id, row.email)]);
  return json({ ok: true });
}

// Agree to the current Terms and Conditions and Privacy Policy (accounts made before sign-up asked, or after they change).
async function agree(req, db, user) {
  if ((await body(req)).agree !== true) throw new HttpError(400, 'Agree to the Terms and Conditions and the Privacy Policy to keep playing.');
  await db.prepare(`INSERT INTO agreements (user_id, terms, privacy, at) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT (user_id) DO UPDATE SET terms = ?2, privacy = ?3, at = ?4`).bind(user.id, TERMS_VERSION, PRIVACY_VERSION, now()).run();
  return json(await profile(db, user));
}

// Looked at these cards: their NEW tags go away on every device.
async function seeCards(req, db, user) {
  const { ids } = await body(req);
  if (!Array.isArray(ids) || ids.length > 300) throw new HttpError(400, 'Bad request.');
  const row = await db.prepare('SELECT ids FROM seen_cards WHERE user_id = ?').bind(user.id).first();
  const seen = new Set(row ? JSON.parse(row.ids) : []);
  for (const id of ids) if (BY_ID[id]) seen.add(id);
  await db.prepare('INSERT INTO seen_cards (user_id, ids) VALUES (?1, ?2) ON CONFLICT (user_id) DO UPDATE SET ids = ?2')
    .bind(user.id, JSON.stringify([...seen])).run();
  return json({ ok: true });
}

// Ends this session (the app forgets its token too).
async function logout(req, db) {
  const token = bearer(req);
  await db.prepare('DELETE FROM sessions WHERE token = ?').bind(await sha256(token)).run();
  return json({ ok: true });
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
  await needUnlock(db, user, 'shop');
  if (!['cyber', 'power'].includes(type)) await needUnlock(db, user, UNLOCKS[type] ? type : 'packs');   // overload / legends have their own
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
  await needUnlock(db, user, 'shop');
  const { slot, card } = await body(req);
  const day = dayStart(now());
  const id = dailyShop(day)[slot];
  if (!Number.isInteger(slot) || !id) throw new HttpError(400, 'Unknown shop card.');
  if (id !== card) throw new HttpError(400, 'The shop just changed. Take another look.');
  if (PACK_TYPES.magic.includes(BY_ID[id].cls)) await needUnlock(db, user, 'packs');   // magic cards wait for chapter 1 too
  const price = shopPrice(id);
  const claim = await db.prepare('INSERT OR IGNORE INTO shop_buys (user_id, day, slot) VALUES (?, ?, ?)').bind(user.id, day, slot).run();
  if (!claim.meta.changes) throw new HttpError(400, 'You already bought that one today.');
  const paid = await db.prepare('UPDATE users SET gold = gold - ? WHERE id = ? AND gold >= ?').bind(price, user.id, price).run();
  if (!paid.meta.changes) {
    await db.prepare('DELETE FROM shop_buys WHERE user_id = ? AND day = ? AND slot = ?').bind(user.id, day, slot).run();
    throw new HttpError(400, `You need ${price} gold.`);
  }
  await db.batch([addCard(db, user.id, id), questEvent(db, user.id, 'shopbuy')]);
  return json({ card: id, profile: await profile(db, await freshUser(db, user.id)) });
}

const bumpProgress = (db, userId, field) => db.prepare(
  `INSERT INTO progress (user_id, ${field}) VALUES (?, 1) ON CONFLICT (user_id) DO UPDATE SET ${field} = ${field} + 1`,
).bind(userId);

// ---- starter card & campaign ----
// Opens the player's next Recruit Pack: a random starter they don't have yet, straight onto their team.
async function openRecruit(db, user) {
  const prof = await profile(db, user);
  if (!prof.recruit) throw new HttpError(400, 'No Recruit Pack to open.');
  const missing = STARTER_TEAM.filter(id => !prof.collection[id]);
  const card = (missing.length ? missing : STARTER_TEAM)[Math.floor(Math.random() * (missing.length || STARTER_TEAM.length))];
  const team = prof.team.includes(card) || prof.team.length >= 3 ? prof.team : [...prof.team, card];
  await db.batch([addCard(db, user.id, card), questEvent(db, user.id, 'recruit'),
    db.prepare('UPDATE users SET team = ? WHERE id = ?').bind(JSON.stringify(team), user.id)]);
  return json({ card, profile: await profile(db, await freshUser(db, user.id)) });
}

// The campaign map: every open chapter. Ones you haven't reached come locked: no enemies or level names, just their shape.
export function campaignMap(cleared) {
  return { cleared, chapters: CHAPTERS.slice(0, CHAPTERS_OPEN).map((c, i) => {
    const locked = cleared < i * 30;
    return { num: i + 1, title: c.title, gold: CAMPAIGN_GOLD[i], xp: CAMPAIGN_XP[i], ...(locked ? { locked: `Beat Chapter ${i}` } : {}),
      levels: CAMPAIGN.filter(l => l.chapter === i).map(l => ({ num: l.num, title: locked ? '' : l.title, enemies: locked ? [] : l.enemies,
        lv: locked ? 0 : l.lv ?? 0, boss: !!l.boss, ...(l.pack ? { pack: l.pack } : {}) })) };
  }) };
}
const runView = run => run && { level: CAMPAIGN[run.level].num, title: CAMPAIGN[run.level].title, boss: !!CAMPAIGN[run.level].boss, state: run.state };

async function startCampaign(db, user) {
  const prof = await profile(db, user);
  if (prof.recruit) throw new HttpError(400, 'Open your Recruit Pack first.');
  const prog = await getProgress(db, user.id);
  if (prog.cleared >= OPEN_LEVELS) throw new HttpError(400, OPEN_LEVELS < CAMPAIGN.length ? 'The next chapter is coming soon!' : 'You beat the whole campaign!');
  const run = { level: prog.cleared, state: newCampaignBattle(prof.team, prog.cleared, await fusionsFor(db, user.id), await loadout(db, user.id)) };
  await db.prepare('INSERT INTO progress (user_id, run) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET run = excluded.run')
    .bind(user.id, JSON.stringify(run)).run();
  return json(runView(run));
}

async function campaignMove(req, db, user) {
  const prog = user._prog ? JSON.parse(user._prog) : await getProgress(db, user.id);   // read with the login check
  if (!prog.run) throw new HttpError(400, 'No campaign battle in progress.');
  const run = JSON.parse(prog.run);
  const { from, move: kind, to } = await body(req);
  const had = [...(run.state.pw?.[0] ?? [])];
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
  await spendPowers(db, user.id, had, run.state.pw?.[0]);   // only once the move is saved: a double-submit can't use a card up

  let result = null;
  if (done) result = run.state.winner === 0 ? await campaignWin(db, user, run.level) : { won: false };
  // the profile only when the fight ends: building it each move made every attack wait on a dozen reads
  return json({ ...runView(run), result, ...(done ? { profile: await profile(db, await freshUser(db, user.id)) } : {}) });
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
  if (NEW_CARD_AFTER.includes(num)) result.recruit = true;   // a Recruit Pack with the next starter
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
  await needUnlock(db, user, 'friends');
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
  await needUnlock(db, user, 'friends');
  const { code = '' } = await body(req);
  const m = await db.prepare("SELECT * FROM matches WHERE code = ? AND status = 'waiting'")
    .bind(String(code).trim().toUpperCase()).first();
  if (!m) throw new HttpError(404, 'No open match with that code.');
  if (m.p0 === user.id) throw new HttpError(400, "That's your own invite. Send the code to a friend.");
  const state = newBattle(JSON.parse(m.team0), JSON.parse(user.team), Math.random, await fusionsFor(db, m.p0), await fusionsFor(db, user.id));
  state.pw = [await loadout(db, m.p0), await loadout(db, user.id)];
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
  const side = m.p0 === user.id ? 0 : 1, had = [...(state.pw?.[side] ?? [])];
  try { applyMove(state, side, from, kind, to); }
  catch (e) { throw new HttpError(400, e.message); }

  const done = state.winner !== null;
  // Only save if nobody else changed the match since we read it (stops double-submitted moves).
  const res = await db.prepare('UPDATE matches SET state = ?, status = ?, updated = ? WHERE id = ? AND updated = ?')
    .bind(JSON.stringify(state), done ? 'done' : 'active', now(), m.id, m.updated).run();
  if (!res.meta.changes) throw new HttpError(409, 'The match changed. Refreshing.');
  await spendPowers(db, user.id, had, state.pw?.[side]);   // only once the move is saved
  if (done) {
    const winnerId = state.winner === 0 ? m.p0 : m.p1;
    if (m.code.startsWith('#')) await finishRankedMatch(db, m, winnerId);
    else await db.batch([...await friendWin(db, winnerId), questEvent(db, winnerId, 'friend')]);   // forfeits don't count for the quest
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
    const left = await db.prepare("UPDATE matches SET state = ?, status = 'done', updated = ? WHERE id = ? AND status = 'active'")
      .bind(JSON.stringify(state), now(), m.id).run();
    if (!left.meta.changes) return json({ ok: true });   // already over: pays once
    const winnerId = you === 0 ? m.p1 : m.p0;
    // quitting straight away pays the winner nothing (a second account can't be used to farm wins)
    const played = (state.moves || 0) >= FORFEIT_MOVES;
    if (m.code.startsWith('#')) await finishRankedMatch(db, m, winnerId, played);
    else if (played) await db.batch(await friendWin(db, winnerId));
  }
  return json({ ok: true });
}
const FORFEIT_MOVES = 6, FRIEND_PAID_DAY = 10, RANKED_PAIR_DAY = 3;
// A friend-battle win: gold and XP for the first FRIEND_PAID_DAY a day, the win always counts.
async function friendWin(db, winnerId) {
  const paid = (await db.prepare("SELECT n FROM quest_events WHERE user_id = ? AND day = ? AND kind = 'fpaid'").bind(winnerId, dayStart(now())).first())?.n ?? 0;
  return [bumpProgress(db, winnerId, 'wins'), ...(paid < FRIEND_PAID_DAY ? [questEvent(db, winnerId, 'fpaid'),
    db.prepare('UPDATE users SET gold = gold + ?, xp = xp + ? WHERE id = ?').bind(WIN_GOLD, WIN_XP, winnerId)] : [])];
}

// ---- social ----
const ONLINE_MS = 5 * 60 * 1000;
const PERSON = `u.id, u.username, u.xp, u.team, p.seen, p.avatar, (SELECT cleared FROM progress WHERE user_id = u.id) AS cleared`;
// battle / trade: whether they've unlocked Friendly Battles and trading (the app greys those buttons out otherwise)
const person = r => ({ name: r.username, level: levelFor(r.xp), avatar: avatarOf(r.avatar, r.team),
  online: !!r.seen && now() - r.seen < ONLINE_MS, seen: r.seen || null,
  battle: isUnlocked('friends', r.cleared ?? 0, levelFor(r.xp)), trade: isUnlocked('trades', r.cleared ?? 0, levelFor(r.xp)) });
// Players in the Ranked tables (and its weekly moves, season rewards and opponents): only those who've unlocked it.
const RANKED_IN = `COALESCE((SELECT cleared FROM progress WHERE user_id = u.id), 0) >= ${UNLOCKS.ranked.cleared}`;
const GAUNTLET_IN = `COALESCE((SELECT cleared FROM progress WHERE user_id = u.id), 0) >= ${UNLOCKS.gauntlet.cleared}`;   // same, for its friends board
// The other player must have the feature open too, not just you.
async function theyNeed(db, other, key, what) {
  if (!isUnlocked(key, (await getProgress(db, other.id)).cleared, levelFor(other.xp))) {
    throw new HttpError(400, `${other.username} hasn't unlocked ${what} yet (${UNLOCKS[key].text}).`);
  }
}

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
  return [cards.map(t => cardOf(t) + (t.includes('#') ? '#' + fusedIdOf(t) : '')), g];   // "L#12.0" is "L#12": one copy can't be listed twice
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
  await needUnlock(db, user, 'trades');
  await theyNeed(db, other, 'trades', 'trading');
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
  await needUnlock(db, user, 'trades');
  const b = await body(req);
  const other = await friendByName(db, user, b.to ?? '');
  await theyNeed(db, other, 'trades', 'trading');
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
  if (action === 'accept') await needUnlock(db, user, 'trades');
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
  if (t.get_gold) {
    const paid = await db.prepare('UPDATE users SET gold = gold - ? WHERE id = ? AND gold >= ?').bind(t.get_gold, user.id, t.get_gold).run();
    if (!paid.meta.changes) await fail("You don't have the gold this offer asks for.");
  }
  // I get their held side now; mine is held for them until they claim it from the Social tab
  await db.batch([...handTo(db, user.id, give, t.give_gold), ...holdOut(db, user.id, get),
    questEvent(db, user.id, 'trade'), questEvent(db, t.from_id, 'trade')]);
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
  await needUnlock(db, user, 'friends');
  await theyNeed(db, other, 'friends', 'Friendly Battles');
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
  await needUnlock(db, user, 'spin');
  const t = now();
  // claim today's spin first so two quick taps can't both win
  const res = await db.prepare(`INSERT INTO spins (user_id, last) VALUES (?1, ?2)
    ON CONFLICT (user_id) DO UPDATE SET last = ?2 WHERE spins.last < ?3`).bind(user.id, t, dayStart(t)).run();
  if (!res.meta.changes) throw new HttpError(400, 'You already spun today. Come back tomorrow!');
  const slot = spinWheel();
  const prize = SPIN_SLOTS[slot];
  let cards = null;
  await questEvent(db, user.id, 'spin').run();
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
    const { results } = await db.prepare(`SELECT u.id, u.username, r.rank, r.week, r.points, r.best FROM users u LEFT JOIN ranked r ON r.user_id = u.id
      WHERE ${RANKED_IN}`).all();
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
        SELECT u.id, 0, ?1, 0, 0, json_object('season', ?2, 'rank', 0) FROM users u WHERE u.id NOT IN (SELECT user_id FROM ranked) AND ${RANKED_IN}`).bind(week, meta.season),
      db.prepare(`UPDATE ranked SET reward = json_object('season', ?1, 'rank', MAX(best, rank)), rank = MAX(0, rank - 2), best = MAX(0, rank - 2)`).bind(meta.season),
    ]);
  }
}

async function rankedView(db, user) {
  await rankedRollover(db);
  const t = now(), week = weekStart(t), me = await rankedRow(db, user.id);
  const { results } = await db.prepare(`SELECT u.id, u.username AS name, COALESCE(r.rank, 0) AS rank, r.week, r.points
    FROM users u LEFT JOIN ranked r ON r.user_id = u.id WHERE COALESCE(r.rank, 0) = ?1 AND (${RANKED_IN} OR u.id = ?2)`).bind(me.rank, user.id).all();
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
    bumpProgress(db, me.user_id, 'wins'), questEvent(db, me.user_id, 'rwin'));
  return { writes, delta: won ? RANKED_WIN : -Math.min(RANKED_LOSS, weekPoints(me, week)), points };
}

// Live ranked matches are friend-battle matches whose code starts with '#'; they pay out here instead.
async function finishRankedMatch(db, m, winnerId, payWinner = true) {   // payWinner false: an early quit, only the quitter's loss counts
  await rankedRollover(db);
  const week = weekStart(now()), writes = [];
  for (const id of [m.p0, m.p1]) if (payWinner || id !== winnerId) writes.push(...rankedResult(db, await rankedRow(db, id), id === winnerId, week).writes);
  await db.batch(writes);
}

// Find a match: pair with someone else searching right now, otherwise keep waiting (the app asks again every few seconds).
async function rankedSearch(db, user) {
  needFullTeam(user);
  await needUnlock(db, user, 'ranked');
  await rankedRollover(db);
  const view = await rankedView(db, user);
  if (view.liveMatch || view.run) return json({ view });
  await db.prepare('DELETE FROM ranked_queue WHERE since < ?').bind(now() - 20000).run();
  // the same two players meet at most RANKED_PAIR_DAY times a day (a second account can't feed someone points)
  const other = await db.prepare(`SELECT q.user_id, u.team FROM ranked_queue q JOIN users u ON u.id = q.user_id WHERE q.user_id != ?1
    AND (SELECT COUNT(*) FROM matches m WHERE m.code LIKE '#%' AND m.updated > ?2
      AND ((m.p0 = ?1 AND m.p1 = q.user_id) OR (m.p1 = ?1 AND m.p0 = q.user_id))) < ?3
    ORDER BY q.since LIMIT 1`).bind(user.id, dayStart(now()), RANKED_PAIR_DAY).first();
  if (other) {
    const claimed = await db.prepare('DELETE FROM ranked_queue WHERE user_id = ?').bind(other.user_id).run();
    if (claimed.meta.changes) {
      const state = newBattle(JSON.parse(other.team), JSON.parse(user.team), Math.random, await fusionsFor(db, other.user_id), await fusionsFor(db, user.id));
      state.pw = [await loadout(db, other.user_id), await loadout(db, user.id)];
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
  await needUnlock(db, user, 'ranked');
  await db.prepare('DELETE FROM ranked_queue WHERE user_id = ?').bind(user.id).run();
  const view = await rankedView(db, user);
  if (view.liveMatch || view.run) return json({ view });
  const me = await rankedRow(db, user.id);
  const { results } = await db.prepare(`SELECT u.id, u.username, u.team, COALESCE(r.rank, 0) AS rank, p.avatar FROM users u
    LEFT JOIN ranked r ON r.user_id = u.id LEFT JOIN presence p ON p.user_id = u.id WHERE u.id != ? AND ${RANKED_IN}`).bind(user.id).all();
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
  run.state.pw = [await loadout(db, user.id), rankedPowers(me.rank)];   // computer-played opponents (and ghosts) get powers by rank
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
  const had = [...(run.state.pw?.[0] ?? [])];
  try {
    applyMove(run.state, 0, from, kind, to);
    while (run.state.winner === null && run.state.turn === 1) { const m = aiMove(run.state, 1); applyMove(run.state, 1, m.from, m.move, m.to); }
  } catch (e) { throw new HttpError(400, e.message); }
  const spend = () => spendPowers(db, user.id, had, run.state.pw?.[0]);   // only once the move is saved
  if (run.state.winner === null) {
    const res = await db.prepare('UPDATE ranked SET run = ? WHERE user_id = ? AND run = ?').bind(JSON.stringify(run), user.id, me.run).run();
    if (!res.meta.changes) throw new HttpError(409, 'The fight changed. Refreshing.');
    await spend();
    return json({ state: run.state, result: null, profile: null });
  }
  return json({ state: run.state, ...(await endRankedRun(db, user, me, run.state.winner === 0, spend)) });
}

async function endRankedRun(db, user, me, won, spend = null) {
  const claim = await db.prepare('UPDATE ranked SET run = NULL WHERE user_id = ? AND run = ?').bind(user.id, me.run).run();   // claim first: no double pay
  if (!claim.meta.changes) throw new HttpError(409, 'The fight changed. Refreshing.');
  if (spend) await spend();
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
  await needUnlock(db, user, 'hunt');
  const foes = huntFoes(period);
  const state = JSON.stringify(huntBattle(team, foes, await fusionsFor(db, user.id), await loadout(db, user.id), period));
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
  const had = [...(state.pw?.[0] ?? [])];
  try {
    applyMove(state, 0, from, kind, to);
    while (state.winner === null && state.turn === 1) {
      const m = aiMove(state, 1);
      applyMove(state, 1, m.from, m.move, m.to);
    }
  } catch (e) { throw new HttpError(400, e.message); }
  const spend = () => spendPowers(db, user.id, had, state.pw?.[0]);   // after each save below: a double-submit can't use a card up
  if (state.winner === null) {
    await saveHunt(db, user.id, h, state, null);
    await spend();
    return json({ legend: h.legend, state, result: null, profile: null });
  }
  if (state.winner === 1) {
    await saveHunt(db, user.id, h, null, 'lost');
    await spend();
    return json({ legend: h.legend, state, result: { won: false }, profile: await profile(db, await freshUser(db, user.id)) });
  }
  await saveHunt(db, user.id, h, null, 'won');   // claim the win first
  await spend();
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
  await needUnlock(db, user, 'gauntlet');
  const team = JSON.parse(user.team), fus = await fusionsFor(db, user.id);
  const hp = team.map(id => fusedHp(id, fus[id]));
  const enemies = gauntletEnemies(1);
  const run = { team, hp, fus, fight: 1, wins: 0, gold: 0, packs: 0, startBest: g.best, enemies, state: gauntletBattle(team, hp, enemies, fus, await loadout(db, user.id), 1) };
  await saveGauntlet(db, user.id, g.run, run, g.best);
  return json(gauntletView(run));
}

async function nextGauntletFight(db, user) {
  const g = await getGauntlet(db, user.id);
  const run = JSON.parse(g.run);
  if (!run) throw new HttpError(400, 'No Gauntlet run in progress.');
  if (!run.state) {
    run.state = gauntletBattle(run.team, run.hp, run.enemies, run.fus || {}, await loadout(db, user.id), run.fight, run.cds);
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
  const had = [...(run.state.pw?.[0] ?? [])];
  try {
    applyMove(run.state, 0, from, kind, to);
    while (run.state.winner === null && run.state.turn === 1) {
      const m = aiMove(run.state, 1);
      applyMove(run.state, 1, m.from, m.move, m.to);
    }
  } catch (e) { throw new HttpError(400, e.message); }
  const spend = () => spendPowers(db, user.id, had, run.state.pw?.[0]);   // after each save below: a double-submit can't use a card up

  const view = gauntletView(run);
  if (run.state.winner === 1) {
    const over = await endGauntlet(db, user, g, run);
    await spend();
    return json({ run: view, result: { won: false, ...over }, profile: await profile(db, await freshUser(db, user.id)) });
  }
  if (run.state.winner === null) {
    await saveGauntlet(db, user.id, g.run, run, g.best);
    await spend();
    return json({ run: view, result: null, profile: null });
  }
  // won: pay out, heal, line up the next fight
  const gold = gauntletGold(run.fight);
  const next = { ...run, wins: run.wins + 1, gold: run.gold + gold, fight: run.fight + 1,
    hp: gauntletHeal(run.state.teams[0]), cds: gauntletCooldowns(run.state.teams[0]), enemies: gauntletEnemies(run.fight + 1), state: null };
  let pack = null, packType = null, holo = null;
  next.xp = (run.xp || 0) + gauntletXp(run.fight);
  const writes = [db.prepare('UPDATE users SET gold = gold + ?, xp = xp + ? WHERE id = ?').bind(gold, gauntletXp(run.fight), user.id), bumpProgress(db, user.id, 'wins'),
    questEvent(db, user.id, 'streak', next.wins, true), ...(next.wins === 10 ? [questEvent(db, user.id, 'g10')] : [])];
  if (next.wins % GAUNTLET_PACK_EVERY === 0) {
    packType = (await getProgress(db, user.id)).cleared < UNLOCKS.packs.cleared ? 'cyber' : freePack();   // Cyber only until chapter 1 is beaten
    const opened = openPack(user.packs_since_legend, packType);
    pack = opened.cards; holo = opened.holo;
    next.packs++;
    writes.push(...packWrites(db, user.id, opened, packType),
      db.prepare('UPDATE users SET packs_since_legend = ? WHERE id = ?').bind(opened.packsSinceLegend, user.id));
  }
  await saveGauntlet(db, user.id, g.run, next, next.wins);   // claim the win first so a double-submit can't pay twice
  await spend();
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
        WHERE u.id = ?1 OR (${GAUNTLET_IN} AND u.id IN (SELECT f.friend_id FROM friends f JOIN friends g ON g.user_id = f.friend_id AND g.friend_id = f.user_id WHERE f.user_id = ?1))
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
async function deleteAccount(req, db, user) {
  const { password = '' } = await body(req);   // asked again: a stolen session alone can't delete an account
  await checkPassword(db, user, password);
  const id = user.id;
  // what other players have held in trades with this account goes back to them (or is paid out, if this account accepted)
  const held = (await db.prepare("SELECT * FROM trades WHERE to_id = ? AND status IN ('open', 'accepted')").bind(id).all()).results;
  const mine = (await db.prepare("SELECT give FROM trades WHERE from_id = ? AND status = 'open'").bind(id).all()).results;
  const heldFused = mine.flatMap(t => JSON.parse(t.give)).filter(tok => tok.includes('#')).map(fusedIdOf);   // parked with user 0
  await db.batch([
    ...held.flatMap(t => t.status === 'open' ? giveBack(db, t) : handTo(db, t.from_id, JSON.parse(t.get), t.get_gold)),
    db.prepare('DELETE FROM friends WHERE user_id = ?1 OR friend_id = ?1').bind(id),
    db.prepare('DELETE FROM challenges WHERE to_id = ?1 OR match_id IN (SELECT id FROM matches WHERE p0 = ?1 OR p1 = ?1)').bind(id),
    db.prepare('DELETE FROM matches WHERE p0 = ?1 OR p1 = ?1').bind(id),
    db.prepare('DELETE FROM trades WHERE from_id = ?1 OR to_id = ?1').bind(id),
    db.prepare('DELETE FROM fused WHERE user_id = ?1').bind(id),
    ...heldFused.map(f => db.prepare('DELETE FROM fused WHERE id = ? AND user_id = 0').bind(f)),
    ...['collection', 'sessions', 'progress', 'presence', 'spins', 'gauntlet', 'shop_buys', 'hunts', 'daily_quests', 'quest_events', 'ranked', 'ranked_queue', 'pack_inv', 'powers', 'power_team', 'main_quest', 'emails', 'agreements', 'seen_cards', 'email_tokens', 'locks', 'activity'].map(t => db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(id)),
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

async function route(req, env, ctx) {
  const db = env.DB;
  const { pathname } = new URL(req.url);
  const [, a, b, c] = pathname.split('/');
  const method = req.method;

  if (method === 'GET' && pathname === '/') return json({ name: 'HoloSynth', ok: true });   // the web build's index.html answers / first when deployed
  if (method === 'GET' && pathname === '/cards.json') return withHeaders(json(CARDS), { 'Cache-Control': 'public, max-age=300' });
  if (method === 'GET' && pathname === '/HoloSynth.ipa') return file(env, 'HoloSynth.ipa', 'application/octet-stream');
  if (method === 'GET' && pathname === '/source.json') return file(env, 'source.json', 'application/json');
  if (method === 'GET' && pathname === '/icon.png') return file(env, 'icon.png', 'image/png');
  // card art the app downloads (and keeps); the ?v=hash in the app's request makes a long cache safe
  if (method === 'GET' && pathname === '/art/manifest.json') return file(env, 'art/manifest.json', 'application/json');
  if (method === 'GET' && /^\/art\/[a-z0-9_]+\.webp$/.test(pathname)) {
    const res = await file(env, pathname.slice(1), 'image/webp');
    if (res.ok) res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res;
  }
  if (method === 'POST' && pathname === '/signup') return signup(req, db, env, ctx);
  if (method === 'POST' && pathname === '/password/forgot') return forgotPassword(req, db, env, ctx);
  if (method === 'POST' && pathname === '/password/reset') return resetPassword(req, db);
  if (method === 'GET' && pathname === '/verify') return verifyLink(req, db);
  if (method === 'POST' && pathname === '/login') return login(req, db, ctx);

  const user = await currentUser(req, db, ctx);
  // last seen, for "online" on friends lists (written at most every 30 s), and which days each player played (the usage
  // dashboard), in the background: no request waits on them
  ctx.waitUntil(db.batch([db.prepare(`INSERT INTO presence (user_id, seen) VALUES (?1, ?2)
    ON CONFLICT (user_id) DO UPDATE SET seen = ?2 WHERE presence.seen < ?2 - 30000`).bind(user.id, now()),
    db.prepare('INSERT OR IGNORE INTO activity (user_id, day) VALUES (?, ?)').bind(user.id, dayStart(now()))]));
  if (method === 'GET' && pathname === '/me') return json(await profile(db, user));
  if (method === 'POST' && pathname === '/me/delete') return deleteAccount(req, db, user);
  if (method === 'POST' && pathname === '/logout') return logout(req, db);
  if (method === 'POST' && pathname === '/me/email') return setEmail(req, db, user, env, ctx);
  if (method === 'POST' && pathname === '/me/verify') return resendVerify(db, env, user);
  if (method === 'POST' && pathname === '/me/agree') return agree(req, db, user);
  if (method === 'POST' && pathname === '/cards/seen') return seeCards(req, db, user);
  if (method === 'POST' && pathname === '/team') return locked(db, user.id, u => setTeam(req, db, u));
  if (method === 'POST' && pathname === '/fuse') return locked(db, user.id, u => fuseCard(req, db, u));
  if (method === 'POST' && pathname === '/shop') return buyShop(req, db, user);
  if (method === 'POST' && pathname === '/packs/open') return openInv(req, db, user);
  if (method === 'POST' && pathname === '/powers/team') return setPowerTeam(req, db, user);
  if (method === 'POST' && pathname === '/packs') return buyPack(db, user, String((await body(req)).type ?? 'cyber'));
  if (method === 'POST' && pathname === '/recruit') return locked(db, user.id, u => openRecruit(db, u));
  if (method === 'POST' && pathname === '/mainquest/claim') return claimMain(db, user);
  if (method === 'POST' && pathname === '/avatar') return setAvatar(req, db, user);
  if (method === 'POST' && pathname === '/spin') return spin(db, user);
  if (method === 'GET' && pathname === '/social') return json(await socialView(db, user));
  if (method === 'GET' && a === 'players' && b) return playerCard(db, user, decodeURIComponent(b));
  if (method === 'POST' && pathname === '/friends') return addFriend(req, db, user);
  if (method === 'POST' && pathname === '/friends/remove') return removeFriend(req, db, user);
  if (method === 'POST' && pathname === '/friends/challenge') return challengeFriend(req, db, user);
  if (method === 'POST' && pathname === '/challenges/decline') return declineChallenge(req, db, user);
  if (method === 'GET' && a === 'trades' && b === 'cards' && c) return tradeCards(db, user, decodeURIComponent(c));
  if (method === 'POST' && pathname === '/trades') return locked(db, user.id, u => offerTrade(req, db, u));
  if (method === 'POST' && pathname === '/trades/claim') return locked(db, user.id, u => claimTrade(req, db, u));
  if (method === 'POST' && a === 'trades' && ['accept', 'decline', 'cancel'].includes(b)) return locked(db, user.id, u => answerTrade(req, db, u, b));
  if (a === 'campaign') {
    if (method === 'GET' && b === 'current') return json(runView(JSON.parse((await getProgress(db, user.id)).run)));
    if (method === 'GET' && b === 'map') return json(campaignMap((await getProgress(db, user.id)).cleared));
    if (method === 'POST' && b === 'start') return startCampaign(db, user);
    if (method === 'POST' && b === 'move') return withPower(req, db, user, () => campaignMove(req, db, user));
    if (method === 'POST' && b === 'leave') return leaveCampaign(db, user);
  }
  if (method === 'POST' && pathname === '/quests/claim') return claimQuest(req, db, user);
  if (a === 'ranked') {
    if (method === 'GET' && !b) { await needUnlock(db, user, 'ranked'); return json(await rankedView(db, user)); }
    if (method === 'POST' && b === 'search') return rankedSearch(db, user);
    if (method === 'POST' && b === 'cancel') return rankedCancel(db, user);
    if (method === 'POST' && b === 'ghost') return rankedGhost(db, user);
    if (method === 'POST' && b === 'move') return withPower(req, db, user, () => rankedMove(req, db, user));
    if (method === 'POST' && b === 'leave') return rankedLeave(db, user);
    if (method === 'POST' && b === 'seen') return rankedSeen(db, user);
    if (method === 'POST' && b === 'claim') return rankedClaim(db, user);
  }
  if (a === 'hunt') {
    if (method === 'GET' && !b) return huntHome(db, user);
    if (method === 'POST' && b === 'start') return startHunt(db, user);
    if (method === 'POST' && b === 'move') return withPower(req, db, user, () => huntMove(req, db, user));
    if (method === 'POST' && b === 'leave') return leaveHunt(db, user);
  }
  if (a === 'gauntlet') {
    if (method === 'GET' && !b) return gauntletHome(db, user);
    if (method === 'POST' && b === 'start') return startGauntlet(db, user);
    if (method === 'POST' && b === 'next') return nextGauntletFight(db, user);
    if (method === 'POST' && b === 'move') return withPower(req, db, user, () => gauntletMove(req, db, user));
    if (method === 'POST' && b === 'leave') return leaveGauntlet(db, user);
  }
  if (method === 'GET' && a === 'leaderboard' && (b === 'friends' || b === 'everyone')) return json(await leaderboard(db, user, b));
  if (a === 'matches') {
    if (method === 'POST' && !b) return createMatch(db, user);
    if (method === 'GET' && b === 'current') return currentMatch(db, user);
    if (method === 'POST' && b === 'join') return joinMatch(req, db, user);
    const id = Number(b);
    if (method === 'GET' && !c) return json(await matchView(db, await getMatch(db, user, id), user));
    if (method === 'POST' && c === 'move') return withPower(req, db, user, () => move(req, db, user, id));
    if (method === 'POST' && c === 'leave') return leaveMatch(db, user, id);
  }
  throw new HttpError(404, 'Not found.');
}

const withHeaders = (res, h) => { for (const [k, v] of Object.entries(h)) res.headers.set(k, v); return res; };
const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" };

// Browsers (the web client) are told apart by their Origin header. A request from another site is refused outright, and a
// cookie-signed change must come from this site (no cross-site request forgery). Logging in from the web sets the cookie
// instead of handing the page a token.
async function handle(req, env, ctx) {
  const self = new URL(req.url).origin, origin = req.headers.get('Origin');
  const { pathname } = new URL(req.url);
  const legal = pathname.match(/^\/(privacy|terms)(\.html)?$/);   // the legal pages live on holosynth.app; older app builds still link here
  if (legal) return new Response(null, { status: 301, headers: { Location: `https://holosynth.app/${legal[1]}` } });
  const changes = req.method !== 'GET' && req.method !== 'HEAD';
  const viaCookie = !req.headers.get('Authorization') && !!cookieToken(req);
  if (origin && origin !== self) throw new HttpError(403, 'Not allowed.');
  if (viaCookie && changes && !origin) throw new HttpError(403, 'Not allowed.');
  let res;
  try { res = await route(req, env, ctx); }
  catch (e) {
    // a browser opening an address that isn't a page (or needs a login) goes to the game page, which shows Play or sign-up
    if (req.method === 'GET' && req.headers.get('Sec-Fetch-Mode') === 'navigate' && e instanceof HttpError && (e.status === 404 || e.status === 401)) {
      return new Response(null, { status: 302, headers: { Location: self + '/' } });
    }
    throw e;
  }
  if (!res.ok) return res;
  if (origin && (pathname === '/login' || pathname === '/signup')) {
    const { token, profile } = await res.json();
    res = json({ profile });
    res.headers.append('Set-Cookie', sessionCookie(token, SESSION_MS / 1000));
  } else if (viaCookie && (pathname === '/logout' || pathname === '/me/delete')) {
    res.headers.append('Set-Cookie', sessionCookie('', 0));
  } else if (viaCookie && pathname === '/me') {
    res.headers.append('Set-Cookie', sessionCookie(cookieToken(req), SESSION_MS / 1000));   // the session slides; so does the cookie
  }
  return res;
}

export default {
  async fetch(req, env, ctx) {
    let res;
    try { res = await handle(req, env, ctx); }
    catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      res = e instanceof HttpError ? json({ error: e.message }, e.status) : json({ error: 'Server error. Try again.' }, 500);
    }
    if (!res.headers.has('Cache-Control')) res.headers.set('Cache-Control', 'no-store');
    return withHeaders(res, SECURITY);
  },
};
