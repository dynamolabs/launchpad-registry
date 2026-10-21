import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { keccak_256 } from '@noble/hashes/sha3';
import { sha256 } from '@noble/hashes/sha256';
import { launchpads, chains, byId, lookup, isKnown, forChain, active, frontendsOf } from '../index.mjs';
const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

test('ids are unique and match file names', () => {
  const ids = launchpads.map(l => l.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of chains) { let files = []; try { files = readdirSync(`registry/${c.dir}`).filter(f => f.endsWith('.json')); } catch {}
    for (const f of files) assert.ok(ids.includes(f.replace(/\.json$/, '')), `${f} missing from dist`); }
});
test('builtOn always resolves', () => { for (const l of launchpads) if (l.builtOn) assert.ok(byId(l.builtOn), `${l.id} builtOn ${l.builtOn}`); });
test('lookup is case-insensitive on EVM and exact on Solana', () => {
  assert.equal(lookup('evm-4663', '0xA5AAB3F0C6EEADF30EF1D3EB997108E976351FEB')[0]?.launchpad.id, 'pons');
  assert.equal(lookup({ family: 'solana', id: 'mainnet-beta' }, 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj')[0]?.launchpad.id, 'raydium-launchlab');
  assert.equal(isKnown('solana', '11111111111111111111111111111111'), false);
});
test('topic0 equals keccak(signature) wherever both are given', () => {
  for (const l of launchpads) { const s = l.launch?.signature, t = l.launch?.topic0; if (!s || !t || l.chain.family !== 'evm') continue;
    const canon = s.replace(/\s+indexed\s+/g, ' ').replace(/\s*,\s*/g, ',').replace(/ \w+(?=,|\))/g, '');
    assert.equal(t, '0x' + hex(keccak_256(new TextEncoder().encode(canon))), l.id); }
});
test('anchor discriminators match global:<name>', () => {
  for (const l of launchpads) { const n = l.launch?.name, d = l.launch?.discriminator; if (!d || !/^[a-z0-9_]+$/.test(n || '')) continue;
    assert.equal(d, hex(sha256(new TextEncoder().encode(`global:${n}`)).slice(0, 8)), l.id); }
});
test('helpers', () => {
  assert.ok(forChain('evm-4663').length >= 10);
  assert.ok(active().every(l => l.status === 'active'));
  assert.ok(frontendsOf('raydium-launchlab').map(l => l.id).includes('letsbonk'));
  assert.equal(JSON.parse(readFileSync('dist/launchpads.json', 'utf8')).count, launchpads.length);
});
