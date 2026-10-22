import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTracker } from '../detector/tracker.mjs';

function setup(overrides = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const state = {};
  const tracker = createTracker({
    state,
    windowMin: 60,
    minTokens: 3,
    isKnown: () => false,
    now: clock.now,
    ...overrides,
  });
  return { tracker, state, clock };
}
const tok = (i) => ({ address: `0xt${i}`, symbol: `T${i}`, creator: '0xdev' });

test('alerts exactly once when the threshold is crossed', () => {
  const { tracker } = setup();
  assert.equal(tracker.record('entrypoint', '0xAAA', tok(1)), null);
  assert.equal(tracker.record('entrypoint', '0xAAA', tok(2)), null);
  const hit = tracker.record('entrypoint', '0xAAA', tok(3));
  assert.equal(hit.address, '0xaaa', 'EVM addresses are lower-cased');
  assert.equal(hit.count, 3);
  assert.equal(tracker.record('entrypoint', '0xAAA', tok(4)), null, 'no second alert');
});

test('births outside the rolling window do not count', () => {
  const { tracker, clock } = setup();
  tracker.record('program', 'Prog', tok(1));
  tracker.record('program', 'Prog', tok(2));
  clock.advance(61 * 60e3);
  assert.equal(tracker.record('program', 'Prog', tok(3)), null);
  assert.equal(tracker.record('program', 'Prog', tok(4)), null);
  assert.ok(tracker.record('program', 'Prog', tok(5)), 'three inside the window → alert');
});

test('registered and ignored addresses never alert', () => {
  const { tracker } = setup({ isKnown: (a) => a === '0xknown', ignore: ['0xIGNORED'] });
  for (let i = 0; i < 5; i++) {
    assert.equal(tracker.record('entrypoint', '0xknown', tok(i)), null);
    assert.equal(tracker.record('entrypoint', '0xignored', tok(i)), null);
  }
});

test('Solana program ids keep their case', () => {
  const { tracker, state } = setup({ minTokens: 1 });
  const hit = tracker.record('program', 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj', tok(1));
  assert.equal(hit.address, 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj');
  assert.ok(state['program:LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj']);
});

test('prune drops quiet never-alerted entrypoints and keeps alerted ones', () => {
  const { tracker, state, clock } = setup({ minTokens: 2 });
  tracker.record('entrypoint', '0x1', tok(1));
  tracker.record('entrypoint', '0x2', tok(1));
  tracker.record('entrypoint', '0x2', tok(2)); // alerted
  clock.advance(2 * 60 * 60e3);
  assert.equal(tracker.prune(), 1);
  assert.deepEqual(Object.keys(state), ['entrypoint:0x2']);
  assert.equal(state['entrypoint:0x2'].tokens.length, 0, 'old tokens trimmed');
});
