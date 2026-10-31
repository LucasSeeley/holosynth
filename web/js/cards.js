// Card data and the same sums the app and server use: fusion boosts, holo copies, powers, passives, colours.
export let CARDS = [];          // every card, in Synth # order
export let BY_ID = {};
let artVersion = {};            // card id -> hash from art/manifest.json (cache-busts changed art)

export async function loadCards() {
  const [cards, manifest] = await Promise.all([
    fetch('/cards.json').then(r => r.json()),
    fetch('/art/manifest.json').then(r => r.ok ? r.json() : {}).catch(() => ({})),
  ]);
  CARDS = cards.slice().sort((a, b) => a.num - b.num);
  BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));
  artVersion = manifest || {};
}
export const card = id => BY_ID[id];

// pictures
export const art = id => `/art/${id}.webp${artVersion[id] ? '?v=' + artVersion[id] : ''}`;
export const classIcon = cls => `/img/class_${cls.toLowerCase()}.png`;
export const packImg = type => type === 'cyber' ? '/img/pack.webp' : `/img/pack_${type}.webp`;

// colours (Theme in the app)
export const CLASS_COLOR = { Fighter: '#3FF0FF', Beast: '#FF3FA4', Mech: '#FF8A3D', Arcanist: '#9B6BFF', Spirit: '#2FE3C4', Mystic: '#FFC53D', Synth: '#A8B8FF' };
export const RARITY_COLOR = { Common: '#9A97AD', Rare: '#4AA8FF', Epic: '#B46BFF', Legendary: '#FFC53D' };
export const classColor = cls => CLASS_COLOR[cls] || '#FF8A3D';
export const rarityColor = r => RARITY_COLOR[r] || '#9A97AD';
const RARITIES = ['Common', 'Rare', 'Epic', 'Legendary'];

// Power cards (same table as the server's POWERS). target: ally | ko | acted | none
export const POWERS = [
  { id: 'repair', name: 'Repair Kit', rarity: 'Common', target: 'ally', effect: 'Heal one of your cards 15 HP', short: '+15 HP', icon: 'wrench' },
  { id: 'overclock', name: 'Overclock', rarity: 'Common', target: 'ally', effect: "One card's next attack +25%", short: 'Next attack +25%', icon: 'bolt' },
  { id: 'shield', name: 'Deflector', rarity: 'Common', target: 'ally', effect: 'The next hit on one card does half damage', short: 'Halves a hit', icon: 'shield' },
  { id: 'recharge', name: 'Recharge', rarity: 'Rare', target: 'ally', effect: "One card's specials are ready right now", short: 'Special ready', icon: 'recharge' },
  { id: 'emp', name: 'EMP', rarity: 'Rare', target: 'none', effect: 'Every enemy special +1 turn of cooldown', short: 'Enemy specials +1', icon: 'emp' },
  { id: 'nanoswarm', name: 'Nanoswarm', rarity: 'Rare', target: 'none', effect: '10 damage to every enemy', short: '10 to all enemies', icon: 'swarm' },
  { id: 'revive', name: 'Revive Chip', rarity: 'Epic', target: 'ko', effect: 'Bring back a knocked-out card at 15% HP', short: 'Back at 15% HP', icon: 'heart' },
  { id: 'timeskip', name: 'Time Skip', rarity: 'Epic', target: 'acted', effect: 'One card can act again this round', short: 'Act again', icon: 'clock' },
  { id: 'mirror', name: 'Ricochet', rarity: 'Epic', target: 'ally', effect: 'Half of the next hit on one card bounces back at the attacker', short: 'Bounces half a hit', icon: 'swap' },
  { id: 'overdrive', name: 'Rally', rarity: 'Legendary', target: 'none', effect: "Every card's next attack +15%", short: 'Team +15%', icon: 'flame' },
  { id: 'restore', name: 'Restore', rarity: 'Legendary', target: 'ally', effect: 'Heal one card half its max HP', short: '+50% HP', icon: 'cross' },
  { id: 'singularity', name: 'Static Field', rarity: 'Legendary', target: 'none', effect: 'Every enemy loses 10% of its max HP', short: '−10% to all', icon: 'rings' },
];
export const power = id => POWERS.find(p => p.id === id || 'pw:' + p.id === id);
export const POWER_VIOLET = '#B46BFF';

