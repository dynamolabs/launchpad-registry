import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openState } from '../detector/state.mjs';

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'lr-state-')), 'state.json');
const opts = { saveMs: 0, handleSignals: false };

test('round-trips through disk and writes atomically', () => {
  const file = tmpFile();
  const a = openState(file, opts);
  a.get().cursor = 123;
  a.markSeen('sig1');
  a.save();
  assert.ok(existsSync(file));
  assert.ok(!existsSync(file + '.tmp'));
  const b = openState(file, opts);
  assert.equal(b.get().cursor, 123);
  assert.equal(b.markSeen('sig1'), false, 'already seen after reload');
});

test('save is a no-op when nothing changed', () => {
  const file = tmpFile();
  const s = openState(file, opts);
  s.save();
  assert.ok(!existsSync(file));
});

test('seen set is bounded by maxSeen (oldest dropped first)', () => {
  const file = tmpFile();
  const s = openState(file, { ...opts, maxSeen: 10 });
  for (let i = 0; i < 25; i++) s.markSeen(`k${i}`);
  s.save();
  const seen = Object.keys(JSON.parse(readFileSync(file, 'utf8')).seen);
  assert.equal(seen.length, 10);
  assert.ok(seen.includes('k24'));
  assert.ok(!seen.includes('k0'));
});

test('corrupt file falls back to empty state', () => {
  const file = tmpFile();
  const s = openState(file, opts);
  s.touch();
  s.save();
  const t = openState(file + '.missing', opts);
  assert.deepEqual(t.get(), { seen: {}, entrypoints: {}, cursor: null });
});
