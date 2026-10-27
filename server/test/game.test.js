import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newBattle, newCampaignBattle, applyMove, aiMove, openPack, BY_ID, CAMPAIGN, STARTER_TEAM, CHAPTERS, CAMPAIGN_GOLD, SPIN_SLOTS, spinWheel, nextSpinAt, gauntletEnemies, gauntletBattle, gauntletHeal, BEATS, PACK_TYPES, PACKS_OPEN, freePack, dailyPack, CAMPAIGN_XP, CHAPTERS_OPEN, OPEN_LEVELS, levelFor, levelStart, fusedHp, fusedDmg, SECOND, FUSE_GOLD, dailyShop, huntFoes, HUNT_MS, huntBattle, huntPack, HUNT_FUSION, pickQuests, QUESTS, QUEST_PAY } from '../src/game.js';

const fixed = v => () => v;

test('class advantage adds 20%', () => {
  const s = newBattle(['volt', 'fang', 'goliath'], ['fang', 'goliath', 'volt'], fixed(0));  // player 0 starts
  applyMove(s, 0, 0, 'basic', 0);                     // Fighter Volt (10) -> Beast Fang: 12
  assert.equal(s.teams[1][0].hp, BY_ID.fang.hp - 12);
  applyMove(s, 1, 0, 'basic', 0);                     // Beast Fang (15) -> Fighter Volt: no bonus
  assert.equal(s.teams[0][0].hp, BY_ID.volt.hp - 15);
});

test('turns alternate and a card cannot act twice in a round', () => {
  const s = newBattle(['volt', 'fang', 'goliath'], ['volt', 'fang', 'goliath'], fixed(0));
  assert.throws(() => applyMove(s, 1, 0, 'basic', 0), /not your turn/);
  applyMove(s, 0, 0, 'basic', 0);
  applyMove(s, 1, 0, 'basic', 0);
  assert.throws(() => applyMove(s, 0, 0, 'basic', 0), /already acted/);
  applyMove(s, 0, 1, 'basic', 0);
  applyMove(s, 1, 1, 'basic', 0);
  applyMove(s, 0, 2, 'basic', 0);                     // all three acted -> round resets
  assert.deepEqual(s.acted[0], [false, false, false]);
});

test('special goes on cooldown counted in that card\'s own actions', () => {
  const s = newBattle(['volt', 'fang', 'goliath'], ['goliath', 'goliath', 'goliath'], fixed(0));
  applyMove(s, 0, 0, 'special', 0);                   // Overcharge, cd 2
  assert.equal(s.teams[0][0].cd, 2);
  for (const i of [1, 2]) { applyMove(s, 1, i - 1, 'basic', 0); applyMove(s, 0, i, 'basic', 0); }
  applyMove(s, 1, 2, 'basic', 0);
  assert.throws(() => applyMove(s, 0, 0, 'special', 1), /cooling down/);
});

test('knocking out the whole team wins', () => {
  const s = newBattle(['goliath', 'goliath', 'goliath'], ['volt', 'volt', 'volt'], fixed(0));
  for (const t of s.teams[1]) t.hp = 1;
  applyMove(s, 0, 0, 'basic', 0); applyMove(s, 1, 1, 'basic', 0);
  applyMove(s, 0, 1, 'basic', 1); applyMove(s, 1, 2, 'basic', 0);
  applyMove(s, 0, 2, 'basic', 2);
  assert.equal(s.winner, 0);
  assert.throws(() => applyMove(s, 1, 2, 'basic', 0), /over/);
});

test('no pity: a pack never forces a Legendary', () => {
  const p = openPack(1000, 'cyber', fixed(0));                 // rand 0 -> all Common, however long since the last Legendary
  assert.ok(p.cards.every(id => BY_ID[id].rarity === 'Common'));
});

test('drop rates roughly match 85/10/4/1', () => {
  const n = { Common: 0, Rare: 0, Epic: 0, Legendary: 0 };
  for (let i = 0; i < 20000; i++) for (const id of openPack(0).cards) n[BY_ID[id].rarity]++;
  const pct = r => (100 * n[r]) / 60000;
  assert.ok(Math.abs(pct('Common') - 85) < 1.5 && Math.abs(pct('Legendary') - 1) < 0.5, JSON.stringify(n));
});

