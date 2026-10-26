// End-to-end check against a running server: node test/e2e.mjs http://localhost:8799
// Two players sign up, pick a starter, play the campaign (computer opponent) to unlock friend battles,
// play each other by invite code, then one beats the level 10 boss for its pack and buys a pack.
import { aiMove } from '../src/game.js';

const base = process.argv[2] || 'http://localhost:8799';
const call = async (path, token, body) => {
  const res = await fetch(base + path, {
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

const tag = Date.now().toString(36).slice(-6);
const a = await call('/signup', null, { username: `ana_${tag}`, password: 'secret1' });
const b = await call('/signup', null, { username: `ben_${tag}`, password: 'secret2' });
check(a.profile.needsStarter && a.profile.gold === 0 && a.profile.team.length === 0, 'new account starts empty');
await expectError(call('/signup', null, { username: `ANA_${tag}`, password: 'secret1' }), 409);
await expectError(call('/login', null, { username: `ana_${tag}`, password: 'nope' }), 401);
await call('/login', null, { username: `ana_${tag}`, password: 'secret1' });

await expectError(call('/campaign/start', a.token, {}), 400);   // no card yet
await call('/starter', a.token, { card: 'volt' });
await call('/starter', b.token, { card: 'fang' });
await expectError(call('/starter', a.token, { card: 'goliath' }), 400);   // only one free pick
await expectError(call('/packs', a.token, {}), 400);   // no gold
await expectError(call('/packs', a.token, { type: 'magic' }), 400);   // magic pack: coming soon
await expectError(call('/matches', a.token, {}), 400);  // friend battles locked

// Play campaign levels until `upTo` are cleared, retrying losses; picks the first offered card after level 3.
async function campaign(token, upTo) {
  let prof = await call('/me', token), losses = 0;
  while (prof.campaign.cleared < upTo) {
    if (prof.campaign.choose) { prof = await call('/campaign/reward', token, { card: prof.campaign.choose[0] }); continue; }
    let run = await call('/campaign/start', token, {});
    while (!run.result) run = await call('/campaign/move', token, aiMove(run.state, 0));
    if (!run.result.won) losses++;
    check(losses < 20, 'lost too many campaign battles');
    if (run.result.pack) console.log('boss pack:', run.result.pack);
    if (run.result.newCard) console.log('new card joined:', run.result.newCard);
    prof = run.profile;
  }
  console.log(`cleared ${prof.campaign.cleared} (losses ${losses}); team ${prof.team}; gold ${prof.gold}`);
  return prof;
}
for (const t of [a.token, b.token]) {
  const prof = await campaign(t, 6);
  check(prof.team.length === 3 && prof.campaign.friendsUnlocked && prof.gold === 150, 'level 6 gives a full team and 150 gold');
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
const an = `ana_${tag}`, bn = `ben_${tag}`;
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
const unf = await call('/friends/remove', b.token, { name: an });
check(unf.social.friends.length === 0, 'unfriended');
console.log('social OK');
check((await call('/me', a.token)).nextSpin === 0, 'spin ready');
const sp = await call('/spin', a.token, {});
check(sp.slot >= 0 && sp.slot < 8 && sp.profile.nextSpin > Date.now(), 'spun');
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

const done = await campaign(a.token, 10);
check(done.campaign.next?.num === 11 && done.campaign.chapterNum === 1, 'boss beaten, on to level 11');
if (done.gold >= 1000) {
  const pack = await call('/packs', a.token, {});
  console.log('bought pack:', pack.cards, 'gold left', pack.profile.gold, 'packs opened', pack.profile.packs);
} else await expectError(call('/packs', a.token, {}), 400);   // packs cost 1000
// leave no test players behind (they'd show up on the live leaderboard)
for (const t of [a.token, b.token]) await call('/me/delete', t, {});
await expectError(call('/me', a.token), 401);
console.log('E2E OK');
