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

const done = await campaign(a.token, 10);
check(done.campaign.next?.num === 11 && done.campaign.chapterNum === 1 && done.gold >= 250, 'boss beaten, on to level 11 with enough gold for a pack');
const pack = await call('/packs', a.token, {});
console.log('bought pack:', pack.cards, 'gold left', pack.profile.gold, 'packs opened', pack.profile.packs);
console.log('E2E OK');
