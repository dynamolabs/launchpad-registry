import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextStatus } from '../scripts/liveness.mjs';

test('nextStatus flips active ↔ inactive around the quiet threshold', () => {
  assert.equal(nextStatus('active', 31, 30), 'inactive');
  assert.equal(nextStatus('active', 29, 30), 'active');
  assert.equal(nextStatus('inactive', 2, 30), 'active');
  assert.equal(nextStatus('unknown', 2, 30), 'active');
  assert.equal(nextStatus('test', 2, 30), 'test', 'test entries are never promoted');
  assert.equal(nextStatus('active', null, 30), 'active', 'no data → unchanged');
});

import { parseDays } from '../scripts/liveness.mjs';

test('parseDays falls back to 30 when --days has no usable value', () => {
  assert.equal(parseDays(['--write', '--days', '7']), 7);
  assert.equal(parseDays(['--write', '--days']), 30);
  assert.equal(parseDays(['--days', 'abc']), 30);
  assert.equal(parseDays([]), 30);
});