test('teams smaller than 3 play out', () => {
  const s = newBattle(['volt'], ['crow', 'moth'], () => 0);
  assert.deepEqual(s.acted, [[false], [false, false]]);
  applyMove(s, 0, 0, 'basic', 0);
  assert.deepEqual(s.acted[0], [false], 'a lone card is ready again right away');
});

test('computer takes the knockout over a bigger hit', () => {
  const s = newBattle(['volt', 'goliath'], ['fang'], () => 0.9);   // computer (side 1) moves first
  s.teams[0][0].hp = 10;   // Volt is one hit from KO; Fang would do more damage to Goliath (Beast beats Mech)
  assert.deepEqual(aiMove(s, 1), { from: 0, move: 'basic', to: 0 });
});

test('every starter path can win every campaign level but the final boss, going first', () => {
  const paths = [];
  for (const a of STARTER_TEAM) for (const b of STARTER_TEAM) if (a !== b) paths.push([a, b]);
  CAMPAIGN.slice(0, 89).forEach((_, level) => paths.forEach(path => {   // chapters 1-3, except chapter 3's last boss
    const team = level < 3 ? [path[0]] : level < 6 ? path : STARTER_TEAM;
    const s = newCampaignBattle(team, level);
    assert.equal(s.turn, 0);
    while (s.winner === null) { const m = aiMove(s, s.turn); applyMove(s, s.turn, m.from, m.move, m.to); }
    assert.equal(s.winner, 0, `level ${level + 1} with ${team.join('+')}`);
  }));
});

test('the final boss beats the starter team but a strong team can win it', () => {
  const run = team => { const s = newCampaignBattle(team, 89);
    while (s.winner === null) { const m = aiMove(s, s.turn); applyMove(s, s.turn, m.from, m.move, m.to); } return s.winner; };
  assert.equal(CAMPAIGN[89].enemies.length, 3);
  assert.equal(run(STARTER_TEAM), 1);
  assert.equal(run(['phoenix', 'dreadnought', 'nightblade']), 0);
});

test('packs only hold cards of their type, and only open types are free', () => {
  for (const [type, classes] of Object.entries(PACK_TYPES)) {
    for (let i = 0; i < 500; i++) for (const id of openPack(0, type).cards) if (classes) assert.ok(classes.includes(BY_ID[id].cls), `${id} in ${type}`);
  }
  assert.ok(PACKS_OPEN.includes(freePack()));
  assert.equal(openPack(0, 'overload').cards.length, 8);
  for (let d = 0; d < 30; d++) assert.ok(PACKS_OPEN.includes(dailyPack(d * 86400000)));
  const magic = new Set(Object.values(BY_ID).filter(c => PACK_TYPES.magic.includes(c.cls)).map(c => c.id));
  assert.ok(CAMPAIGN.slice(0, 90).every(l => l.enemies.every(id => !magic.has(id))), 'no magic cards in chapters 1-3');
  assert.ok(CHAPTERS[3].levels.every(l => l.enemies.every(id => magic.has(id))), 'chapter 4 is all magic');
  assert.ok(CHAPTERS[4].levels.every(l => l.enemies.some(id => magic.has(id)) && l.enemies.some(id => !magic.has(id))), 'chapter 5 mixes');
});

test('five chapters of 30 with a boss every 10th level, all real cards', () => {
  assert.deepEqual([0, 30, 60, 90, 120].map(l => [CAMPAIGN_GOLD[CAMPAIGN[l].chapter], CAMPAIGN_XP[CAMPAIGN[l].chapter]]), [[50, 50], [100, 100], [150, 150], [200, 200], [250, 250]]);
  assert.deepEqual(CHAPTERS.map(c => c.levels.length), [30, 30, 30, 30, 30]);
  assert.equal(OPEN_LEVELS, CHAPTERS_OPEN * 30);
  assert.deepEqual(CAMPAIGN.filter(l => l.boss).map(l => l.pack), [...Array(9).fill('cyber'), 'magic', 'magic', 'magic', 'cyber', 'magic', 'omni']);
  CAMPAIGN.forEach((l, i) => {
    assert.equal(!!l.boss, (i + 1) % 10 === 0, `level ${i + 1}`);
    for (const id of l.enemies) assert.ok(BY_ID[id], id);
  });
});

