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
function rollRarity(rand, rates = RATES) {
  let r = rand() * 100;
  for (const [name, pct] of rates) { if ((r -= pct) < 0) return name; }
  return 'Common';
}
// Pack types and the classes each holds (omni = every card).
export const PACK_TYPES = { cyber: ['Fighter', 'Beast', 'Mech'], magic: ['Arcanist', 'Spirit', 'Mystic'], omni: null, overload: null, legends: null, power: null };
// The Overload Pack is a big Omni: 8 cards for 12,000, the last always Rare or better (OVERLOAD_BEST). The Legends Pack: a guaranteed Legendary plus 4 cards at the
// normal odds, 25,000. Everything else is 3 cards for PACK_COST.
export const PACK_SIZES = { overload: 8, legends: 5, power: 3 };
export const PACK_COSTS = { overload: 12000, legends: 25000, power: 3000 };
export const OVERLOAD_BEST = [['Rare', 50], ['Epic', 48], ['Legendary', 2]];
const FREE_TYPES = ['cyber', 'magic', 'omni'];   // free packs are never Overload
export const PACKS_OPEN = ['cyber', 'magic', 'omni', 'overload', 'legends', 'power'];   // packs on sale; any left out show "Coming soon"
const pickOf = (rarity, type, rand) => {
  const classes = PACK_TYPES[type];
  const pool = CARDS.filter(c => c.rarity === rarity && (!classes || classes.includes(c.cls)));
  return pool[Math.floor(rand() * pool.length)].id;
};

// A random power card for a pack, rarer ones less often.
const powerOf = (rand, skip = []) => {
  const r = RARITY_I[rollRarity(rand, POWER_PACK.rates)], pool = POWER_POOLS[r].filter(id => !skip.includes(id));
  return pool.length ? 'pw:' + pool[Math.floor(rand() * pool.length)] : powerOf(rand, skip);
};
// What a pack card that rolled Common turns into (see COMMON_SPLIT).
function commonSlot(type, rand) {
  const u = rand() * 85;
  if (u < COMMON_SPLIT.character) return pickOf('Common', type, rand);
  if (u < COMMON_SPLIT.character + COMMON_SPLIT.favourites) return 'pw:' + FAVOURITE_POWERS[Math.floor(rand() * FAVOURITE_POWERS.length)];
  return powerOf(rand, FAVOURITE_POWERS);
}
// Returns { cards: [ids], holo: [indexes of holo cards], packsSinceLegend } for one pack of `type`.
export function openPack(packsSinceLegend, type = 'cyber', rand = Math.random) {
  const size = PACK_SIZES[type] ?? PACK_SIZE;
  // a pack's guaranteed card (Overload's Rare-or-better, Legends' Legendary) is the last one, so it's revealed last
  const last = { legends: () => 'Legendary', overload: () => rollRarity(rand, OVERLOAD_BEST) }[type];
  if (type === 'power') return { cards: Array.from({ length: POWER_PACK.size }, () => powerOf(rand)), holo: [], packsSinceLegend };   // power cards only
  const rarities = Array.from({ length: size }, (_, i) => (last && i === size - 1 ? last() : rollRarity(rand)));
  const cards = rarities.map((r, i) => (r === 'Common' && !(last && i === size - 1) ? commonSlot(type, rand) : pickOf(r, type, rand)));
  return {
    cards,
    holo: cards.map((_, i) => i).filter(i => !cards[i].startsWith('pw:') && rand() < HOLO_CHANCE),   // which of them came out holo
    packsSinceLegend: rarities.includes('Legendary') ? 0 : packsSinceLegend + 1,
  };
}

