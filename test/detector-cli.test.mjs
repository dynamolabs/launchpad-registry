import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, buildConfig } from '../detector/index.mjs';

test('parseArgs handles values and boolean flags', () => {
  assert.deepEqual(parseArgs(['--chain', 'solana', '--help', '--min', '5']), {
    chain: 'solana',
    help: 'true',
    min: '5',
  });
  assert.deepEqual(parseArgs([]), {});
});

test('buildConfig applies per-family defaults', () => {
  const sol = buildConfig({}, { family: 'solana' }, {});
  assert.equal(sol.minTokens, 5);
  assert.equal(sol.pollMs, 1000);
  const evm = buildConfig({}, { family: 'evm' }, {});
  assert.equal(evm.minTokens, 3);
  assert.equal(evm.pollMs, 4000);
  assert.match(evm.repoUrl, /launchpad-registry/);
});

test('buildConfig clamps chunk to the chain maxLogRange and merges chain + CLI lists', () => {
  const chain = { family: 'evm', maxLogRange: 10, quoteTokens: ['0xAA'], ignore: ['0x1'] };
  const cfg = buildConfig(
    { chunk: '500', quotes: '0xBB, 0xCC', ignore: '0x2', v4: '0xPM' },
    chain,
    { REPO_URL: 'https://me' },
  );
  assert.equal(cfg.chunk, 10);
  assert.deepEqual(cfg.quoteTokens, ['0xaa', '0xbb', '0xcc']);
  assert.deepEqual(cfg.ignore, ['0x1', '0x2']);
  assert.equal(cfg.v4PoolManager, '0xpm');
  assert.equal(cfg.repoUrl, 'https://me');
});

test('buildConfig picks the Solana source and its poll interval', () => {
  const sol = { family: 'solana' };
  assert.equal(buildConfig({}, sol, {}).source, 'blocks');
  assert.equal(buildConfig({}, sol, {}).pollMs, 1000);
  assert.equal(buildConfig({ source: 'metadata' }, sol, {}).pollMs, 8000);
  assert.equal(buildConfig({ lag: '20' }, sol, {}).maxLag, 20);
});

test('buildConfig exposes block-fetch concurrency', () => {
  assert.equal(buildConfig({}, { family: 'solana' }, {}).concurrency, 3);
  assert.equal(buildConfig({ concurrency: '5' }, { family: 'solana' }, {}).concurrency, 5);
});

test('buildConfig parses --watch and the buy-button env', () => {
  const solana = { family: 'solana' };
  assert.equal(buildConfig({}, solana, {}).watch, null);
  assert.deepEqual(buildConfig({ watch: 'true' }, solana, {}).watch, []);
  assert.deepEqual(buildConfig({ watch: 'pump-fun, bags' }, solana, {}).watch, [
    'pump-fun',
    'bags',
  ]);
  const cfg = buildConfig({ watch: 'all' }, solana, {
    TRADE_REF: 'me',
    BUY_BUTTONS: 'trojan,dexscreener',
    TELEGRAM_ALLOW: '1,2',
  });
  assert.deepEqual(cfg.watch, ['all']);
  assert.equal(cfg.tradeRef, 'me');
  assert.deepEqual(cfg.buyButtons, ['trojan', 'dexscreener']);
  assert.deepEqual(cfg.telegramAllow, ['1', '2']);
});
