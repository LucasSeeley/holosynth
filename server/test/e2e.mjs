// End-to-end check against a running server: node test/e2e.mjs http://localhost:8799
// Two players sign up, pick a starter, play the campaign (computer opponent) to unlock friend battles,
// play each other by invite code, then one beats the level 10 boss for its pack and buys a pack.
import { aiMove } from '../src/game.js';
import { execSync } from 'node:child_process';

const base = process.argv[2] || 'http://localhost:8799';
// The live server sometimes drops a connection (ECONNRESET) mid-run; retry those a couple of times.
const send = async (url, init, tries = 3) => {
  try { return await fetch(url, init); } catch (e) { if (tries <= 1) throw e; await new Promise(r => setTimeout(r, 1500)); return send(url, init, tries - 1); }
};
const call = async (path, token, body) => {
  const res = await send(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${data.error}`);
  return data;
};
const expectError = async (p, status) => { try { await p; } catch (e) { if (e.message.includes(` ${status} `)) return; throw e; } throw new Error(`expected ${status}`); };
const check = (ok, msg) => { if (!ok) throw new Error(msg); };

// card art the app downloads (uploaded by the build before this test; not there on a local server)
if (!base.includes('localhost')) {
  // KV can serve a cached "missing" for up to a minute after the upload, so give it time
  let man = null;
  for (let i = 0; i < 12 && !man?.volt; i++) {
    man = await fetch(`${base}/art/manifest.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (!man?.volt) await new Promise(r => setTimeout(r, 10000));
  }
  check(Object.keys(man).length >= 114, 'card art uploaded');
  const img = await fetch(`${base}/art/volt.webp?v=${man.volt}`);
  check(img.ok && img.headers.get('content-type') === 'image/webp', 'card art served');
}

// Clear out test players a failed earlier run left behind (a passing run deletes its own at the end).
{
  const old = "(SELECT id FROM users WHERE username LIKE 'e2e\\_%' ESCAPE '\\')";   // test players are e2e_a_… / e2e_b_…
  const sql = [`DELETE FROM friends WHERE user_id IN ${old} OR friend_id IN ${old}`,
    `DELETE FROM challenges WHERE to_id IN ${old} OR match_id IN (SELECT id FROM matches WHERE p0 IN ${old} OR p1 IN ${old})`,
    `DELETE FROM matches WHERE p0 IN ${old} OR p1 IN ${old}`, `DELETE FROM trades WHERE from_id IN ${old} OR to_id IN ${old}`,
    ...'fused collection sessions progress presence spins gauntlet shop_buys hunts daily_quests quest_events ranked ranked_queue pack_inv powers power_team main_quest'.split(' ').map(t => `DELETE FROM ${t} WHERE user_id IN ${old}`),
    `DELETE FROM users WHERE id IN ${old}`].join('; ');
  try { execSync(`npx wrangler d1 execute holosynth --remote --command "${sql}"`, { cwd: new URL('..', import.meta.url), stdio: 'ignore' }); }
  catch { console.log('could not clear old test players'); }
}
const tag = Date.now().toString(36).slice(-6);
// How long the common calls take (shown as a notice on the build).
const timed = async (label, p) => { const t0 = Date.now(); const r = await p; timings.push(`${label} ${Date.now() - t0}ms`); return r; };
const timings = [];
const a = await call('/signup', null, { username: `e2e_a_${tag}`, password: 'secret1' });
const b = await call('/signup', null, { username: `e2e_b_${tag}`, password: 'secret2' });
for (let i = 0; i < 3; i++) await timed('me', call('/me', a.token));
check(a.profile.recruit === 1 && a.profile.gold === 0 && a.profile.team.length === 0 && a.profile.mainQuest.step === 1, 'new account starts empty, one Recruit Pack to open');
await expectError(call('/signup', null, { username: `E2E_A_${tag}`, password: 'secret1' }), 409);
await expectError(call('/login', null, { username: `e2e_a_${tag}`, password: 'nope' }), 401);
await call('/login', null, { username: `e2e_a_${tag}`, password: 'secret1' });