// Any card from a pack can come out holo: rainbow foil, +20% to every stat, its own copy (like a fused one).
export const HOLO_CHANCE = 1 / 250, HOLO_BOOST = 1.2;

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
export function gauntletBattle(team, hp, enemies, fus = {}, powers = [], fight = 1) {
  const s = newBattle(team, enemies, () => 0, fus);
  s.pw = [[...powers], gauntletPowers(fight)];
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
// Every 8 hours (00:00, 08:00, 16:00 UTC) one Legendary, fully fused, the same for everyone, with two support cards,
// each a Rare or an Epic, medium fused (Rare 2-3 per stat, Epic 1-2). The first is a healer unless the Legendary heals itself;
// the second can be any class. One try per hunt.
// Beat them for an Overload pack: 1 in 5 hold that Legendary (the plain card, no fusion), the rest a guaranteed Epic.
export const HUNT_MS = 8 * 60 * 60 * 1000;
export const huntStart = t => Math.floor(t / HUNT_MS) * HUNT_MS;
export const HUNT_FUSION = { h: 3, b: 3, s: 3, x: true, p: true };
export const HUNT_GOLD = 5000, HUNT_XP = 1000;   // also paid for a win, on top of the pack
const LEGENDS = CARDS.filter(c => c.rarity === 'Legendary').map(c => c.id);
export function huntFoes(t) {
  const rand = seeded(Math.floor(t / HUNT_MS) * 2654435761 + 97);
  const legend = LEGENDS[Math.floor(rand() * LEGENDS.length)];
  const pick = (healer, not) => {
    const rarity = rand() < 0.5 ? 'Rare' : 'Epic';
    const pool = CARDS.filter(c => c.rarity === rarity && (!healer || c.cls === 'Mystic') && !not.includes(c.id));
    const id = pool[Math.floor(rand() * pool.length)].id;
    const lvl = () => (rarity === 'Rare' ? 2 : 1) + Math.floor(rand() * 2);   // Rare 2-3, Epic 1-2 per stat
    return [id, { h: lvl(), b: lvl(), s: lvl(), x: false }];
  };
  const [support, supportFusion] = pick(BY_ID[legend].cls !== 'Mystic', [legend]);
  const [support2, support2Fusion] = pick(false, [legend, support]);
  return { legend, support, supportFusion, support2, support2Fusion };
}
// You move first. Tuned with the computer playing both sides (see scratch sim): hard on purpose.
export const huntBattle = (team, foes, fus = {}, powers = [], t = 0) => ({ ...newBattle(team, [foes.legend, foes.support, foes.support2], () => 0, fus,
  { [foes.legend]: HUNT_FUSION, [foes.support]: foes.supportFusion, [foes.support2]: foes.support2Fusion }), pw: [[...powers], huntPowers(t)] });
export const HUNT_LEGEND_CHANCE = 0.2;
const EPICS = CARDS.filter(c => c.rarity === 'Epic').map(c => c.id);
// The win's Overload pack: 1 in 5 has the Legendary in it; otherwise it always holds at least one Epic.
export function huntPack(packsSinceLegend, legend, rand = Math.random) {
  const pack = openPack(packsSinceLegend, 'overload', rand);
  const slot = Math.floor(rand() * pack.cards.length);
  if (rand() < HUNT_LEGEND_CHANCE) {
    pack.cards[slot] = legend;
    pack.packsSinceLegend = 0;
  } else if (!pack.cards.some(id => BY_ID[id]?.rarity === 'Epic')) {
    const plain = pack.cards.map((id, i) => i).filter(i => BY_ID[pack.cards[i]]?.rarity !== 'Legendary');
    pack.cards[plain[Math.floor(rand() * plain.length)]] = EPICS[Math.floor(rand() * EPICS.length)];
  }
  return pack;
}

// ---- ranked ----
// Eight ranks. Each week everyone is in their rank's standings of 30 (real players, topped up with computer players);
// week points: win +25, lose -20 (never below 0). At the week's end #1 ranks up 3, #2-3 up 2, #4-10 up 1, #11-20 stay,
// #21-30 drop 1. Monthly seasons: the reward is for the highest rank reached; a new season drops everyone 2 ranks.
export const RANKS = ['Rookie', 'Contender', 'Elite', 'Veteran', 'Champion', 'Conqueror', 'Holo', 'Legend'];
export const RANK_REWARDS = [[1000, null], [2500, null], [5000, 'omni'], [7500, 'omni'], [10000, 'overload'], [15000, 'overload'],
  [20000, 'overload'], [25000, 'legends']];
export const RANKED_WIN = 25, RANKED_LOSS = 20, RANKED_GOLD = 150, RANKED_XP = 100, GROUP = 30;
export const WEEK_MS = 7 * DAY_MS;
export const weekStart = t => Math.floor((t - 4 * DAY_MS) / WEEK_MS) * WEEK_MS + 4 * DAY_MS;   // Mondays 00:00 UTC
const SEASON_EPOCH = Date.UTC(2026, 10, 1);   // season 1 runs to the end of November 2026
export const seasonOf = t => {
  const d = new Date(t), months = (d.getUTCFullYear() - 2026) * 12 + d.getUTCMonth() - 10;
  return Math.max(0, months);   // 0 = season 1
};
export const seasonEnd = s => Date.UTC(2026, 11 + s, 1);
export const rankMove = place => (place === 1 ? 3 : place <= 3 ? 2 : place <= 10 ? 1 : place <= 20 ? 0 : -1);
const BOT_NAMES = ['NeonVex', 'Kiro', 'ByteWolf', 'Sable', 'ZeroDay', 'Halcyon', 'Rook', 'Mira', 'Pyx', 'Glitchjaw', 'Talon', 'Orbit',
  'Juno', 'Quill', 'Static', 'Vanta', 'Ember', 'Nyx', 'Cobalt', 'Wren', 'Drift', 'Fable', 'Onyx', 'Kestrel', 'Lumen', 'Rift', 'Sol',
  'Ash', 'Vire', 'Hexa', 'Moth', 'Pulse', 'Zinc', 'Lyra', 'Echo', 'Flux'];
// Computer players filling a rank's standings: each has a week-end score (higher ranks score more) and gets there
// steadily through the week, so the table moves while you play.
export function rankBots(week, rank, n, t) {
  const rand = seeded((week / DAY_MS) * 7919 + rank * 104729 + 13);
  const top = 180 + 60 * rank;   // roughly what the best computer player ends a week on
  const f = Math.max(0, Math.min(1, (t - week) / WEEK_MS));
  return Array.from({ length: n }, (_, i) => {
    const final = Math.round(top * rand() ** 1.6 / 5) * 5;
    const name = BOT_NAMES[Math.floor(rand() * BOT_NAMES.length)] + (rand() < 0.5 ? '' : '_' + Math.floor(rand() * 99));
    return { id: -1 - i, name, bot: true, points: Math.round(final * Math.min(1, f * (0.8 + rand() * 0.4)) / 5) * 5 };
  });
}
// The 30-player table for a rank: real players' week points plus computer players. Ties go to the real player.
// shortcut: more than 30 real players in one rank all go in one table, ranked by the same rule; split into groups past that.
export function rankTable(real, week, rank, t) {
  const rows = [...real.map(r => ({ ...r, bot: false })), ...rankBots(week, rank, Math.max(0, GROUP - real.length), t)];
  rows.sort((a, b) => b.points - a.points || (a.bot - b.bot) || a.id - b.id);
  return rows.map((r, i) => ({ ...r, place: i + 1 }));
}
export const botName = (rand = Math.random) => BOT_NAMES[Math.floor(rand() * BOT_NAMES.length)] + (rand() < 0.5 ? '' : '_' + Math.floor(rand() * 99));
// Computer players' fusions by rank: none at the bottom, fully fused (second special unlocked) at Legend, some holo near the top,
// passives from Champion up.
export function rankedFusions(rank, team, rand = Math.random) {
  const [lo, hi] = [[0, 0], [0, 0], [0, 1], [0, 1], [1, 2], [1, 2], [2, 3], [3, 3]][rank];
  const lvl = () => lo + Math.floor(rand() * (hi - lo + 1));
  const out = {};
  for (const id of team) {
    const f = { h: lvl(), b: lvl(), s: lvl(), x: rank >= 5 && !!SECOND[id], o: rand() < [0, 0, 0, 0, 0, 0.1, 0.33, 0.5][rank], p: rank >= 4 };
    if (f.h || f.b || f.s || f.x || f.o || f.p) out[id] = f;
  }
  return out;
}
// A computer team for a rank (a computer player to face): tougher cards as you climb.
export function rankedTeam(rank, rand = Math.random) {
  const tiers = [[0, 0, 0], [0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 1, 2], [1, 2, 2], [2, 2, 3], [2, 3, 3]][rank];
  return tiers.map(t => POOLS[t][Math.floor(rand() * POOLS[t].length)]);
}

// ---- fusion ----
// Fuse spare copies into one copy for +10% HP, +20% basic or +10% special (max 3 each): 1, 3, then 5 copies.
// Epic and Legendary cards can also unlock a second, stronger special (10 copies + 10,000 gold); the special bonus applies to it too.
export const FUSE_COPIES = [1, 3, 5], FUSE_MAX = 3, SECOND_COST = { copies: 10, gold: 10000 };
export const FUSE_GOLD = [1000, 2500, 5000];   // gold for a stat's 1st, 2nd and 3rd fusion
export const SECOND = Object.fromEntries(CARDS.filter(c => c.special2).map(c => [c.id, c.special2]));   // Epic & Legendary only
// Every card has a passive (cards.json "passive"), switched on by fusion for 1 copy + 2,500 gold. Values by rarity
// (Common, Rare, Epic, Legendary), in % except Quick Charge (turns off the special's cooldown).
export const PASSIVE_COST = { copies: 1, gold: 2500 };
export const PASSIVES = {
  momentum: ['Momentum', [5, 7, 9, 12]], firststrike: ['First Strike', [25, 35, 45, 60]],
  lifesteal: ['Lifesteal', [15, 20, 25, 30]], executioner: ['Executioner', [20, 30, 40, 50]],
  armor: ['Armor', [8, 10, 12, 15]], thorns: ['Thorns', [10, 15, 20, 25]],
  quickcharge: ['Quick Charge', [1, 1, 1, 1]], laststand: ['Last Stand', [20, 30, 40, 50]],
  phaseshift: ['Phase Shift', [40, 50, 60, 75]], rebirth: ['Rebirth', [10, 15, 20, 25]],
  regen: ['Regen', [4, 5, 6, 8]], blessing: ['Blessing', [15, 20, 25, 30]],
};
const RARITY_I = { Common: 0, Rare: 1, Epic: 2, Legendary: 3 };

// Power cards: one-use battle cards (used up when played). Bring up to 2; playing one is a move made by one of your cards.
// target: 'ally' = one of your standing cards, 'ko' = one of your knocked-out cards, 'acted' = one of yours that already acted,
// 'none' = no target. In packs and inventories they're "pw:<id>".
export const POWERS = {
  // kept weak on purpose: a nudge, not a win button
  repair: { name: 'Repair Kit', rarity: 'Common', target: 'ally' },        // heal 15 HP
  overclock: { name: 'Overclock', rarity: 'Common', target: 'ally' },      // its next attack +25%
  shield: { name: 'Deflector', rarity: 'Common', target: 'ally' },            // the next hit on it does half damage
  recharge: { name: 'Recharge', rarity: 'Rare', target: 'ally' },          // its specials are ready now
  emp: { name: 'EMP', rarity: 'Rare', target: 'none' },                    // every enemy special +1 cooldown
  nanoswarm: { name: 'Nanoswarm', rarity: 'Rare', target: 'none' },        // 10 damage to every enemy
  revive: { name: 'Revive Chip', rarity: 'Epic', target: 'ko' },           // back at 15% HP
  timeskip: { name: 'Time Skip', rarity: 'Epic', target: 'acted' },        // it can act again this round
  mirror: { name: 'Ricochet', rarity: 'Epic', target: 'ally' },              // half of the next hit on it bounces back at the attacker
  overdrive: { name: 'Rally', rarity: 'Legendary', target: 'none' },   // every card's next attack +15%
  restore: { name: 'Restore', rarity: 'Legendary', target: 'ally' },       // heal half its max HP
  singularity: { name: 'Static Field', rarity: 'Legendary', target: 'none' }, // every enemy loses 10% of its max HP
};
export const POWER_SLOTS = 2;
export const rarityOf = id => (id.startsWith('pw:') ? POWERS[id.slice(3)].rarity : BY_ID[id].rarity);   // a pack card's rarity
export const POWER_PACK = { cost: 3000, size: 3, rates: [['Common', 70], ['Rare', 22], ['Epic', 7], ['Legendary', 1]] };
// Every pack card that rolls Common (85%) splits into: a Common character 30.5%, Deflector / Ricochet / Restore 24% (8% each),
// any other power card 30.5% (rarer ones less often). The guaranteed card of a pack never changes.
export const COMMON_SPLIT = { character: 30.5, favourites: 24, gear: 30.5 };
export const FAVOURITE_POWERS = ['shield', 'mirror', 'restore'];
const POWER_POOLS = TIERS.map(r => Object.keys(POWERS).filter(k => POWERS[k].rarity === r));
// Two power cards for a computer opponent, from rarity tiers a and b (0 = Common ... 3 = Legendary).
export const botPowers = (a, b, rand = Math.random) => [a, b].map(t => POWER_POOLS[t][Math.floor(rand() * POWER_POOLS[t].length)]);
// Campaign enemies: none in chapter 1, then stronger ones chapter by chapter (the same for every player).
export function campaignPowers(level) {
  const c = CAMPAIGN[level].chapter;
  if (c === 0) return [];
  const tiers = [[0, 0], [0, 1], [1, 1], [1, 2]][Math.min(3, c - 1)];   // meant to be a grind: power up to keep winning
  const rand = seeded(level * 40503 + 11);
  return tiers.map(t => POWER_POOLS[t][Math.floor(rand() * POWER_POOLS[t].length)]);
}
export const gauntletPowers = (fight, rand = Math.random) => { const t = Math.min(3, Math.floor(fight / 15)); return botPowers(Math.max(0, t - 1), t, rand); };
export const rankedPowers = (rank, rand = Math.random) => botPowers([0, 0, 0, 1, 1, 2, 2, 3][rank], [0, 1, 1, 1, 2, 2, 3, 3][rank], rand);
export const huntPowers = t => botPowers(2, 3, seeded(Math.floor(t / HUNT_MS) * 7919 + 3));
export const passiveOf = id => { const c = BY_ID[id]; return { kind: c.passive, name: PASSIVES[c.passive][0], v: PASSIVES[c.passive][1][RARITY_I[c.rarity]] }; };
// f = { h, b, s, x, o, p }: fusion levels for HP, basic, special, whether the second special is unlocked, holo, passive on.
// f.o = holo: +20% on top.
const holoX = f => (f?.o ? HOLO_BOOST : 1);
export const fusedHp = (id, f) => Math.round(BY_ID[id].hp * (1 + 0.1 * (f?.h || 0)) * holoX(f));
export const fusedDmg = (id, f, move) => {
  const c = BY_ID[id];
  if (move === 'basic') return Math.round(c.basic.dmg * (1 + 0.2 * (f?.b || 0)) * holoX(f));
  const base = move === 'special2' ? SECOND[id].dmg : c.special.dmg;
  return Math.round(base * (1 + 0.1 * (f?.s || 0)) * holoX(f));
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
    return { id, hp: max, cd: 0, max, f, ...(f.x && SECOND[id] ? { cd2: 0 } : {}), ...(f.p ? { ps: BY_ID[id].passive } : {}) };
  });
  return {
    teams: [side(teamA, fusA), side(teamB, fusB)],
    acted: [teamA.map(() => false), teamB.map(() => false)],
    turn: rand() < 0.5 ? 0 : 1,
    winner: null,
    log: [],
    pw: [[], []],   // power cards each side still has to play
  };
}