test('chapters 4 and 5 get harder but a strong team can win every level', () => {
  const run = (team, level) => { const s = newCampaignBattle(team, level);
    while (s.winner === null) { const m = aiMove(s, s.turn); applyMove(s, s.turn, m.from, m.move, m.to); } return s.winner; };
  for (let level = 90; level < 150; level++) assert.equal(run(['paragon', 'phoenix', 'eternity'], level), 0, `level ${level + 1}`);
});

test('each level needs double the XP of the last', () => {
  assert.deepEqual([0, 99, 100, 299, 300, 699, 700, 1500].map(levelFor), [1, 1, 2, 2, 3, 3, 4, 5]);
  assert.deepEqual([1, 2, 3, 4].map(levelStart), [0, 100, 300, 700]);
});

test('fusion boosts stats and unlocks a stronger second special', () => {
  assert.equal(Object.keys(SECOND).length, 45);
  assert.deepEqual(FUSE_GOLD, [1000, 2500, 5000]);
  for (const [id, m] of Object.entries(SECOND)) {
    assert.ok(['Epic', 'Legendary'].includes(BY_ID[id].rarity), id);
    assert.ok(m.dmg > BY_ID[id].special.dmg, `${id}: second special hits harder`);
  }
  const f = { h: 1, b: 2, s: 3, x: true };
  assert.equal(fusedHp('apex', f), 127);                 // 115 * 1.1
  assert.equal(fusedDmg('apex', f, 'basic'), 35);        // 25 * 1.4
  assert.equal(fusedDmg('apex', f, 'special'), 65);      // 50 * 1.3
  assert.equal(fusedDmg('apex', f, 'special2'), 91);     // 70 * 1.3
  const s = newBattle(['apex'], ['volt'], () => 0, { apex: f });
  assert.equal(s.teams[0][0].hp, 127);
  applyMove(s, 0, 0, 'special2', 0);
  assert.equal(s.teams[1][0].hp, 0);                     // 91 into Volt's 60
  assert.equal(s.teams[0][0].cd2, 4);
  const plain = newBattle(['apex'], ['volt'], () => 0);
  assert.throws(() => applyMove(plain, 0, 0, 'special2', 0), /Unknown move/);
});

test('daily spin odds add up and the pack is rare', () => {
  assert.equal(SPIN_SLOTS.reduce((a, s) => a + s.weight, 0), 100);
  const n = Array(9).fill(0);
  for (let i = 0; i < 20000; i++) n[spinWheel()]++;
  assert.ok(Math.abs(n[3] / 200 - 6) < 1, `pack ${n[3] / 200}%`);
  assert.equal(spinWheel(() => 0.999), 8);
  assert.deepEqual(SPIN_SLOTS.filter(s => s.kind === 'gold').map(s => s.amount).sort((a, b) => a - b), [100, 100, 250, 500]);
  assert.deepEqual(SPIN_SLOTS.filter(s => s.kind === 'xp').map(s => s.amount).sort((a, b) => a - b), [100, 100, 250, 500]);
});

test('the wheel resets at midnight UTC', () => {
  const t = Date.UTC(2026, 9, 26, 23, 30);
  assert.equal(nextSpinAt(null, t), 0);
  assert.equal(nextSpinAt(Date.UTC(2026, 9, 25, 23, 59), t), 0, 'spun yesterday');
  assert.equal(nextSpinAt(Date.UTC(2026, 9, 26, 0, 1), t), Date.UTC(2026, 9, 27), 'spun today: next midnight');
});

