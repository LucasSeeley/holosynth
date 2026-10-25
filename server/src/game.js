// Pure game rules shared by the server: battles, packs, rewards. No I/O here so it can be tested in node.
import CARDS from '../../shared/cards.json' with { type: 'json' };

export const BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));
export const STARTER_TEAM = ['volt', 'fang', 'goliath'];
export const START_GOLD = 250;
export const PACK_COST = 250;
export const PACK_SIZE = 3;
export const PITY_PACKS = 30;          // guaranteed Legendary every 30 packs
export const WIN_GOLD = 50;
export const WIN_XP = 25;
export const XP_PER_LEVEL = 100;
export const RATES = [['Common', 85], ['Rare', 10], ['Epic', 4], ['Legendary', 1]];
const BEATS = { Fighter: 'Beast', Beast: 'Mech', Mech: 'Fighter' };  // +20% damage

export const levelFor = xp => Math.floor(xp / XP_PER_LEVEL) + 1;

// ---- packs ----
function rollRarity(rand) {
  let r = rand() * 100;
  for (const [name, pct] of RATES) { if ((r -= pct) < 0) return name; }
  return 'Common';
}
const pickOf = (rarity, rand) => {
  const pool = CARDS.filter(c => c.rarity === rarity);
  return pool[Math.floor(rand() * pool.length)].id;
};

// Returns { cards: [ids], packsSinceLegend } for one pack.
export function openPack(packsSinceLegend, rand = Math.random) {
  const rarities = Array.from({ length: PACK_SIZE }, () => rollRarity(rand));
  if (!rarities.includes('Legendary') && packsSinceLegend + 1 >= PITY_PACKS) rarities[PACK_SIZE - 1] = 'Legendary';
  return {
    cards: rarities.map(r => pickOf(r, rand)),
    packsSinceLegend: rarities.includes('Legendary') ? 0 : packsSinceLegend + 1,
  };
}

// ---- battles ----
// state: { teams: [[{id,hp,cd}x3] x2], acted: [[bool x3] x2], turn, winner, log }
export function newBattle(teamA, teamB, rand = Math.random) {
  const side = ids => ids.map(id => ({ id, hp: BY_ID[id].hp, cd: 0 }));
  return {
    teams: [side(teamA), side(teamB)],
    acted: [[false, false, false], [false, false, false]],
    turn: rand() < 0.5 ? 0 : 1,
    winner: null,
    log: [],
  };
}

const alive = u => u.hp > 0;

// Once every living card on a side has acted, all of them are ready again.
function refreshActed(state, p) {
  const team = state.teams[p];
  if (team.every((u, i) => !alive(u) || state.acted[p][i])) state.acted[p] = [false, false, false];
}

// Throws an Error with a player-readable message if the move isn't allowed.
export function applyMove(state, p, from, move, to) {
  if (state.winner !== null) throw new Error('The match is over.');
  if (state.turn !== p) throw new Error("It's not your turn.");
  const me = state.teams[p], foe = state.teams[1 - p];
  const attacker = me[from], target = foe[to];
  if (!attacker || !alive(attacker)) throw new Error('That card is knocked out.');
  if (state.acted[p][from]) throw new Error('That card already acted this round.');
  if (!target || !alive(target)) throw new Error('Pick a target that is still standing.');
  if (move !== 'basic' && move !== 'special') throw new Error('Unknown move.');

  const card = BY_ID[attacker.id];
  if (move === 'special' && attacker.cd > 0) throw new Error(`${card.special.name} is cooling down.`);

  const base = move === 'basic' ? card.basic.dmg : card.special.dmg;
  const adv = BEATS[card.cls] === BY_ID[target.id].cls;
  const dmg = Math.round(base * (adv ? 1.2 : 1));
  target.hp = Math.max(0, target.hp - dmg);

  // Cooldown counts the card's own later actions.
  attacker.cd = move === 'special' ? card.special.cd : Math.max(0, attacker.cd - 1);

  state.acted[p][from] = true;
  refreshActed(state, p);
  refreshActed(state, 1 - p);
  state.log.push({ p, from, to, move, dmg, adv, ko: target.hp === 0 });
  if (state.log.length > 30) state.log.shift();

  if (!foe.some(alive)) state.winner = p;
  else state.turn = 1 - p;
  return state;
}
