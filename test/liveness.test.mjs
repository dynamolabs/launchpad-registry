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