test('gauntlet: enemies grow with the streak, damage carries over, wins heal 20%', () => {
  assert.equal(gauntletEnemies(1).length, 1);
  assert.equal(gauntletEnemies(15).length, 2);
  assert.equal(gauntletEnemies(25).length, 3);
  assert.ok(gauntletEnemies(5).every(id => BY_ID[id].rarity === 'Common'));
  const s = gauntletBattle(['volt', 'fang', 'goliath'], [30, 0, 70], ['crow']);
  assert.deepEqual(s.teams[0].map(u => u.hp), [30, 0, 70]);
  assert.equal(s.turn, 0);
  assert.throws(() => applyMove(s, 0, 1, 'basic', 0), /knocked out/);
  assert.deepEqual(gauntletHeal(s.teams[0]), [42, 0, 70]);   // +20% of 60, KO stays out, capped at full
});

test('six classes: each beats 2, is weak to 2, even with 1', () => {
  const classes = Object.keys(BEATS);
  assert.equal(classes.length, 6);
  for (const c of classes) {
    const weak = classes.filter(o => BEATS[o].includes(c));
    assert.equal(BEATS[c].length, 2, c);
    assert.equal(weak.length, 2, c);
    assert.ok(BEATS[c].every(o => !weak.includes(o)), c);
  }
  const s = newBattle(['rune'], ['volt'], () => 0);   // Arcanist vs Fighter: Fighter has the edge, not Rune
  applyMove(s, 0, 0, 'basic', 0);
  assert.equal(s.teams[1][0].hp, BY_ID.volt.hp - 15);
  const t = newBattle(['volt'], ['rune'], () => 0);    // Fighter beats Arcanist: 10 -> 12
  applyMove(t, 0, 0, 'basic', 0);
  assert.equal(t.teams[1][0].hp, BY_ID.rune.hp - 12);
});

test('a Mystic heals a teammate, never above full, never a knocked-out card', () => {
  const s = newBattle(['halo', 'volt', 'fang'], ['crow'], () => 0);
  s.teams[0][1].hp = 20; s.teams[0][2].hp = 0;
  applyMove(s, 0, 0, 'special', 1);                    // Mend 25
  assert.equal(s.teams[0][1].hp, 45);
  assert.equal(s.teams[1][0].hp, BY_ID.crow.hp, 'the enemy is untouched');
  assert.equal(s.log.at(-1).heal, 25);
  assert.equal(s.teams[0][0].cd, BY_ID.halo.special.cd);
  const t = newBattle(['halo', 'volt', 'fang'], ['crow'], () => 0);
  t.teams[0][1].hp = 55;
  applyMove(t, 0, 0, 'special', 1);
  assert.equal(t.teams[0][1].hp, BY_ID.volt.hp, 'capped at full');
  const u = newBattle(['halo', 'volt', 'fang'], ['crow'], () => 0);
  u.teams[0][2].hp = 0;
  assert.throws(() => applyMove(u, 0, 0, 'special', 2), /still standing/);
});

test('computer heals a teammate in trouble, but takes a knockout first', () => {
  const s = newBattle(['volt'], ['halo', 'goliath'], () => 0.9);   // computer is side 1 and moves first
  s.teams[1][1].hp = 20;
  assert.deepEqual(aiMove(s, 1), { from: 0, move: 'special', to: 1 });
  s.teams[0][0].hp = 5;                                            // Volt is one hit from KO
  assert.equal(aiMove(s, 1).move === 'special' && aiMove(s, 1).to === 1, false);
});

test('every magic card is complete', () => {
  const magic = Object.values(BY_ID).filter(c => ['Arcanist', 'Spirit', 'Mystic'].includes(c.cls));
  assert.equal(magic.length, 72);
  for (const c of magic) {
    assert.ok(c.hp > 0 && c.basic.dmg > 0 && c.special.dmg > 0 && c.special.cd >= 1 && c.quip && c.color, c.id);
    assert.equal(!!c.special.heal, c.cls === 'Mystic', c.id);
  }
});

