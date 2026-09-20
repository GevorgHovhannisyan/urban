import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointsValueInDollars, POINTS_PER_REDEMPTION_UNIT, REDEMPTION_UNIT_VALUE } from '../../server/loyalty.mjs';

test('pointsValueInDollars: below one redemption unit is worth $0', () => {
  assert.equal(pointsValueInDollars(99), 0);
});

test('pointsValueInDollars: exactly one redemption unit', () => {
  assert.equal(pointsValueInDollars(POINTS_PER_REDEMPTION_UNIT), REDEMPTION_UNIT_VALUE);
});

test('pointsValueInDollars: rounds down to the nearest whole redemption unit', () => {
  assert.equal(pointsValueInDollars(264), 2 * REDEMPTION_UNIT_VALUE); // 264 points -> 2 units of 100 -> $10, not $13.20
});

test('pointsValueInDollars: negative/zero points are worth $0, never negative', () => {
  assert.equal(pointsValueInDollars(0), 0);
  assert.equal(pointsValueInDollars(-50), 0);
});
