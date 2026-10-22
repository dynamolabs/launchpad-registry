import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { topic0, anchorDiscriminator } from '../lib/hash.mjs';
import {
  launchpads,
  chains,
  byId,
  lookup,
  isKnown,
  forChain,
  active,
  frontendsOf,
} from '../index.mjs';

test('ids are unique and match file names', () => {
  const ids = launchpads.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of chains) {
    let files = [];
    try {
      files = readdirSync(`registry/${c.dir}`).filter((f) => f.endsWith('.json'));
    } catch {}
    for (const f of files)
      assert.ok(ids.includes(f.replace(/\.json$/, '')), `${f} missing from dist`);
  }
});
test('builtOn always resolves', () => {
  for (const l of launchpads)
    if (l.builtOn) assert.ok(byId(l.builtOn), `${l.id} builtOn ${l.builtOn}`);
});
test('lookup is case-insensitive on EVM and exact on Solana', () => {
  assert.equal(
    lookup('evm-4663', '0xA5AAB3F0C6EEADF30EF1D3EB997108E976351FEB')[0]?.launchpad.id,
    'pons',
  );
  assert.equal(
    lookup(
      { family: 'solana', id: 'mainnet-beta' },
      'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj',
    )[0]?.launchpad.id,
    'raydium-launchlab',
  );
  assert.equal(isKnown('solana', '11111111111111111111111111111111'), false);
});
test('topic0 equals keccak(signature) wherever both are given', () => {
  for (const l of launchpads) {
    const s = l.launch?.signature,
      t = l.launch?.topic0;
    if (!s || !t || l.chain.family !== 'evm') continue;
    assert.equal(t, topic0(s), l.id);
  }
});
test('anchor discriminators match global:<name>', () => {
  for (const l of launchpads) {
    const n = l.launch?.name,
      d = l.launch?.discriminator;
    if (!d || !/^[a-z0-9_]+$/.test(n || '')) continue;
    assert.equal(d, anchorDiscriminator(n), l.id);
  }
});
test('helpers', () => {
  assert.ok(forChain('evm-4663').length >= 10);
  assert.ok(active().every((l) => l.status === 'active'));
  assert.ok(
    frontendsOf('raydium-launchlab')
      .map((l) => l.id)
      .includes('letsbonk'),
  );
  assert.equal(JSON.parse(readFileSync('dist/launchpads.json', 'utf8')).count, launchpads.length);
});