test('daily shop: one Rare then three different Commons, the same all day, new the next day', () => {
  const day = 20000 * 86400000, a = dailyShop(day);
  assert.equal(BY_ID[a[0]].rarity, 'Rare');
  assert.ok(a.slice(1).every(id => BY_ID[id].rarity === 'Common'));
  assert.equal(new Set(a).size, 4);
  assert.deepEqual(dailyShop(day + 86399999), a);
  const week = Array.from({ length: 7 }, (_, d) => dailyShop(day + d * 86400000).join());
  assert.ok(new Set(week).size > 1);
});

test('legend hunt: every 8 hours a fully fused Legendary and a lightly fused support; the pack holds the Legendary 1 in 5, else an Epic', () => {
  const t = 20000 * 86400000, f = huntFoes(t);
  assert.equal(BY_ID[f.legend].rarity, 'Legendary');
  assert.deepEqual(huntFoes(t + HUNT_MS - 1), f);
  assert.notDeepEqual(Array.from({ length: 6 }, (_, i) => huntFoes(t + i * HUNT_MS).legend + huntFoes(t + i * HUNT_MS).support).length, 1);
  for (let i = 0; i < 300; i++) {
    const g = huntFoes(t + i * HUNT_MS), c = BY_ID[g.support], lv = [g.supportFusion.h, g.supportFusion.b, g.supportFusion.s];
    assert.ok(['Rare', 'Epic'].includes(c.rarity));
    if (BY_ID[g.legend].cls !== 'Mystic') assert.equal(c.cls, 'Mystic');
    assert.ok(lv.every(n => (c.rarity === 'Rare' ? n >= 1 && n <= 2 : n <= 1)) && !g.supportFusion.x);
  }
  assert.ok(new Set(Array.from({ length: 60 }, (_, i) => huntFoes(t + i * HUNT_MS).legend)).size > 3);
  const s = huntBattle(['volt', 'fang', 'goliath'], f);
  assert.equal(s.turn, 0);
  assert.equal(s.teams[1].length, 2);
  assert.deepEqual(s.teams[1][0].f, HUNT_FUSION);
  assert.equal(s.teams[1][0].max, Math.round(BY_ID[f.legend].hp * 1.3));
  let hits = 0;
  for (let i = 0; i < 4000; i++) {
    const p = huntPack(5, f.legend);
    assert.equal(p.cards.length, 8);
    if (p.cards.includes(f.legend)) hits++;
    else assert.ok(p.cards.some(id => BY_ID[id].rarity === 'Epic'), 'no legend means a guaranteed Epic');
  }
  assert.ok(hits / 4000 > 0.17 && hits / 4000 < 0.26, `legend in ${hits / 40}% of packs`);
});

test('daily quests: one per tier, the same all day, a missing hard one becomes another medium one', () => {
  const day = 20000 * 86400000, all = Object.keys(QUESTS);
  const q = pickQuests(7, day, all);
  assert.deepEqual(q.map(id => QUESTS[id].tier), [0, 1, 2]);
  assert.deepEqual(pickQuests(7, day + 3600000, all), q);
  assert.ok(new Set(Array.from({ length: 20 }, (_, u) => pickQuests(u, day, all).join())).size > 3);
  const early = pickQuests(7, day, ['spin', 'pack', 'shop', 'wins', 'levels']);
  assert.equal(early.length, 3);
  assert.deepEqual(early.slice(1).sort(), ['levels', 'wins']);
  assert.deepEqual(QUEST_PAY.map(p => [p.gold, p.xp]), [[750, 500], [1000, 750], [1500, 1000]]);
  assert.equal(QUESTS.streak.goal, 15);
});

test('the Legends Pack: 5 cards, the last always a Legendary', () => {
  for (let i = 0; i < 200; i++) {
    const p = openPack(7, 'legends');
    assert.equal(p.cards.length, 5);
    assert.equal(BY_ID[p.cards[4]].rarity, 'Legendary');
    assert.equal(p.packsSinceLegend, 0);
  }
  for (let i = 0; i < 50; i++) assert.notEqual(freePack(), 'legends');
});
