// Pure game rules shared by the server: battles, packs, rewards. No I/O here so it can be tested in node.
import CARDS from '../../shared/cards.json' with { type: 'json' };

export const BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));
export const STARTER_TEAM = ['volt', 'fang', 'goliath'];
export const START_GOLD = 0;           // gold comes from the campaign
export const PACK_COST = 250;
export const PACK_SIZE = 3;
export const PITY_PACKS = 30;          // guaranteed Legendary every 30 packs
export const WIN_GOLD = 50;            // friend battle win
export const CAMPAIGN_GOLD = 25;       // first clear of a campaign level
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
// state: { teams: [[{id,hp,cd}] x2], acted: [[bool] x2], turn, winner, log }. Teams hold 1–3 cards.
export function newBattle(teamA, teamB, rand = Math.random) {
  const side = ids => ids.map(id => ({ id, hp: BY_ID[id].hp, cd: 0 }));
  return {
    teams: [side(teamA), side(teamB)],
    acted: [teamA.map(() => false), teamB.map(() => false)],
    turn: rand() < 0.5 ? 0 : 1,
    winner: null,
    log: [],
  };
}

const alive = u => u.hp > 0;

// Once every living card on a side has acted, all of them are ready again.
function refreshActed(state, p) {
  const team = state.teams[p];
  if (team.every((u, i) => !alive(u) || state.acted[p][i])) state.acted[p] = team.map(() => false);
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
  state.moves = (state.moves || 0) + 1;   // total so far; the log is capped, so the app uses this to spot new moves
  state.log.push({ p, from, to, move, dmg, adv, ko: target.hp === 0 });
  if (state.log.length > 30) state.log.shift();

  if (!foe.some(alive)) state.winner = p;
  else state.turn = 1 - p;
  return state;
}

// Damage a move would do right now (null if it can't be used).
function moveDamage(state, p, from, move, to) {
  const a = state.teams[p][from], t = state.teams[1 - p][to];
  if (!a || !alive(a) || state.acted[p][from] || !t || !alive(t)) return null;
  const card = BY_ID[a.id];
  if (move === 'special' && a.cd > 0) return null;
  const base = move === 'basic' ? card.basic.dmg : card.special.dmg;
  return Math.round(base * (BEATS[card.cls] === BY_ID[t.id].cls ? 1.2 : 1));
}

// Computer opponent: knocks a card out if it can, otherwise deals the most damage it can, hitting the weakest card on ties.
export function aiMove(state, p) {
  let best = null;
  state.teams[p].forEach((_, from) => ['special', 'basic'].forEach(move => state.teams[1 - p].forEach((t, to) => {
    const dmg = moveDamage(state, p, from, move, to);
    if (dmg === null) return;
    // a knockout beats everything, using the weakest move that does it so the special stays ready
    const score = dmg >= t.hp ? 10000 - dmg : dmg * 10 - t.hp / 100;
    if (!best || score > best.score) best = { from, move, to, score };
  })));
  return best && { from: best.from, move: best.move, to: best.to };
}

// ---- campaign ----
// Chapter 1. Levels 1–3: one enemy (you have one card); 4–6: two; 7–10: up to three. Level 10 is the boss.
// You always move first in the campaign; test/game.test.js checks every starter path can win each level.
export const CAMPAIGN = [
  { title: 'Lunch thief', enemies: ['crow'] },
  { title: 'Laughing in the dark', enemies: ['hyena'] },
  { title: 'Night shift', enemies: ['rivet'] },
  { title: 'Heavy lifting', enemies: ['hoist', 'crow'] },
  { title: "Something's buzzing", enemies: ['hive', 'moth'] },
  { title: 'The sorting line', enemies: ['shredder', 'dozer'] },
  { title: 'Swamp out back', enemies: ['croc', 'eel', 'komodo'] },
  { title: 'Security wakes up', enemies: ['sentry', 'warden'] },
  { title: "Magnus's crew", enemies: ['magnus', 'shredder', 'hive'] },
  { title: 'What he built', enemies: ['colossus', 'dozer'], boss: true },
];
export const CHAPTER_TITLE = 'Scrapyard Rumble';
export const NEW_CARD_AFTER = [3, 6];   // levels that unlock your 2nd and 3rd card

// A campaign battle: your team against the level's enemies, and you go first.
export const newCampaignBattle = (team, level) => newBattle(team, CAMPAIGN[level].enemies, () => 0);
