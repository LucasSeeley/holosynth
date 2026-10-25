// End-to-end check against a running server: node test/e2e.mjs http://localhost:8799
// Two players sign up, one opens a pack, they play a full match by invite code until someone wins.
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

const tag = Date.now().toString(36).slice(-6);
const a = await call('/signup', null, { username: `ana_${tag}`, password: 'secret1' });
const b = await call('/signup', null, { username: `ben_${tag}`, password: 'secret2' });
console.log('signed up, gold', a.profile.gold, 'team', a.profile.team);
await expectError(call('/signup', null, { username: `ANA_${tag}`, password: 'secret1' }), 409);
await expectError(call('/login', null, { username: `ana_${tag}`, password: 'nope' }), 401);
const relog = await call('/login', null, { username: `ana_${tag}`, password: 'secret1' });

const pack = await call('/packs', relog.token, {});
console.log('pack:', pack.cards, 'gold left', pack.profile.gold);
await expectError(call('/packs', relog.token, {}), 400);  // out of gold

const inv = await call('/matches', a.token, {});
const joined = await call('/matches/join', b.token, { code: inv.code });
console.log('match', joined.id, 'code', inv.code, 'first turn: player', joined.state.turn);
await expectError(call('/matches/join', b.token, { code: inv.code }), 404);

let view = joined, moves = 0;
const tokens = [a.token, b.token];
while (view.status === 'active') {
  const p = view.state.turn, st = view.state;
  const from = st.teams[p].findIndex((u, i) => u.hp > 0 && !st.acted[p][i]);
  const to = st.teams[1 - p].findIndex(u => u.hp > 0);
  const special = st.teams[p][from].cd === 0;
  view = await call(`/matches/${view.id}/move`, tokens[p], { from, move: special ? 'special' : 'basic', to });
  moves++;
}
const winner = view.state.winner;
const me = await call('/me', tokens[winner]);
console.log(`player ${winner} won after ${moves} moves; winner gold ${me.gold}, xp ${me.xp}, level ${me.level}`);
console.log('current match after finish:', await call('/matches/current', a.token));
console.log('E2E OK');
