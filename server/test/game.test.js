import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newBattle, newCampaignBattle, applyMove, aiMove, openPack, BY_ID, PITY_PACKS, CAMPAIGN, STARTER_TEAM, CHAPTERS, SPIN_SLOTS, spinWheel, nextSpinAt, gauntletEnemies, gauntletBattle, gauntletHeal } from '../src/game.js';

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

test('pity gives a Legendary on the 30th pack without one', () => {
  const p = openPack(PITY_PACKS - 1, fixed(0));       // rand 0 -> all Common otherwise
  assert.equal(BY_ID[p.cards[2]].rarity, 'Legendary');
  assert.equal(p.packsSinceLegend, 0);
  assert.equal(openPack(0, fixed(0)).packsSinceLegend, 1);
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

test('every starter path can win every campaign level going first', () => {
  const paths = [];
  for (const a of STARTER_TEAM) for (const b of STARTER_TEAM) if (a !== b) paths.push([a, b]);
  CAMPAIGN.forEach((_, level) => paths.forEach(path => {
    const team = level < 3 ? [path[0]] : level < 6 ? path : STARTER_TEAM;
    const s = newCampaignBattle(team, level);
    assert.equal(s.turn, 0);
    while (s.winner === null) { const m = aiMove(s, s.turn); applyMove(s, s.turn, m.from, m.move, m.to); }
    assert.equal(s.winner, 0, `level ${level + 1} with ${team.join('+')}`);
  }));
});

test('three chapters of 30 with a boss every 10th level, all real cards', () => {
  assert.deepEqual(CHAPTERS.map(c => c.levels.length), [30, 30, 30]);
  CAMPAIGN.forEach((l, i) => {
    assert.equal(!!l.boss, (i + 1) % 10 === 0, `level ${i + 1}`);
    for (const id of l.enemies) assert.ok(BY_ID[id], id);
  });
});

test('daily spin odds add up and the pack is rare', () => {
  assert.equal(SPIN_SLOTS.reduce((a, s) => a + s.weight, 0), 100);
  const n = Array(8).fill(0);
  for (let i = 0; i < 20000; i++) n[spinWheel()]++;
  assert.ok(Math.abs(n[3] / 200 - 5) < 1, `pack ${n[3] / 200}%`);
  assert.equal(spinWheel(() => 0.999), 7);
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