// Passives (same table as the server's PASSIVES): values by rarity.
export const PASSIVES = {
  momentum: ['Momentum', 'Each basic hit adds +{}% to its next basic (stacks 3 times)', [5, 7, 9, 12]],
  firststrike: ['First Strike', 'Its first attack of the battle deals +{}% damage', [25, 35, 45, 60]],
  lifesteal: ['Lifesteal', 'Heals {}% of the damage it deals', [15, 20, 25, 30]],
  executioner: ['Executioner', '+{}% damage to targets under 30% HP', [20, 30, 40, 50]],
  armor: ['Armor', 'Takes {}% less damage', [8, 10, 12, 15]],
  thorns: ['Thorns', 'Reflects {}% of damage taken back at the attacker', [10, 15, 20, 25]],
  quickcharge: ['Quick Charge', 'Special cooldown 1 turn shorter', [1, 1, 1, 1]],
  laststand: ['Last Stand', '+{}% damage while under 30% HP', [20, 30, 40, 50]],
  phaseshift: ['Phase Shift', 'The first hit it takes deals {}% less', [40, 50, 60, 75]],
  rebirth: ['Rebirth', 'Once per battle, survives a knockout with {}% HP', [10, 15, 20, 25]],
  regen: ['Regen', 'Heals {}% of its max HP each time it acts', [4, 5, 6, 8]],
  blessing: ['Blessing', 'Its heals are {}% stronger', [15, 20, 25, 30]],
};
// { name, text, short } for a card's passive, or null
export function passiveOf(c) {
  const p = c && PASSIVES[c.passive];
  if (!p) return null;
  const v = p[2][Math.max(0, RARITIES.indexOf(c.rarity))];
  return { name: p[0], text: p[1].replace('{}', v), short: c.passive === 'quickcharge' ? '−1' : v + '%', value: v };
}

// Fusion: { h, b, s, x, o, p } levels; holo (o) is +20% to every stat.
export const fusionTotal = f => f ? (f.h || 0) + (f.b || 0) + (f.s || 0) + (f.x ? 1 : 0) + (f.p ? 1 : 0) : 0;
const boost = (base, per, levels, f) => Math.round(base * (1 + per * levels) * (f?.o ? 1.2 : 1));
export const maxHP = (c, f) => boost(c.hp, 0.1, f?.h || 0, f);
export function dmg(c, move, f) {
  if (move === 'basic') return boost(c.basic.dmg, 0.2, f?.b || 0, f);
  if (move === 'special2') return boost(c.special2?.dmg || 0, 0.1, f?.s || 0, f);
  return boost(c.special.dmg, 0.1, f?.s || 0, f);
}

// Profile helpers (Profile extension in the app)
const copyFusion = c => ({ h: c.h, b: c.b, s: c.s, x: c.x, o: c.o, p: c.p });
function best(p, id, holo) {
  let top = null;
  for (const c of p?.fused || []) if (c.card === id && !!c.o === holo && (!top || fusionTotal(c) > fusionTotal(top))) top = c;
  return top && copyFusion(top);
}
export const fusionOf = (p, id) => best(p, id, false);
export const holoOf = (p, id) => best(p, id, true);
export function battleUsesHolo(p, id) {
  const score = f => f ? f.h + f.b + f.s + (f.x ? 3 : 0) + (f.o ? 4 : 0) : -1;
  const h = holoOf(p, id);
  return !!h && score(h) >= score(fusionOf(p, id));
}
export const battleFusion = (p, id) => battleUsesHolo(p, id) ? holoOf(p, id) : fusionOf(p, id);
export const holoCount = (p, id) => (p?.fused || []).filter(c => c.card === id && c.o).length;
export const xpInto = p => p.levelXp ?? p.xp % 100;
export const xpNeed = p => Math.max(p.levelNeed ?? 100, 1);

// Collection order: Synth #, HP, Rarity, Dups, Holo (cards must already be in number order so ties keep it)
export const SORTS = ['Synth #', 'HP', 'Rarity', 'Dups', 'Holo'];
const RANK = { Legendary: 0, Epic: 1, Rare: 2, Common: 3 };
// hp: a card's HP for the HP sort (your best copy, fused or holo); defaults to the printed HP.
export function sortCards(cards, mode, counts = {}, holos = new Set(), hp = c => c.hp) {
  const idx = new Map(cards.map((c, i) => [c.id, i]));
  const by = key => cards.slice().sort((a, b) => key(a) - key(b) || idx.get(a.id) - idx.get(b.id));
  switch (mode % SORTS.length) {
    case 1: return by(c => -hp(c));
    case 2: return by(c => RANK[c.rarity] ?? 9);
    case 3: return by(c => -(counts[c.id] || 0));
    case 4: return by(c => holos.has(c.id) ? 0 : 1);
    default: return cards;
  }
}

// Trade items are card ids, or "card#12" for fused copy 12.
export const tradeCard = tok => card(String(tok).split('#')[0]);
export const tradeFusedId = tok => String(tok).includes('#') ? String(tok).split('#')[1] : null;
export const tradeToken = copy => `${copy.card}#${copy.id}`;
