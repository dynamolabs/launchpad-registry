import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tradeLinks, buyLinks, chains } from '../index.mjs';

const PLACEHOLDER = /\{(token|ref|pool|dexscreenerId)\}/g;

test('every trade link names a registered chain and uses known placeholders only', () => {
  const dirs = new Set(chains.map((c) => c.dir));
  for (const app of tradeLinks) {
    for (const dir of app.chains) assert.ok(dirs.has(dir), `${app.id}: unknown chain ${dir}`);
    for (const [key, tpl] of Object.entries(app.links)) {
      if (!tpl) continue;
      const left = tpl.replace(PLACEHOLDER, '');
      assert.ok(!/[{}]/.test(left), `${app.id}.links.${key}: unknown placeholder in ${tpl}`);
      if (key === 'referral')
        assert.ok(tpl.includes('{ref}'), `${app.id}: referral link needs {ref}`);
      if (key.startsWith('token'))
        assert.ok(
          tpl.includes('{token}') || tpl.includes('{pool}'),
          `${app.id}.links.${key}: needs {token} or {pool}`,
        );
    }
    if (app.links.tokenNoRef)
      assert.ok(
        !app.links.tokenNoRef.includes('{ref}'),
        `${app.id}: tokenNoRef must not need {ref}`,
      );
  }
});

test('buyLinks fills templates and skips apps whose inputs are missing', () => {
  const mint = 'So11111111111111111111111111111111111111112';
  const withRef = buyLinks({ chain: 'solana', token: mint, ref: 'me' });
  const trojan = withRef.find((l) => l.id === 'trojan');
  assert.equal(trojan.url, `https://t.me/solana_trojanbot?start=r-me-${mint}`);
  assert.ok(!withRef.some((l) => l.id === 'photon'), 'photon needs a pool address');
  assert.ok(!withRef.some((l) => l.url.includes('{')), 'no placeholder left unfilled');

  const noRef = buyLinks({ chain: 'solana', token: mint });
  assert.ok(!noRef.some((l) => l.id === 'trojan'), 'trojan needs a referral code');
  assert.equal(noRef.find((l) => l.id === 'gmgn-web').url, `https://gmgn.ai/sol/token/${mint}`);
  assert.equal(
    noRef.find((l) => l.id === 'dexscreener').url,
    `https://dexscreener.com/solana/${mint}`,
  );

  const rh = buyLinks({ chain: 'evm-4663', token: '0x' + 'a'.repeat(40), ref: 'me' });
  assert.ok(rh.some((l) => l.id === 'based') && rh.some((l) => l.id === 'dexscreener'));
  assert.ok(!rh.some((l) => l.id === 'trojan'), 'trojan is Solana only');

  const pool = buyLinks({ chain: 'solana', token: mint, pool: 'P'.repeat(44) }).find(
    (l) => l.id === 'photon',
  );
  assert.ok(pool && pool.url.endsWith('/lp/' + 'P'.repeat(44)));
});

test('dist/trade-links.json mirrors the registry file and carries the version', () => {
  const dist = JSON.parse(
    readFileSync(new URL('../dist/trade-links.json', import.meta.url), 'utf8'),
  );
  const src = JSON.parse(
    readFileSync(new URL('../registry/trade-links.json', import.meta.url), 'utf8'),
  );
  assert.equal(dist.count, src.length);
  assert.deepEqual(
    dist.links.map((l) => l.id),
    src.map((l) => l.id),
  );
  assert.match(dist.version, /^\d+\.\d+\.\d+/);
});