const alive = u => u.hp > 0;
const pv = u => PASSIVES[u.ps][1][RARITY_I[BY_ID[u.id].rarity]];   // the unit's passive value (only call when u.ps is set)
const low = u => u.hp < unitMax(u) * 0.3;

// Damage `a` would deal to `t` with `move` right now, passives and power cards included. No side effects (the AI uses it too).
// raw: ignore the target's Shield / Mirror (for working out what Mirror sends back).
function hitFor(a, t, move, raw = false) {
  if (!raw && (t.sh || t.mi)) return Math.round(hitFor(a, t, move, true) / 2);   // Shield halves the hit; Mirror sends the other half back
  const card = BY_ID[a.id];
  let pct = 100 + (a.oc ? 25 : 0) + (a.od ? 15 : 0);
  if (a.ps === 'firststrike' && !a.hit) pct += pv(a);
  if (a.ps === 'momentum' && move === 'basic') pct += pv(a) * (a.mom || 0);
  if (a.ps === 'executioner' && low(t)) pct += pv(a);
  if (a.ps === 'laststand' && low(a)) pct += pv(a);
  let dmg = Math.round(fusedDmg(a.id, a.f, move) * pct / 100 * (beats(card.cls, BY_ID[t.id].cls) ? 1.2 : 1));
  if (t.ps === 'armor') dmg = Math.round(dmg * (1 - pv(t) / 100));
  if (t.ps === 'phaseshift' && !t.ph) dmg = Math.round(dmg * (1 - pv(t) / 100));
  return dmg;
}

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
  if (typeof move === 'string' && move.startsWith('pw:')) return playPower(state, p, from, move.slice(3), to);
  if (move !== 'basic' && move !== 'special' && !(move === 'special2' && attacker.cd2 !== undefined)) throw new Error('Unknown move.');
  const card = BY_ID[attacker.id];
  if (move === 'special' && attacker.cd > 0) throw new Error(`${card.special.name} is cooling down.`);
  if (move === 'special2' && attacker.cd2 > 0) throw new Error(`${SECOND[attacker.id].name} is cooling down.`);
  const heal = heals(card, move);
  const target = heal ? me[to] : foe[to];
  if (!target || !alive(target)) throw new Error(heal ? 'Pick one of your cards that is still standing.' : 'Pick a target that is still standing.');

  let dmg = 0, healed = 0, adv = false;
  const pas = [];   // passives that kicked in: { p: side, i: card, n: name, v: amount }
  const mine = (u, side, i, v) => pas.push({ p: side, i, n: PASSIVES[u.ps][0], v });
  const heal_ = (u, amount) => { const h = Math.min(amount, unitMax(u) - u.hp); u.hp += h; return h; };   // never above full HP
  if (heal) {
    let amount = fusedDmg(attacker.id, attacker.f, 'special');
    if (attacker.ps === 'blessing') { amount = Math.round(amount * (1 + pv(attacker) / 100)); mine(attacker, p, from, 0); }
    healed = heal_(target, amount);
  } else {
    adv = beats(card.cls, BY_ID[target.id].cls);
    // checked before the hit lands, the same way hitFor does
    const boosted = { firststrike: !attacker.hit, momentum: move === 'basic' && attacker.mom > 0, executioner: low(target), laststand: low(attacker) }[attacker.ps];
    const guarded = target.ps === 'armor' || (target.ps === 'phaseshift' && !target.ph);
    dmg = hitFor(attacker, target, move);
    if (boosted) mine(attacker, p, from, 0);
    if (guarded && !target.sh && !target.mi) mine(target, 1 - p, to, 0);
    if (target.sh) { target.sh = false; pas.push({ p: 1 - p, i: to, n: 'Deflector', v: 0 }); }
    else if (target.mi) {   // Mirror: the other half of the hit goes back at the attacker
      target.mi = false;
      const back = Math.min(hitFor(attacker, target, move, true) - dmg, attacker.hp);
      attacker.hp -= back;
      pas.push({ p, i: from, n: 'Ricochet', v: -back });
    }
    attacker.oc = false; attacker.od = false;
    if (target.ps === 'phaseshift') target.ph = true;
    target.hp = Math.max(0, target.hp - dmg);
    if (target.hp === 0 && target.ps === 'rebirth' && !target.rb) {
      target.rb = true;
      target.hp = Math.max(1, Math.round(unitMax(target) * pv(target) / 100));
      mine(target, 1 - p, to, target.hp);
    }
    if (target.ps === 'thorns' && dmg > 0) {   // thorns can't knock the attacker out
      const back = Math.min(Math.round(dmg * pv(target) / 100), attacker.hp - 1);
      if (back > 0) { attacker.hp -= back; mine(target, p, from, -back); }   // shown on the attacker, who loses the HP
    }
    if (attacker.ps === 'lifesteal' && dmg > 0) { const h = heal_(attacker, Math.round(dmg * pv(attacker) / 100)); if (h) mine(attacker, p, from, h); }
    if (attacker.ps === 'momentum') attacker.mom = move === 'basic' ? Math.min(3, (attacker.mom || 0) + 1) : attacker.mom;
    attacker.hit = true;
  }
  if (attacker.ps === 'regen') { const h = heal_(attacker, Math.round(unitMax(attacker) * pv(attacker) / 100)); if (h) mine(attacker, p, from, h); }

  // Cooldown counts the card's own later actions. Quick Charge: specials come back one action sooner.
  const qc = attacker.ps === 'quickcharge' ? 1 : 0;
  attacker.cd = move === 'special' ? Math.max(1, card.special.cd - qc) : Math.max(0, attacker.cd - 1);
  if (attacker.cd2 !== undefined) attacker.cd2 = move === 'special2' ? Math.max(1, SECOND[attacker.id].cd - qc) : Math.max(0, attacker.cd2 - 1);

  state.acted[p][from] = true;
  refreshActed(state, p);
  refreshActed(state, 1 - p);
  state.moves = (state.moves || 0) + 1;   // total so far; the log is capped, so the app uses this to spot new moves
  state.log.push(heal ? { p, from, to, move, dmg: 0, heal: healed, adv: false, ko: false, ...(pas.length ? { pas } : {}) }
                      : { p, from, to, move, dmg, adv, ko: target.hp === 0, ...(pas.length ? { pas } : {}) });
  if (state.log.length > 30) state.log.shift();

  if (!foe.some(alive)) state.winner = p;
  else if (!me.some(alive)) state.winner = 1 - p;   // knocked out by a Mirror
  else state.turn = 1 - p;
  return state;
}