await expectError(call('/campaign/start', a.token, {}), 400);   // no card yet
const r1 = await call('/recruit', a.token, {});
check(['volt', 'fang', 'goliath'].includes(r1.card) && r1.profile.team.length === 1 && r1.profile.recruit === 0, 'recruit pack gives a starter');
await call('/recruit', b.token, {});
await expectError(call('/recruit', a.token, {}), 400);   // only one until level 3
check(r1.profile.mainQuest.done, 'main quest 1 done');
const mq = await call('/mainquest/claim', a.token, {});
check(mq.profile.gold === 100 && mq.profile.mainQuest.step === 2, 'main quest 1 claimed');
await expectError(call('/mainquest/claim', a.token, {}), 400);   // quest 2 not done
check(a.profile.locked.spin && a.profile.locked.shop && a.profile.locked.trades, 'spin, shop and trades start locked');
await expectError(call('/spin', a.token, {}), 400);   // locked until Ch 1 · Lv 10
await expectError(call('/packs', a.token, {}), 400);   // no gold
await expectError(call('/packs', a.token, { type: 'magic' }), 400);   // magic pack: coming soon
await expectError(call('/matches', a.token, {}), 400);  // friend battles locked

// Play campaign levels until `upTo` are cleared, retrying losses; picks the first offered card after level 3.
async function campaign(token, upTo) {
  let prof = await call('/me', token), losses = 0;
  while (prof.campaign.cleared < upTo) {
    if (prof.recruit) { prof = (await call('/recruit', token, {})).profile; continue; }
    let run = await call('/campaign/start', token, {});
    while (!run.result) run = await timed('move', call('/campaign/move', token, aiMove(run.state, 0)));
    if (!run.result.won) losses++;
    check(losses < 20, 'lost too many campaign battles');
    if (run.result.pack) console.log('boss pack:', run.result.pack);
    prof = run.profile;
  }
  while (prof.recruit) prof = (await call('/recruit', token, {})).profile;
  console.log(`cleared ${prof.campaign.cleared} (losses ${losses}); team ${prof.team}; gold ${prof.gold}`);
  return prof;
}
for (const t of [a.token, b.token]) {
  const prof = await campaign(t, 6);
  check(prof.team.length === 3 && prof.campaign.friendsUnlocked && prof.gold >= 900, 'level 6 gives a full team and 900 gold');
}

const inv = await call('/matches', a.token, {});
const joined = await call('/matches/join', b.token, { code: inv.code });
console.log('match', joined.id, 'code', inv.code, 'first turn: player', joined.state.turn);
await expectError(call('/matches/join', b.token, { code: inv.code }), 404);
let view = joined, moves = 0;
const tokens = [a.token, b.token];
while (view.status === 'active') {
  view = await call(`/matches/${view.id}/move`, tokens[view.state.turn], aiMove(view.state, view.state.turn));
  moves++;
}
const me = await call('/me', tokens[view.state.winner]);
console.log(`player ${view.state.winner} won after ${moves} moves; gold ${me.gold}, wins ${me.wins}`);

