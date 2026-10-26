// Pure game rules shared by the server: battles, packs, rewards. No I/O here so it can be tested in node.
import CARDS from '../../shared/cards.json' with { type: 'json' };

export const BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));
export const STARTER_TEAM = ['volt', 'fang', 'goliath'];
export const START_GOLD = 0;           // gold comes from the campaign
export const PACK_COST = 1000;
export const PACK_SIZE = 3;
export const WIN_GOLD = 50;            // friend battle win
export const CAMPAIGN_GOLD = [25, 50, 100, 100, 100];   // first clear of a campaign level, by chapter
export const CAMPAIGN_XP = [25, 25, 25, 50, 50];
export const CHAPTERS_OPEN = 3;   // chapters past this show "More chapters are on the way"
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
export const PACK_TYPES = { cyber: ['Fighter', 'Beast', 'Mech'], magic: ['Arcanist', 'Spirit', 'Mystic'], omni: null };
export const PACKS_OPEN = ['cyber'];   // magic and omni show "Coming soon" until they're added here
const pickOf = (rarity, type, rand) => {
  const classes = PACK_TYPES[type];
  const pool = CARDS.filter(c => c.rarity === rarity && (!classes || classes.includes(c.cls)));
  return pool[Math.floor(rand() * pool.length)].id;
};

// Returns { cards: [ids], packsSinceLegend } for one pack of `type`.
export function openPack(packsSinceLegend, type = 'cyber', rand = Math.random) {
  const rarities = Array.from({ length: PACK_SIZE }, () => rollRarity(rand));
  return {
    cards: rarities.map(r => pickOf(r, type, rand)),
    packsSinceLegend: rarities.includes('Legendary') ? 0 : packsSinceLegend + 1,
  };
}

// ---- daily spin ----
// The wheel's 8 slots clockwise from the top, as drawn in the app, with their chance out of 100.
export const SPIN_SLOTS = [
  { kind: 'gold', amount: 50, weight: 18 },
  { kind: 'xp', amount: 25, weight: 17 },
  { kind: 'gold', amount: 100, weight: 12 },
  { kind: 'pack', amount: 1, weight: 5 },
  { kind: 'gold', amount: 25, weight: 20 },
  { kind: 'xp', amount: 50, weight: 11 },
  { kind: 'gold', amount: 250, weight: 5 },
  { kind: 'xp', amount: 25, weight: 12 },
];
// The wheel resets at midnight UTC: one spin per UTC day.
const DAY_MS = 24 * 60 * 60 * 1000;
export const dayStart = t => Math.floor(t / DAY_MS) * DAY_MS;
export const nextSpinAt = (last, t) => (last && last >= dayStart(t) ? dayStart(t) + DAY_MS : 0);   // 0 = can spin now
// Free packs (wheel, campaign boss, gauntlet) are a random open type; the wheel's pack changes once a day.
export const freePack = (rand = Math.random) => PACKS_OPEN[Math.floor(rand() * PACKS_OPEN.length)];
export const dailyPack = t => {
  let h = Math.floor(t / DAY_MS) * 2654435761 >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  return PACKS_OPEN[(h ^ (h >>> 13)) % PACKS_OPEN.length];
};
export function spinWheel(rand = Math.random) {
  let r = rand() * 100;
  for (let i = 0; i < SPIN_SLOTS.length; i++) if ((r -= SPIN_SLOTS[i].weight) < 0) return i;
  return 0;
}

// ---- gauntlet ----
// Endless run: fight after fight with the same team, damage carries over, each win heals 20%. One loss ends it.
export const GAUNTLET_HEAL = 0.2;
export const GAUNTLET_PACK_EVERY = 10;
export const gauntletGold = fight => 5 + 5 * fight;   // fight 1 pays 10, fight 2 pays 15…
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
export function gauntletBattle(team, hp, enemies) {
  const s = newBattle(team, enemies, () => 0);
  s.teams[0].forEach((u, i) => { u.hp = hp[i]; });
  return s;
}
export const gauntletHeal = team => team.map(u => (u.hp === 0 ? 0 : Math.min(BY_ID[u.id].hp, u.hp + Math.round(BY_ID[u.id].hp * GAUNTLET_HEAL))));

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
  const attacker = me[from];
  if (!attacker || !alive(attacker)) throw new Error('That card is knocked out.');
  if (state.acted[p][from]) throw new Error('That card already acted this round.');
  if (move !== 'basic' && move !== 'special') throw new Error('Unknown move.');
  const card = BY_ID[attacker.id];
  if (move === 'special' && attacker.cd > 0) throw new Error(`${card.special.name} is cooling down.`);
  const heal = heals(card, move);
  const target = heal ? me[to] : foe[to];
  if (!target || !alive(target)) throw new Error(heal ? 'Pick one of your cards that is still standing.' : 'Pick a target that is still standing.');

  let dmg = 0, healed = 0, adv = false;
  if (heal) {
    healed = Math.min(card.special.dmg, BY_ID[target.id].hp - target.hp);   // never above full HP
    target.hp += healed;
  } else {
    const base = move === 'basic' ? card.basic.dmg : card.special.dmg;
    adv = beats(card.cls, BY_ID[target.id].cls);
    dmg = Math.round(base * (adv ? 1.2 : 1));
    target.hp = Math.max(0, target.hp - dmg);
  }

  // Cooldown counts the card's own later actions.
  attacker.cd = move === 'special' ? card.special.cd : Math.max(0, attacker.cd - 1);

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
  const base = move === 'basic' ? card.basic.dmg : card.special.dmg;
  return Math.round(base * (beats(card.cls, BY_ID[t.id].cls) ? 1.2 : 1));
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
  // Heal instead when a teammate is under half HP and the heal would be mostly used, unless a knockout is on offer.
  if (!best || best.score < 5000) {
    state.teams[p].forEach((a, from) => {
      const card = BY_ID[a.id];
      if (!alive(a) || state.acted[p][from] || a.cd > 0 || !card.special.heal) return;
      state.teams[p].forEach((t, to) => {
        const max = BY_ID[t.id].hp, missing = max - t.hp;
        if (!alive(t) || t.hp * 2 >= max || missing < card.special.dmg * 0.8) return;
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
export const CAMPAIGN = CHAPTERS.flatMap((c, chapter) => c.levels.map((l, i) => ({ ...l, chapter, num: i + 1 })));
export const NEW_CARD_AFTER = [3, 6];   // levels that unlock your 2nd and 3rd card
export const OPEN_LEVELS = CAMPAIGN.filter(l => l.chapter < CHAPTERS_OPEN).length;

// A campaign battle: your team against the level's enemies, and you go first.
export const newCampaignBattle = (team, level) => newBattle(team, CAMPAIGN[level].enemies, () => 0);