// Playing a power card: a move made by card `from` (it counts as that card's action). Used up once played.
function playPower(state, p, from, id, to) {
  const me = state.teams[p], foe = state.teams[1 - p], pw = POWERS[id];
  const left = state.pw?.[p] ?? [];
  if (!pw || !left.includes(id)) throw new Error("You don't have that power card in this battle.");
  const t = me[to];
  const ok = { ally: t && alive(t), ko: t && !alive(t), acted: t && alive(t) && to !== from && state.acted[p][to], none: true }[pw.target];
  if (!ok) throw new Error({ ko: 'Pick one of your knocked-out cards.', acted: 'Pick another of your cards that already acted.' }[pw.target] ?? 'Pick one of your cards that is still standing.');
  const fx = [];   // cards it touched: { p, i, hp } with their HP afterwards
  const touch = (side, i) => fx.push({ p: side, i, hp: state.teams[side][i].hp });
  const each = (team, side, f) => team.forEach((u, i) => { if (alive(u)) { f(u); touch(side, i); } });
  switch (id) {
    case 'repair': t.hp = Math.min(unitMax(t), t.hp + 15); break;
    case 'overclock': t.oc = true; break;
    case 'shield': t.sh = true; break;
    case 'recharge': t.cd = 0; if (t.cd2 !== undefined) t.cd2 = 0; break;
    case 'revive': t.hp = Math.max(1, Math.round(unitMax(t) * 0.15)); state.acted[p][to] = true; break;
    case 'timeskip': state.acted[p][to] = false; break;
    case 'mirror': t.mi = true; break;
    case 'restore': t.hp = Math.min(unitMax(t), t.hp + Math.round(unitMax(t) / 2)); break;
    case 'emp': each(foe, 1 - p, u => { u.cd += 1; if (u.cd2 !== undefined) u.cd2 += 1; }); break;
    case 'nanoswarm': each(foe, 1 - p, u => { u.hp = Math.max(0, u.hp - 10); }); break;
    case 'singularity': each(foe, 1 - p, u => { u.hp = Math.max(0, u.hp - Math.round(unitMax(u) * 0.1)); }); break;
    case 'overdrive': each(me, p, u => { u.od = true; }); break;
  }
  if (pw.target !== 'none') touch(p, to);
  left.splice(left.indexOf(id), 1);
  const caster = me[from];
  if (id !== 'recharge' || to !== from) caster.cd = Math.max(0, caster.cd - 1);   // an action, so cooldowns tick
  if (caster.cd2 !== undefined && (id !== 'recharge' || to !== from)) caster.cd2 = Math.max(0, caster.cd2 - 1);
  state.acted[p][from] = true;
  refreshActed(state, p);
  refreshActed(state, 1 - p);
  state.moves = (state.moves || 0) + 1;
  state.log.push({ p, from, to, move: 'pw:' + id, dmg: 0, adv: false, ko: false, pw: id, fx });
  if (state.log.length > 30) state.log.shift();
  if (!foe.some(alive)) state.winner = p;
  else state.turn = 1 - p;
  return state;
}

