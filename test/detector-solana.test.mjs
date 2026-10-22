import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  findFungibleMint,
  outerPrograms,
  feePayer,
  buildAlert,
  runSolana,
  BASE_IGNORE,
} from '../detector/solana.mjs';
import { createMemoryState, scriptedRpc, collectNotifier, silent } from './helpers.mjs';

const fx = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')).result;
const pump = fx('sol-pump');
const launchlab = fx('sol-launchlab');
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const LAUNCHLAB = 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj';

test('findFungibleMint reads the mint from pump.fun and LaunchLab transactions', () => {
  assert.deepEqual(findFungibleMint(pump), {
    mint: 'CDamKWeSQ5CS8s6tm5aDdw9fC3tpwEHAgNGrCCWppump',
    decimals: 6,
  });
  assert.deepEqual(findFungibleMint(launchlab), {
    mint: 'vPJkvMpNyTqZtbzU97RsjsiZpJNNhaK9D16jUrrNray',
    decimals: 6,
  });
});

test('findFungibleMint skips NFTs (decimals 0), failed and missing transactions', () => {
  const nft = structuredClone(pump);
  for (const i of nft.meta.innerInstructions.flatMap((x) => x.instructions)) {
    if (i.parsed?.type?.startsWith('initializeMint')) i.parsed.info.decimals = 0;
  }
  assert.equal(findFungibleMint(nft), null);
  assert.equal(
    findFungibleMint({ ...pump, meta: { ...pump.meta, err: { InstructionError: [0, 'Custom'] } } }),
    null,
  );
  assert.equal(findFungibleMint(null), null);
});

test('outerPrograms keeps only candidate launchpad programs', () => {
  assert.deepEqual(outerPrograms(pump), [PUMP]);
  assert.deepEqual(outerPrograms(launchlab), [LAUNCHLAB]);
  assert.deepEqual(outerPrograms(launchlab, [...BASE_IGNORE, LAUNCHLAB]), []);
});

test('feePayer is the first signer', () => {
  assert.equal(feePayer(pump), pump.transaction.message.accountKeys[0].pubkey);
  assert.ok(pump.transaction.message.accountKeys[0].signer);
});

test('buildAlert links solscan, dexscreener and the issue template', () => {
  const hit = { address: PUMP, count: 5, first: 0, tokens: [{ a: 'Mint1', c: 'Payer' }] };
  const alert = buildAlert({
    chain: { dir: 'solana' },
    hit,
    cfg: { windowMin: 60, repoUrl: 'https://r' },
  });
  assert.equal(alert.links[0].url, `https://solscan.io/account/${PUMP}`);
  assert.equal(alert.links[1].url, 'https://dexscreener.com/solana/Mint1');
  assert.match(alert.links[2].url, /%5Bsolana%5D%20/);
});

const chain = { dir: 'solana', family: 'solana', name: 'Solana' };
const cfg = {
  windowMin: 60,
  minTokens: 3,
  pollMs: 1,
  batch: 100,
  ignore: [],
  repoUrl: 'https://r',
};

/** RPC where every signature resolves to the given tx (so one program mints N tokens). */
function fakeChain(tx, { count = 3, rejectVersion1 = false } = {}) {
  const sigs = Array.from({ length: count }, (_, i) => ({ signature: `sig${i}`, err: null }));
  let versionErrors = 0;
  return {
    rpc: scriptedRpc({
      getSignaturesForAddress: () => sigs,
      getTransaction: ([, opts]) => {
        if (rejectVersion1 && opts.maxSupportedTransactionVersion === 1) {
          versionErrors++;
          throw new Error('{"code":-32015,"message":"Transaction version (0) is not supported"}');
        }
        return tx;
      },
    }),
    versionErrors: () => versionErrors,
  };
}

async function run(rpc, { known = [], rounds = 1 } = {}) {
  const state = createMemoryState();
  const notify = collectNotifier();
  const registry = { known: (_d, a) => known.includes(a) };
  await runSolana({
    chain,
    rpcUrl: '',
    registry,
    notify,
    state,
    cfg,
    log: silent,
    rpc,
    maxRounds: rounds,
  });
  return { state, notify };
}

test('runSolana alerts once on an unknown program creating 3 fungible mints', async () => {
  const { notify, state } = await run(fakeChain(pump).rpc);
  assert.equal(notify.sent.length, 1);
  assert.equal(notify.sent[0].payload.address, PUMP);
  assert.equal(state.get().cursor, 'sig0', 'newest signature becomes the cursor');
});

test('runSolana is silent for registered programs and below the threshold', async () => {
  assert.equal((await run(fakeChain(pump).rpc, { known: [PUMP] })).notify.sent.length, 0);
  assert.equal((await run(fakeChain(pump, { count: 2 }).rpc)).notify.sent.length, 0);
});

test('runSolana does not re-fetch signatures it already processed', async () => {
  const { rpc } = fakeChain(pump);
  await run(rpc, { rounds: 3 });
  assert.equal(rpc.calls.filter((c) => c.method === 'getTransaction').length, 3);
});

test('runSolana falls back to maxSupportedTransactionVersion 0 on -32015 and remembers it', async () => {
  const fake = fakeChain(pump, { rejectVersion1: true });
  const { notify } = await run(fake.rpc);
  assert.equal(notify.sent.length, 1);
  assert.equal(fake.versionErrors(), 1, 'only the first call pays for the fallback');
});
