import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reservedName } from '../src/index.js';

test('names that pass as the game or its staff are reserved, in any casing', () => {
  for (const n of ['admin', 'ADMIN', 'Admin_1', 'HoloSynth', 'holosynth_team', 'Support', 'mod', 'Official_Lucas', 'dev_']) assert.ok(reservedName(n), n);
  for (const n of ['lucas', 'noah', 'dan', 'modest', 'helper', 'teamrocket', 'e2e_abc']) assert.ok(!reservedName(n), n);
});