// The computer's power card, if one is worth playing now: { from, move, to, score } or null.
function powerChoice(state, p) {
  const left = [...new Set(state.pw?.[p] ?? [])];
  if (!left.length) return null;
  const me = state.teams[p], foe = state.teams[1 - p];
  const free = me.map((u, i) => i).filter(i => alive(me[i]) && !state.acted[p][i]);
  if (!free.length) return null;
  const from = free.reduce((a, b) => (fusedDmg(me[a].id, me[a].f, 'basic') <= fusedDmg(me[b].id, me[b].f, 'basic') ? a : b));   // the weakest hitter plays it
  const living = me.map((u, i) => i).filter(i => alive(me[i]));
  const hurt = living.reduce((a, b) => (a === null || me[b].hp / unitMax(me[b]) < me[a].hp / unitMax(me[a]) ? b : a), null);
  const hurtPct = hurt === null ? 1 : me[hurt].hp / unitMax(me[hurt]);
  const foesUp = foe.filter(alive);
  let best = null;
  const consider = (id, to, score) => { if (score > 0 && (!best || score > best.score)) best = { from, move: 'pw:' + id, to, score }; };
  for (const id of left) {
    if (id === 'revive') { const ko = me.findIndex(u => !alive(u)); if (ko >= 0) consider(id, ko, 9000); }
    if (id === 'restore' && hurtPct < 0.4) consider(id, hurt, 7000 + unitMax(me[hurt]) - me[hurt].hp);
    if (id === 'repair' && hurtPct < 0.5 && unitMax(me[hurt]) - me[hurt].hp >= 15) consider(id, hurt, 6500);
    if (id === 'shield' || id === 'mirror') { if (hurtPct < 0.6 && !me[hurt].sh && !me[hurt].mi) consider(id, hurt, 5300); }
    if (id === 'nanoswarm' || id === 'singularity') {
      const kos = foesUp.filter(u => u.hp <= (id === 'nanoswarm' ? 10 : Math.round(unitMax(u) * 0.1))).length;
      consider(id, from, kos ? 9500 : foesUp.length >= 2 ? 6000 : 0);
    }
    if (id === 'emp' && foesUp.filter(u => u.cd === 0).length >= 2) consider(id, from, 5500);
    if (id === 'overdrive' && living.length >= 2) consider(id, from, 5200);
    if (id === 'overclock') { const t = free.find(i => i !== from) ?? from; if (!me[t].oc) consider(id, t, 5100); }
    if (id === 'recharge') { const t = living.find(i => me[i].cd > 0); if (t !== undefined) consider(id, t, 5000); }
    if (id === 'timeskip') { const t = living.find(i => i !== from && state.acted[p][i]); if (t !== undefined) consider(id, t, 5000); }
  }
  return best;
}

// Damage a move would do right now (null if it can't be used).
function moveDamage(state, p, from, move, to) {
  const a = state.teams[p][from], t = state.teams[1 - p][to];
  if (!a || !alive(a) || state.acted[p][from] || !t || !alive(t)) return null;
  const card = BY_ID[a.id];
  if (move === 'special' && (a.cd > 0 || heals(card, move))) return null;
  if (move === 'special2' && !(a.cd2 === 0)) return null;
  return hitFor(a, t, move);
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
  const power = powerChoice(state, p);
  if (power && (!best || power.score > best.score)) best = power;
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
export const newCampaignBattle = (team, level, fus = {}, powers = []) =>
  ({ ...newBattle(team, CAMPAIGN[level].enemies, () => 0, fus), pw: [[...powers], campaignPowers(level)] });
