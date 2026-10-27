// Pure game rules shared by the server: battles, packs, rewards. No I/O here so it can be tested in node.
import CARDS from '../../shared/cards.json' with { type: 'json' };

export const BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));
export const STARTER_TEAM = ['volt', 'fang', 'goliath'];
export const START_GOLD = 0;           // gold comes from the campaign
export const PACK_COST = 5000;
export const PACK_SIZE = 3;
export const WIN_GOLD = 50;            // friend battle win
export const CAMPAIGN_GOLD = [50, 100, 150, 200, 250];   // first clear of a campaign level, by chapter
export const CAMPAIGN_XP = [50, 100, 150, 200, 250];
export const CHAPTERS_OPEN = 5;   // chapters past this show "More chapters are on the way"
export const WIN_XP = 25;
export const XP_PER_LEVEL = 100;
export const RATES = [['Common', 85], ['Rare', 10], ['Epic', 4], ['Legendary', 1]];
// +20% damage. Tech and magic each have a triangle, and every class also beats one class from the other side:
// each class beats 2, is weak to 2 and is even with 1.
export const BEATS = {
  Fighter: ['Beast', 'Arcanist'], Beast: ['Mech', 'Mystic'], Mech: ['Fighter', 'Spirit'],
  Arcanist: ['Spirit', 'Beast'], Spirit: ['Mystic', 'Fighter'], Mystic: ['Arcanist', 'Mech'],
};
const beats = (a, b) => BEATS[a].includes(b);
// A Mystic's special heals one of its own team (special.heal); everything else hits an enemy.
const heals = (card, move) => move === 'special' && !!card.special.heal;

// Each level needs twice the XP of the one before: 100 to reach level 2, 200 more for 3, 400 more for 4...
export const levelStart = level => XP_PER_LEVEL * (2 ** (level - 1) - 1);   // total XP at the start of `level`
export const levelFor = xp => { let l = 1; while (levelStart(l + 1) <= xp) l++; return l; };

// ---- packs ----
function rollRarity(rand) {
  let r = rand() * 100;
  for (const [name, pct] of RATES) { if ((r -= pct) < 0) return name; }
  return 'Common';
}
// Pack types and the classes each holds (omni = every card).
export const PACK_TYPES = { cyber: ['Fighter', 'Beast', 'Mech'], magic: ['Arcanist', 'Spirit', 'Mystic'], omni: null, overload: null, legends: null };
// The Overload Pack is a big Omni: 8 cards for 12,000. The Legends Pack: a guaranteed Legendary plus 4 cards at the
// normal odds, 25,000. Everything else is 3 cards for PACK_COST.
export const PACK_SIZES = { overload: 8, legends: 5 };
export const PACK_COSTS = { overload: 12000, legends: 25000 };
const FREE_TYPES = ['cyber', 'magic', 'omni'];   // free packs are never Overload
export const PACKS_OPEN = ['cyber', 'magic', 'omni', 'overload', 'legends'];   // packs on sale; any left out show "Coming soon"
const pickOf = (rarity, type, rand) => {
  const classes = PACK_TYPES[type];
  const pool = CARDS.filter(c => c.rarity === rarity && (!classes || classes.includes(c.cls)));
  return pool[Math.floor(rand() * pool.length)].id;
};

// Returns { cards: [ids], packsSinceLegend } for one pack of `type`.
export function openPack(packsSinceLegend, type = 'cyber', rand = Math.random) {
  const size = PACK_SIZES[type] ?? PACK_SIZE;
  // the Legends Pack's guaranteed Legendary is the last card, so it's the last one revealed
  const rarities = Array.from({ length: size }, (_, i) => (type === 'legends' && i === size - 1 ? 'Legendary' : rollRarity(rand)));
  return {
    cards: rarities.map(r => pickOf(r, type, rand)),
    packsSinceLegend: rarities.includes('Legendary') ? 0 : packsSinceLegend + 1,
  };
}