// friends: request, accept, challenge, decline, challenge again and play
const an = `e2e_a_${tag}`, bn = `e2e_b_${tag}`;
check((await call('/friends', a.token, { name: bn })).message.includes('sent'), 'request sent');
await expectError(call('/friends', a.token, { name: an }), 400);              // yourself
await expectError(call('/friends/challenge', a.token, { name: bn }), 400);    // not friends yet
check((await call('/social', b.token)).requests[0]?.name === an, 'b sees the request');
const card = await call(`/players/${an}`, b.token);
check(card.name === an && card.team.length === 3 && card.cards >= 3 && card.campaign === 'Ch 1 · 7', 'request shows their profile');
await expectError(call('/players/nobody_here', b.token), 404);
const accepted = await call('/friends', b.token, { name: an.toUpperCase() });
check(accepted.message.includes('now friends') && accepted.social.friends[0].online, 'friends and online');
const ch = await call('/friends/challenge', a.token, { name: bn });
check(ch.status === 'waiting' && ch.invitee === bn, 'challenge waiting for ben');
const inbox = await call('/social', b.token);
check(inbox.challenges[0]?.id === ch.id, 'b sees the challenge');
check((await call('/challenges/decline', b.token, { id: ch.id })).social.challenges.length === 0, 'declined');
const ch2 = await call('/friends/challenge', a.token, { name: bn });
const fight = await call('/matches/join', b.token, { code: (await call('/social', b.token)).challenges[0].code });
check(fight.status === 'active' && fight.id === ch2.id, 'challenge accepted');
await call(`/matches/${fight.id}/leave`, a.token, {});
await expectError(call('/avatar', a.token, { card: 'sovereign' }), 400);
check((await call('/avatar', a.token, { card: 'goliath' })).avatar === 'goliath', 'avatar set');
check((await call('/me', b.token)).friends === 1 && (await call('/social', b.token)).friends[0].avatar === 'goliath', 'avatar shows to friends');
await expectError(call('/fuse', a.token, { card: 'volt', stat: 'h' }), 400);   // one copy: nothing to fuse
check(Array.isArray((await call('/me', a.token)).fused), 'profile lists fused copies');
await expectError(call('/trades', a.token, { to: bn, giveGold: 10 }), 400);   // trades locked until player level 7
// Skip the test players ahead (player level 10, Ch 2 · Lv 10) so the unlock-gated modes below can be tested.
const ids = `(SELECT id FROM users WHERE username IN ('${an}', '${bn}'))`;
const skipTo = cleared => execSync(`npx wrangler d1 execute holosynth --remote --command "UPDATE users SET xp = 60000 WHERE id IN ${ids}; UPDATE progress SET cleared = ${cleared} WHERE user_id IN ${ids}"`,
  { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
skipTo(40);
check(Object.keys((await call('/me', a.token)).locked).length === 0, 'everything unlocked');
// trades: team cards are locked, gold-only offers, counter, cancel, accept
await expectError(call('/trades', a.token, { to: bn, give: ['volt'] }), 400);           // on a's team, no spare copy
await expectError(call('/trades', a.token, { to: bn, giveGold: 1e9 }), 400);             // not that much gold
const goldA = (await call('/me', a.token)).gold, goldB = (await call('/me', b.token)).gold;
const offer = await call('/trades', a.token, { to: bn, giveGold: 10 });
const tradeId = offer.social.trades[0].id;
check(offer.social.trades[0].mine && offer.social.trades[0].giveGold === 10, 'offer sent');
check((await call('/me', a.token)).gold === goldA - 10, 'offered gold is held while the offer is open');
const seen = (await call('/social', b.token)).trades[0];
check(seen && !seen.mine && seen.getGold === 10 && seen.name === an, 'b sees the offer from their side');
const counter = await call('/trades', b.token, { to: an, getGold: 20, counter: tradeId });
check((await call('/me', a.token)).gold === goldA, 'countered: held gold goes back');
check(counter.social.trades.length === 1 && counter.social.trades[0].getGold === 20, 'countered replaces the offer');
await expectError(call('/trades/accept', b.token, { id: tradeId }), 404);               // the countered one is closed
check((await call('/trades/cancel', b.token, { id: counter.social.trades[0].id })).social.trades.length === 0, 'cancelled');
const offer2 = await call('/trades', a.token, { to: bn, giveGold: 10 });
const traded = await call('/trades/accept', b.token, { id: offer2.social.trades[0].id });
check(traded.gold === 10 && traded.profile.gold === goldB + 10 && (await call('/me', a.token)).gold === goldA - 10, 'gold traded');
const offer3 = await call('/trades', a.token, { to: bn, getGold: 5 });
await call('/trades/accept', b.token, { id: offer3.social.trades[0].id });
const ready = (await call('/social', a.token)).trades[0];
check(ready?.status === 'accepted' && (await call('/me', a.token)).gold === goldA - 10, 'accepted, waiting to be claimed');
const claimed = await call('/trades/claim', a.token, { id: ready.id });
check(claimed.gold === 5 && claimed.profile.gold === goldA - 5 && claimed.social.trades.length === 1, 'claimed (the gold-only one is still there to claim)');
await expectError(call('/trades/claim', a.token, { id: ready.id }), 404);
const unf = await call('/friends/remove', b.token, { name: an });
check(unf.social.friends.length === 0, 'unfriended');
console.log('social OK');
check((await call('/me', a.token)).nextSpin === 0, 'spin ready');
const sp = await call('/spin', a.token, {});
check(sp.slot >= 0 && sp.slot < 9 && sp.profile.nextSpin > Date.now(), 'spun');
await expectError(call('/spin', a.token, {}), 400);
console.log('spin', sp.kind, sp.amount, sp.cards || '');

// gauntlet: a run, the lobby, the leaderboard
let g = await call('/gauntlet/start', a.token, {});
check(g.fight === 1 && g.state && g.enemies.length === 1, 'gauntlet started');
let fights = 0, out;
for (;;) {
  out = await call('/gauntlet/move', a.token, aiMove(g.state, 0));
  if (!out.result) { g = out.run; continue; }
  if (!out.result.won) break;
  fights++;
  check(out.run.wins === fights && out.run.state.winner === 0, 'win counted');
  g = await call('/gauntlet/next', a.token, {});
  check(g.fight === fights + 1, 'next fight');
}
check(out.result.streak === fights && out.result.newBest === (fights > 0), 'run over');
const lobby = await call('/gauntlet', a.token);
check(lobby.best === fights && lobby.run === null && lobby.top.some(r => r.me), 'lobby');
const everyone = await call('/leaderboard/everyone', a.token);
check(everyone.some(r => r.me && r.best === fights), 'everyone leaderboard');
check((await call('/me', a.token)).gauntlet.best === fights, 'profile best');
console.log('gauntlet streak', fights);

skipTo(9);   // back to just before the Ch 1 boss, to check its pack
const done = await campaign(a.token, 10);
skipTo(40);
check(done.campaign.next?.num === 11 && done.campaign.chapterNum === 1, 'boss beaten, on to level 11');
// won packs wait unopened until you open them
check(done.unopened.length > 0, 'boss pack waits in your packs');
for (const { type, n } of done.unopened) for (let i = 0; i < n; i++) {
  const before = Object.values((await call('/me', a.token)).collection).reduce((x, y) => x + y, 0);
  const o = await call('/packs/open', a.token, { type });
  check(Object.values(o.profile.collection).reduce((x, y) => x + y, 0) === before + o.cards.filter(c => !c.startsWith('pw:')).length, 'opened pack adds its cards');
}
check((await call('/me', a.token)).unopened.length === 0, 'all packs opened');
// power cards: you can only take ones you own into battle
const pmeAll = await call('/me', a.token);
check(typeof pmeAll.powers === 'object' && Array.isArray(pmeAll.powerTeam), 'profile lists power cards');
const ownedPower = Object.keys(pmeAll.powers)[0];
if (ownedPower) check((await call('/powers/team', a.token, { powers: [ownedPower] })).powerTeam[0] === ownedPower, 'power card equipped');
await expectError(call('/powers/team', a.token, { powers: ['singularity', 'singularity', 'singularity'] }), 400);
await expectError(call('/packs/open', a.token, { type: 'omni' }), 400);   // none left
if (done.gold >= 5000) {
  const pack = await call('/packs', a.token, {});
  console.log('bought pack:', pack.cards, 'gold left', pack.profile.gold, 'packs opened', pack.profile.packs);
} else await expectError(call('/packs', a.token, {}), 400);   // packs cost 5000
// daily quests: three a day, claim the finished ones; the bonus pack needs all three
const qs = (await call('/me', a.token)).quests;
check(qs.list.length === 3 && qs.bonus === 'locked', 'three daily quests');
console.log('quests:', qs.list.map(q => `${q.id} ${q.n}/${q.goal}`).join(', '));
await expectError(call('/quests/claim', a.token, { quest: 'bonus' }), 400);
const doneQ = qs.list.findIndex(q => q.n >= q.goal), openQ = qs.list.findIndex(q => q.n < q.goal);
if (openQ >= 0) await expectError(call('/quests/claim', a.token, { quest: openQ }), 400);
if (doneQ >= 0) {
  const g0 = (await call('/me', a.token)).gold, got = await call('/quests/claim', a.token, { quest: doneQ });
  check(got.profile.gold === g0 + qs.list[doneQ].gold && got.profile.quests.list[doneQ].claimed, 'claimed a quest');
  await expectError(call('/quests/claim', a.token, { quest: doneQ }), 400);   // once
}
if (qs.list.every(q => q.n >= q.goal)) {
  for (let i = 0; i < 3; i++) if (i !== doneQ) await call('/quests/claim', a.token, { quest: i });
  const bonus = await call('/quests/claim', a.token, { quest: 'bonus' });
  check(bonus.cards.length === 3 && bonus.type === qs.bonusPack && bonus.profile.quests.bonus === 'claimed', 'all three done: the free pack it showed');
}
// legend hunt: one try a day against a fully fused Legendary
check(done.hunt.status === 'ready' && done.hunt.legend, 'hunt ready');
let hunt = await call('/hunt/start', a.token, {});
check(hunt.status === 'playing' && hunt.state.teams[1][0].f.x && hunt.state.teams[1].length === 3, 'hunt started vs a fully fused legend and its two supports');
check((await call('/hunt/start', a.token, {})).status === 'playing', 'starting again picks the fight back up');
let hres = null;
for (let i = 0; i < 100 && !hres; i++) {
  const st = hunt.state, from = st.teams[0].findIndex((u, k) => u.hp > 0 && !st.acted[0][k]);
  const r = await call('/hunt/move', a.token, { from, move: 'basic', to: st.teams[1].findIndex(u => u.hp > 0) });
  hunt = { state: r.state }; hres = r.result;
}
check(hres && (hres.won ? hres.pack.length === 8 : true), 'hunt over');
check((await call('/me', a.token)).hunt.status === (hres.won ? 'won' : 'lost'), 'hunt used for today');
await expectError(call('/hunt/start', a.token, {}), 400);   // one try a day
console.log('hunt:', hres.won ? 'won ' + hres.pack : 'lost');
const shop = (await call('/me', a.token)).shop.cards;
check(shop.length === 4 && shop[0].price === 2500 && shop[1].price === 500 && !shop[1].sold, 'daily shop: 1 Rare + 3 Commons');
await expectError(call('/shop', a.token, { slot: 1, card: shop[2].id }), 400);   // wrong card for that slot
if (done.gold >= 500) {
  const got = await call('/shop', a.token, { slot: 1, card: shop[1].id });
  check(got.card === shop[1].id && got.profile.shop.cards[1].sold && got.profile.collection[shop[1].id] >= 1, 'bought a shop card');
  await expectError(call('/shop', a.token, { slot: 1, card: shop[1].id }), 400);   // once a day
} else await expectError(call('/shop', a.token, { slot: 1, card: shop[1].id }), 400);   // not enough gold
// ranked: weekly table of 30, a live match when both search, otherwise another player's team played by the computer
let rk = await call('/ranked', a.token);
check(rk.table.length === 30 && rk.table.some(r => r.me) && rk.rank === 0, 'ranked table');
const s1 = await call('/ranked/search', a.token, {});
check(s1.searching === true, 'a is searching');
const s2 = await call('/ranked/search', b.token, {});
check(s2.view.liveMatch, 'b found a live ranked match with a');
check((await call('/ranked/search', a.token, {})).view.liveMatch === s2.view.liveMatch, 'a sees the same match');
check((await call('/matches/current', a.token)) === null, 'ranked matches stay out of friend battles');
let lm = await call(`/matches/${s2.view.liveMatch}`, a.token);
const lt = { [lm.you]: a.token, [1 - lm.you]: b.token };
while (lm.status === 'active') lm = await call(`/matches/${lm.id}/move`, lt[lm.state.turn], aiMove(lm.state, lm.state.turn));
const wa = (await call('/ranked', a.token)).points, wb = (await call('/ranked', b.token)).points;
check(wa + wb === 25, `live ranked scored (${wa} + ${wb})`);
rk = (await call('/ranked/ghost', a.token, {})).view;
check(rk.run && rk.run.opp.team.length === 3, 'ghost fight vs ' + rk.run?.opp.name);
let gs = rk.run.state, gres = null;
for (let i = 0; i < 200 && !gres; i++) {
  const m = aiMove(gs, 0);
  const r = await call('/ranked/move', a.token, m);
  gs = r.state; gres = r.result;
}
check(gres && typeof gres.place === 'number', `ranked fight over: ${gres.won ? 'won' : 'lost'} ${gres.delta}, now #${gres.place}`);
await expectError(call('/ranked/move', a.token, { from: 0, move: 'basic', to: 0 }), 400);
await expectError(call('/ranked/claim', a.token, {}), 400);   // no season reward yet
// leave no test players behind (they'd show up on the live leaderboard)
for (const t of [a.token, b.token]) await call('/me/delete', t, {});
await expectError(call('/me', a.token), 401);
console.log('E2E OK');
console.log(`::notice title=timing::${timings.slice(0, 15).join(', ')}`);