// ---- daily spin ----
// The wheel's 9 slots clockwise from the top, as drawn in the app, with their chance out of 100.
export const SPIN_SLOTS = [
  { kind: 'gold', amount: 100, weight: 17 },
  { kind: 'xp', amount: 100, weight: 17 },
  { kind: 'gold', amount: 250, weight: 9 },
  { kind: 'pack', amount: 1, weight: 6 },
  { kind: 'xp', amount: 100, weight: 17 },
  { kind: 'gold', amount: 500, weight: 4 },
  { kind: 'xp', amount: 250, weight: 9 },
  { kind: 'gold', amount: 100, weight: 17 },
  { kind: 'xp', amount: 500, weight: 4 },
];
// The wheel resets at midnight UTC: one spin per UTC day.
const DAY_MS = 24 * 60 * 60 * 1000;
export const dayStart = t => Math.floor(t / DAY_MS) * DAY_MS;
export const nextSpinAt = (last, t) => (last && last >= dayStart(t) ? dayStart(t) + DAY_MS : 0);   // 0 = can spin now
// Free packs (wheel, campaign boss, gauntlet) are a random open type; the wheel's pack changes once a day.
const freeOpen = () => PACKS_OPEN.filter(t => FREE_TYPES.includes(t));
export const freePack = (rand = Math.random) => freeOpen()[Math.floor(rand() * freeOpen().length)];
export const dailyPack = t => {
  let h = Math.floor(t / DAY_MS) * 2654435761 >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  return freeOpen()[((h ^ (h >>> 13)) >>> 0) % freeOpen().length];
};
// ---- daily shop ----
// One Rare and three Commons a day, the same for everyone; resets at midnight UTC. Each player can buy each card once.
export const SHOP_PRICES = { Common: 500, Rare: 2500 };
// mulberry32: the same seed always gives the same numbers.
function seeded(seed) {
  let h = seed >>> 0;
  return () => {
    h = (h + 0x6D2B79F5) >>> 0;
    let x = Math.imul(h ^ (h >>> 15), 1 | h);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
export function dailyShop(t) {
  const rand = seeded(Math.floor(t / DAY_MS) * 2246822519 + 374761393);
  const pick = pool => pool.splice(Math.floor(rand() * pool.length), 1)[0].id;
  const rares = CARDS.filter(c => c.rarity === 'Rare'), commons = CARDS.filter(c => c.rarity === 'Common');
  return [pick(rares), pick(commons), pick(commons), pick(commons)];
}
export function spinWheel(rand = Math.random) {
  let r = rand() * 100;
  for (let i = 0; i < SPIN_SLOTS.length; i++) if ((r -= SPIN_SLOTS[i].weight) < 0) return i;
  return 0;
}

// ---- gauntlet ----
// Endless run: fight after fight with the same team, damage carries over, each win heals 20%. One loss ends it.
export const GAUNTLET_HEAL = 0.2;
export const GAUNTLET_PACK_EVERY = 10;
export const gauntletGold = fight => 50 + 25 * fight;   // fight 1 pays 75, fight 2 pays 100…
const TIERS = ['Common', 'Rare', 'Epic', 'Legendary'];
const POOLS = TIERS.map(r => CARDS.filter(c => c.rarity === r).map(c => c.id));
// One enemy for fights 1–10, two for 11–20, then three; rarer cards creep in as the streak grows.
// Tuned with the computer playing both sides: the starter team averages about 6 wins, epics about 15.
export function gauntletEnemies(fight, rand = Math.random) {
  const size = fight <= 10 ? 1 : fight <= 20 ? 2 : 3;
  return Array.from({ length: size }, (_, i) => {
    const pool = POOLS[Math.min(3, Math.floor((fight + 10 * i) / 30))];
    return pool[Math.floor(rand() * pool.length)];
  });
}
// Fight `fight` against `enemies`, your cards starting at `hp` (knocked-out cards stay at 0). You move first.
export function gauntletBattle(team, hp, enemies, fus = {}) {
  const s = newBattle(team, enemies, () => 0, fus);
  s.teams[0].forEach((u, i) => { u.hp = hp[i]; });
  return s;
}
export const gauntletHeal = team => team.map(u => (u.hp === 0 ? 0 : Math.min(unitMax(u), u.hp + Math.round(unitMax(u) * GAUNTLET_HEAL))));

// ---- daily quests ----
// Three a day per player (midnight UTC): one easy, one medium, one hard. Finish all three for a free Omni pack.
export const QUESTS = {
  spin: { tier: 0, name: 'Spin the wheel', goal: 1 },
  pack: { tier: 0, name: 'Open a pack', goal: 1, hint: 'Bought or won' },
  shop: { tier: 0, name: 'Buy a shop card', goal: 1 },
  wins: { tier: 1, name: 'Win 3 battles', goal: 3, hint: 'Any mode' },
  levels: { tier: 1, name: 'Clear 2 campaign levels', goal: 2 },
  fuse: { tier: 1, name: 'Fuse a card', goal: 1 },
  friend: { tier: 2, name: 'Win a friend battle', goal: 1 },
  streak: { tier: 2, name: 'Reach a 15-win Gauntlet streak', goal: 15 },
  hunt: { tier: 2, name: 'Beat the Legend Hunt', goal: 1 },
};
export const QUEST_PAY = [{ gold: 750, xp: 500 }, { gold: 1000, xp: 750 }, { gold: 1500, xp: 1000 }];   // by tier
export const QUEST_BONUS = 'omni';
// `can` = quest ids this player can do right now. A missing hard quest is swapped for another medium one.
export function pickQuests(userId, t, can, rand = seeded((userId * 2654435761) ^ (Math.floor(t / DAY_MS) * 40503))) {
  const picked = [];
  for (const tier of [0, 1, 2]) {
    let pool = Object.keys(QUESTS).filter(id => QUESTS[id].tier === tier && can.includes(id));
    if (!pool.length) pool = Object.keys(QUESTS).filter(id => QUESTS[id].tier === tier - 1 && can.includes(id) && !picked.includes(id));
    if (pool.length) picked.push(pool[Math.floor(rand() * pool.length)]);
  }
  return picked;
}

// ---- legend hunt ----
// Every 8 hours (00:00, 08:00, 16:00 UTC) one Legendary, fully fused, the same for everyone, with a support card:
// a Rare (lightly fused) or an Epic (maybe a little fused), a healer unless the Legendary heals itself. One try per hunt.
// Beat them for an Overload pack: 1 in 5 hold that Legendary (the plain card, no fusion), the rest a guaranteed Epic.
export const HUNT_MS = 8 * 60 * 60 * 1000;
export const huntStart = t => Math.floor(t / HUNT_MS) * HUNT_MS;
export const HUNT_FUSION = { h: 3, b: 3, s: 3, x: true };
export const HUNT_GOLD = 5000, HUNT_XP = 1000;   // also paid for a win, on top of the pack
const LEGENDS = CARDS.filter(c => c.rarity === 'Legendary').map(c => c.id);
export function huntFoes(t) {
  const rand = seeded(Math.floor(t / HUNT_MS) * 2654435761 + 97);
  const legend = LEGENDS[Math.floor(rand() * LEGENDS.length)];
  const rarity = rand() < 0.5 ? 'Rare' : 'Epic';
  const healer = BY_ID[legend].cls !== 'Mystic';
  const pool = CARDS.filter(c => c.rarity === rarity && (!healer || c.cls === 'Mystic') && c.id !== legend);
  const support = pool[Math.floor(rand() * pool.length)].id;
  const lvl = rarity === 'Rare' ? () => 1 + Math.floor(rand() * 2) : () => Math.floor(rand() * 2);   // Rare 1-2, Epic 0-1 per stat
  return { legend, support, supportFusion: { h: lvl(), b: lvl(), s: lvl(), x: false } };
}
// You move first. Tuned with the computer playing both sides (see scratch sim): hard on purpose.
export const huntBattle = (team, foes, fus = {}) => newBattle(team, [foes.legend, foes.support], () => 0, fus,
  { [foes.legend]: HUNT_FUSION, [foes.support]: foes.supportFusion });
export const HUNT_LEGEND_CHANCE = 0.2;
const EPICS = CARDS.filter(c => c.rarity === 'Epic').map(c => c.id);
// The win's Overload pack: 1 in 5 has the Legendary in it; otherwise it always holds at least one Epic.
export function huntPack(packsSinceLegend, legend, rand = Math.random) {
  const pack = openPack(packsSinceLegend, 'overload', rand);
  const slot = Math.floor(rand() * pack.cards.length);
  if (rand() < HUNT_LEGEND_CHANCE) {
    pack.cards[slot] = legend;
    pack.packsSinceLegend = 0;
  } else if (!pack.cards.some(id => BY_ID[id].rarity === 'Epic')) {
    const plain = pack.cards.map((id, i) => i).filter(i => BY_ID[pack.cards[i]].rarity !== 'Legendary');
    pack.cards[plain[Math.floor(rand() * plain.length)]] = EPICS[Math.floor(rand() * EPICS.length)];
  }
  return pack;
}

// ---- fusion ----
// Fuse 5 spare copies into one copy for +10% HP, +20% basic or +10% special (max 3 each).
// Epic and Legendary cards can also unlock a second, stronger special (10 copies + 10,000 gold); the special bonus applies to it too.
export const FUSE_COST = 5, FUSE_MAX = 3, SECOND_COST = { copies: 10, gold: 10000 };
export const FUSE_GOLD = [1000, 2500, 5000];   // gold for a stat's 1st, 2nd and 3rd fusion
export const SECOND = Object.fromEntries(CARDS.filter(c => c.special2).map(c => [c.id, c.special2]));   // Epic & Legendary only
// f = { h, b, s, x }: fusion levels for HP, basic, special, and whether the second special is unlocked.
export const fusedHp = (id, f) => Math.round(BY_ID[id].hp * (1 + 0.1 * (f?.h || 0)));
export const fusedDmg = (id, f, move) => {
  const c = BY_ID[id];
  if (move === 'basic') return Math.round(c.basic.dmg * (1 + 0.2 * (f?.b || 0)));
  const base = move === 'special2' ? SECOND[id].dmg : c.special.dmg;
  return Math.round(base * (1 + 0.1 * (f?.s || 0)));
};
const unitMax = u => u.max ?? BY_ID[u.id].hp;

// ---- battles ----
// state: { teams: [[{id,hp,cd,max?,f?,cd2?}] x2], acted: [[bool] x2], turn, winner, log }. Teams hold 1–3 cards.
// fusA / fusB: { cardId: f } for fused cards on each side; fused units carry their max HP, levels and second-special cooldown.
export function newBattle(teamA, teamB, rand = Math.random, fusA = {}, fusB = {}) {
  const side = (ids, fus) => ids.map(id => {
    const f = fus[id];
    if (!f) return { id, hp: BY_ID[id].hp, cd: 0 };
    const max = fusedHp(id, f);
    return { id, hp: max, cd: 0, max, f, ...(f.x && SECOND[id] ? { cd2: 0 } : {}) };
  });
  return {
    teams: [side(teamA, fusA), side(teamB, fusB)],
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
  const attacker = me[from];
  if (!attacker || !alive(attacker)) throw new Error('That card is knocked out.');
  if (state.acted[p][from]) throw new Error('That card already acted this round.');
  if (move !== 'basic' && move !== 'special' && !(move === 'special2' && attacker.cd2 !== undefined)) throw new Error('Unknown move.');
  const card = BY_ID[attacker.id];
  if (move === 'special' && attacker.cd > 0) throw new Error(`${card.special.name} is cooling down.`);
  if (move === 'special2' && attacker.cd2 > 0) throw new Error(`${SECOND[attacker.id].name} is cooling down.`);
  const heal = heals(card, move);
  const target = heal ? me[to] : foe[to];
  if (!target || !alive(target)) throw new Error(heal ? 'Pick one of your cards that is still standing.' : 'Pick a target that is still standing.');

  let dmg = 0, healed = 0, adv = false;
  if (heal) {
    healed = Math.min(fusedDmg(attacker.id, attacker.f, 'special'), unitMax(target) - target.hp);   // never above full HP
    target.hp += healed;
  } else {
    const base = fusedDmg(attacker.id, attacker.f, move);
    adv = beats(card.cls, BY_ID[target.id].cls);
    dmg = Math.round(base * (adv ? 1.2 : 1));
    target.hp = Math.max(0, target.hp - dmg);
  }

  // Cooldown counts the card's own later actions.
  attacker.cd = move === 'special' ? card.special.cd : Math.max(0, attacker.cd - 1);
  if (attacker.cd2 !== undefined) attacker.cd2 = move === 'special2' ? SECOND[attacker.id].cd : Math.max(0, attacker.cd2 - 1);

  state.acted[p][from] = true;
  refreshActed(state, p);
  refreshActed(state, 1 - p);
  state.moves = (state.moves || 0) + 1;   // total so far; the log is capped, so the app uses this to spot new moves
  state.log.push(heal ? { p, from, to, move, dmg: 0, heal: healed, adv: false, ko: false }
                      : { p, from, to, move, dmg, adv, ko: target.hp === 0 });
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
  if (move === 'special' && (a.cd > 0 || heals(card, move))) return null;
  if (move === 'special2' && !(a.cd2 === 0)) return null;
  return Math.round(fusedDmg(a.id, a.f, move) * (beats(card.cls, BY_ID[t.id].cls) ? 1.2 : 1));
}

// Computer opponent: knocks a card out if it can, otherwise deals the most damage it can, hitting the weakest card on ties.
export function aiMove(state, p) {
  let best = null;
  state.teams[p].forEach((_, from) => ['special2', 'special', 'basic'].forEach(move => state.teams[1 - p].forEach((t, to) => {
    const dmg = moveDamage(state, p, from, move, to);
    if (dmg === null) return;
    // a knockout beats everything, using the weakest move that does it so the special stays ready
    const score = dmg >= t.hp ? 10000 - dmg : dmg * 10 - t.hp / 100;
    if (!best || score > best.score) best = { from, move, to, score };
  })));
  // Heal instead when a teammate is under half HP and the heal would be mostly used, unless a knockout is on offer.
  if (!best || best.score < 5000) {
    state.teams[p].forEach((a, from) => {
      const card = BY_ID[a.id];
      if (!alive(a) || state.acted[p][from] || a.cd > 0 || !card.special.heal) return;
      state.teams[p].forEach((t, to) => {
        const max = unitMax(t), missing = max - t.hp;
        if (!alive(t) || t.hp * 2 >= max || missing < fusedDmg(a.id, a.f, 'special') * 0.8) return;
        const score = 6000 + missing;
        if (!best || score > best.score) best = { from, move: 'special', to, score };
      });
    });
  }
  return best && { from: best.from, move: best.move, to: best.to };
}

// ---- campaign ----
// Three chapters of 30 levels; every 10th is a boss. Levels 1–3: one enemy (you have one card); 4–6: two; then up to three.
// You always move first; test/game.test.js checks the three starter cards alone can win every level.
export const CHAPTERS = [
  { title: 'Scrapyard Rumble', levels: [
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
    { title: 'Rust bucket brigade', enemies: ['scout', 'gyro', 'moth'] },
    { title: 'Down the drain', enemies: ['burrower', 'mongoose'] },
    { title: 'Junk punks', enemies: ['vandal', 'shiv', 'spike'] },
    { title: 'Forklift fight', enemies: ['crusher', 'hoist'] },
    { title: 'Car crusher', enemies: ['rhino', 'crusher', 'hare'] },
    { title: 'Dog pack', enemies: ['jackal', 'narwhal', 'mongoose'] },
    { title: 'Weld shop', enemies: ['welder', 'railer', 'rivet'] },
    { title: 'Scrap cats', enemies: ['panther', 'vixen', 'viper'] },
    { title: 'Magnetic personality', enemies: ['magnus', 'pylon', 'gyro'] },
    { title: 'The compactor', enemies: ['juggernaut', 'bastion', 'crusher'], boss: true },
    { title: 'Leftover parts', enemies: ['buzzsaw', 'chopper', 'rook'] },
    { title: 'Pit fighters', enemies: ['brick', 'riot', 'monk'] },
    { title: 'Bees again', enemies: ['hive', 'hornet', 'stinger'] },
    { title: 'Tire mountain', enemies: ['boar', 'ram', 'rhino'] },
    { title: 'Spark plugs', enemies: ['ember', 'blaze', 'static'] },
    { title: 'Night watch', enemies: ['watchtower', 'sentry', 'monk'] },
    { title: 'Scrap kings', enemies: ['harvester', 'juggernaut', 'dozer'] },
    { title: 'Big and furry', enemies: ['grizzly', 'silverback', 'viper'] },
    { title: 'Last shift', enemies: ['quake', 'forge', 'gyro'] },
    { title: 'Warlord of the heap', enemies: ['warlord', 'magnus'], boss: true },
  ] },
  { title: 'Chrome Harbor', levels: [
    { title: 'Fresh off the boat', enemies: ['piranha', 'eel', 'hare'] },
    { title: 'Something in the water', enemies: ['shark', 'piranha', 'eel'] },
    { title: 'Dock rats', enemies: ['shiv', 'rogue', 'hare'] },
    { title: 'Cargo cranes', enemies: ['hoist', 'crawler', 'bastion'] },
    { title: 'Ink everywhere', enemies: ['kraken', 'eel', 'siren'] },
    { title: 'Customs check', enemies: ['skyburst', 'warden', 'scout'] },
    { title: 'The fish market', enemies: ['narwhal', 'shark', 'piranha'] },
    { title: 'Smugglers', enemies: ['bounty', 'jackal', 'vesper'] },
    { title: 'Lighthouse keeper', enemies: ['siphon', 'cyclone', 'siren'] },
    { title: 'Jaws of the bay', enemies: ['basilisk', 'rhino', 'kraken'], boss: true },
    { title: 'Container maze', enemies: ['railer', 'gunner', 'mortar'] },
    { title: 'Bilge pumps', enemies: ['siphon', 'pylon', 'juggernaut'] },
    { title: 'Siren song', enemies: ['siren', 'lotus', 'vesper'] },
    { title: 'Gator alley', enemies: ['croc', 'komodo', 'viper'] },
    { title: 'The night ferry', enemies: ['overdrive', 'phantom', 'nyx'] },
    { title: 'Harbor patrol', enemies: ['rook', 'sentry', 'lancer'] },
    { title: 'Rogue wave', enemies: ['narwhal', 'mantis', 'cyclone'] },
    { title: 'Pirate radio', enemies: ['echo', 'glitch', 'cipher'] },
    { title: 'Shipwreck', enemies: ['shark', 'arachne', 'crawler'] },
    { title: 'The dreadnought', enemies: ['dreadnought', 'gunner'], boss: true },
    { title: 'Fog bank', enemies: ['phantom', 'nyx', 'vesper'] },
    { title: 'Dry dock', enemies: ['reactor', 'crusher'] },
    { title: 'Sharks circling', enemies: ['shark', 'sabre', 'piranha'] },
    { title: 'Stowaways', enemies: ['chimera', 'manticore'] },
    { title: "The captain's table", enemies: ['shogun', 'brick', 'monk'] },
    { title: 'Depth charge', enemies: ['skyburst', 'mortar', 'railer'] },
    { title: "The admiral's guard", enemies: ['vanta', 'brick', 'bastion'] },
    { title: 'Black tide', enemies: ['wyvern', 'thunderhide'] },
    { title: 'Storm warning', enemies: ['hellfire', 'rook'] },
    { title: 'Leviathan rising', enemies: ['leviathan', 'cyclone'], boss: true },
  ] },
  { title: 'Storm Grid', levels: [
    { title: 'Live wires', enemies: ['static', 'wirelash', 'neon'] },
    { title: 'Power surge', enemies: ['dynamo', 'overclock', 'siphon'] },
    { title: 'Static cling', enemies: ['static', 'glitch', 'echo'] },
    { title: 'Transformer box', enemies: ['pylon', 'reactor'] },
    { title: 'Lightning bugs', enemies: ['hornet', 'moth', 'stinger'] },
    { title: 'Sky patrol', enemies: ['siphon', 'valkyrie', 'crow'] },
    { title: 'Short circuit', enemies: ['glitch', 'cipher', 'overclock'] },
    { title: 'Thunderheads', enemies: ['mantis', 'cyclone', 'quake'] },
    { title: 'Gridlock', enemies: ['railer', 'lancer', 'bastion'] },
    { title: 'Overload', enemies: ['omega', 'razor'], boss: true },
    { title: 'Neon nights', enemies: ['neon', 'vandal', 'vixen'] },
    { title: 'Arc welders', enemies: ['hellfire', 'welder'] },
    { title: 'Feathers and sparks', enemies: ['chimera', 'crow', 'moth'] },
    { title: 'Wind farm', enemies: ['cyclone', 'gyro', 'chopper'] },
    { title: 'Signal jammers', enemies: ['prism', 'cipher', 'phantom'] },
    { title: 'The blackout', enemies: ['vanta', 'nyx', 'cipher'] },
    { title: 'Storm chasers', enemies: ['wyvern', 'manticore'] },
    { title: 'Firewall', enemies: ['blaze', 'ember', 'hellfire'] },
    { title: 'Copper thieves', enemies: ['hex', 'shiv', 'scarab'] },
    { title: 'Nightblade', enemies: ['nightblade', 'specter', 'brick'], boss: true },
    { title: 'Tesla coils', enemies: ['reactor', 'razor', 'dynamo'] },
    { title: 'Hailstorm', enemies: ['quake', 'mammoth', 'shark'] },
    { title: 'Chrome giants', enemies: ['warlord', 'colossus'] },
    { title: 'Burning sky', enemies: ['phoenix', 'quake'] },
    { title: 'Eye of the storm', enemies: ['omega', 'skyburst'] },
    { title: 'Perfect form', enemies: ['shogun', 'vanta'] },
    { title: 'The old guard', enemies: ['rook', 'bastion', 'warden'] },
    { title: 'Beast mode', enemies: ['leviathan', 'specter'] },
    { title: 'Last light', enemies: ['nightblade', 'rook'] },
    { title: 'The champion', enemies: ['paragon', 'hex', 'shogun'], boss: true },   // chapter 3's last boss: needs pack cards, the starter team can't win it
  ] },
  // Chapters 4 and 5 are tuned for pack cards: a typical collection wins ~70% of chapter 4's first level, ~25% of chapter 5's last.
  { title: 'The Arcane Rift', levels: [
    { title: 'Through the rift', enemies: ['choir', 'mistwyrm', 'moonhare'] },
    { title: 'Glowing welcome', enemies: ['halo', 'rune', 'bloom'] },
    { title: 'Northern lights', enemies: ['aurora', 'lantern', 'tide'] },
    { title: 'Crystal storm', enemies: ['hexblade', 'geode', 'tempest'] },
    { title: 'Stone circle', enemies: ['sanctum', 'geode', 'totem'] },
    { title: 'Lantern watch', enemies: ['archon', 'lantern', 'vital'] },
    { title: 'Thunder over the temple', enemies: ['thunderbird', 'lantern', 'halo'] },
    { title: 'The healers\' guard', enemies: ['lifeline', 'archon', 'geode'] },
    { title: 'Haunted chorus', enemies: ['choir', 'wraithhound', 'emberkoi'] },
    { title: 'Starwyrm', enemies: ['starwyrm', 'choir', 'geode'], boss: true, pack: 'magic' },
    { title: 'The quiet library', enemies: ['sanctum', 'wisp', 'tome'] },
    { title: 'Burning glyphs', enemies: ['sanctum', 'glyph', 'lantern'] },
    { title: 'Borrowed time', enemies: ['chronos', 'mender', 'mistwyrm'] },
    { title: 'Paper tigers', enemies: ['solmane', 'origami', 'tempest'] },
    { title: 'Lost pages', enemies: ['chronos', 'tome', 'glyph'] },
    { title: 'Wisps in the wind', enemies: ['thunderbird', 'wisp', 'rune'] },
    { title: 'Spring eternal', enemies: ['chronos', 'bloom', 'halo'] },
    { title: 'Second wind', enemies: ['lifeline', 'emberkoi', 'vital'] },
    { title: 'Alchemy lab', enemies: ['archon', 'flask', 'plume'] },
    { title: 'Petalcore', enemies: ['petalcore', 'glyph', 'wisp'], boss: true, pack: 'magic' },
    { title: 'Cursed edge', enemies: ['hexblade', 'glyph', 'mender'] },
    { title: 'Storm hounds', enemies: ['chronos', 'tempest', 'wraithhound'] },
    { title: 'Moonlit study', enemies: ['archon', 'moonhare', 'tome'] },
    { title: 'Rune lightning', enemies: ['thunderbird', 'glyph', 'rune'] },
    { title: 'Sun and moon', enemies: ['solmane', 'nocturne', 'mender'] },
    { title: 'Wild garden', enemies: ['aurora', 'bloom', 'flask'] },
    { title: 'Hex marks the spot', enemies: ['hexblade', 'flask', 'hexcoil'] },
    { title: 'Seeing double', enemies: ['lifeline', 'mirage', 'vital'] },
    { title: 'Edge of the rift', enemies: ['solmane', 'flask', 'wisp'] },
    { title: 'Voidweaver', enemies: ['voidweaver', 'thunderbird', 'tide'], boss: true, pack: 'magic' },
  ] },
  { title: 'Convergence', levels: [
    { title: 'Worlds collide', enemies: ['colossus', 'bounty', 'mistwyrm'] },
    { title: 'Sun and steel', enemies: ['solmane', 'shredder', 'hexcoil'] },
    { title: 'Black feathers', enemies: ['thunderbird', 'specter', 'crow'] },
    { title: 'Static and storm', enemies: ['vanta', 'tempest', 'dynamo'] },
    { title: 'Hellhounds', enemies: ['hellfire', 'wraithhound', 'tome'] },
    { title: 'Dragon song', enemies: ['wyvern', 'choir', 'mistwyrm'] },
    { title: 'Drifting blades', enemies: ['shogun', 'overclock', 'drift'] },
    { title: 'Deep water', enemies: ['lifeline', 'narwhal', 'hexcoil'] },
    { title: 'Thunder sharks', enemies: ['thunderbird', 'shark', 'overclock'] },
    { title: 'Twin blades', enemies: ['nightblade', 'hexblade', 'brick'], boss: true, pack: 'cyber' },
    { title: 'Watchtower lights', enemies: ['aurora', 'hex', 'watchtower'] },
    { title: 'Live current', enemies: ['aurora', 'volt', 'wirelash'] },
    { title: 'Fireworks', enemies: ['aurora', 'mortar', 'vandal'] },
    { title: 'Time beasts', enemies: ['chronos', 'wyvern', 'silverback'] },
    { title: 'Ghost fleet', enemies: ['shogun', 'kraken', 'wraithhound'] },
    { title: 'Siege of the sanctum', enemies: ['sanctum', 'thunderhide', 'mortar'] },
    { title: 'Riot hour', enemies: ['chronos', 'wyvern', 'riot'] },
    { title: 'Monster hymn', enemies: ['choir', 'chimera', 'sanctum'] },
    { title: 'Hex waters', enemies: ['hexblade', 'hexcoil', 'shark'] },
    { title: 'The void hunt', enemies: ['voidweaver', 'sanctum', 'bounty'], boss: true, pack: 'magic' },
    { title: 'Shadow flight', enemies: ['thunderbird', 'vanta', 'flutter'] },
    { title: 'Meltdown', enemies: ['reactor', 'lifeline', 'mistwyrm'] },
    { title: 'Night stampede', enemies: ['vanta', 'boar', 'glimmerstag'] },
    { title: 'Cursed beasts', enemies: ['hexblade', 'manticore', 'wick'] },
    { title: 'Web of time', enemies: ['thunderhide', 'chronos', 'arachne'] },
    { title: 'Sabre dance', enemies: ['choir', 'solmane', 'sabre'] },
    { title: 'High noon', enemies: ['solmane', 'archon', 'sentry'] },
    { title: 'Masters', enemies: ['shogun', 'archon', 'mongoose'] },
    { title: 'The last stand', enemies: ['thunderhide', 'lifeline', 'fang'] },
    { title: 'Sovereign', enemies: ['sovereign', 'colossus', 'archon'], boss: true, pack: 'omni' },
  ] },
];
// One flat list for progress (`cleared` counts across chapters); `chapter` is 0-based, `num` is the level within its chapter.
// Boss packs: chapters 1-3 give Cyber packs; chapters 4-5 say their own on each boss level.
export const CAMPAIGN = CHAPTERS.flatMap((c, chapter) => c.levels.map((l, i) => ({ ...l, chapter, num: i + 1, ...(l.boss && !l.pack ? { pack: 'cyber' } : {}) })));
export const NEW_CARD_AFTER = [3, 6];   // levels that unlock your 2nd and 3rd card
export const OPEN_LEVELS = CAMPAIGN.filter(l => l.chapter < CHAPTERS_OPEN).length;

// A campaign battle: your team against the level's enemies, and you go first.
export const newCampaignBattle = (team, level, fus = {}) => newBattle(team, CAMPAIGN[level].enemies, () => 0, fus);
