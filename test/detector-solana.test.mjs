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
  source: 'metadata',
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

test('runSolana resumes the rest of a batch after a mid-batch RPC failure', async () => {
  const sigs = ['sig4', 'sig3', 'sig2', 'sig1', 'sig0'].map((signature) => ({
    signature,
    err: null,
  }));
  let failed = false;
  const rpc = scriptedRpc({
    getSignaturesForAddress: () => sigs,
    getTransaction: ([signature]) => {
      if (signature === 'sig2' && !failed) {
        failed = true;
        throw new Error('The operation was aborted due to timeout');
      }
      return pump;
    },
  });
  const state = createMemoryState();
  const notify = collectNotifier();
  await runSolana({
    chain,
    rpcUrl: '',
    registry: { known: () => false },
    notify,
    state,
    log: silent,
    rpc,
    cfg: { ...cfg, minTokens: 5 },
    maxRounds: 3,
  });
  assert.equal(notify.sent.length, 1, 'all five signatures were processed in the end');
  assert.equal(state.get().cursor, 'sig4');
  assert.equal(
    rpc.calls.filter((c) => c.method === 'getTransaction').length,
    6,
    'one retry, no re-fetch of done sigs',
  );
});

// ---- block source -------------------------------------------------------------------------------
import { scanBlock } from '../detector/solana.mjs';
const block = fx('sol-block');

test('scanBlock finds the pump.fun launch in a real block and skips failed / plain transactions', () => {
  const births = scanBlock(block);
  assert.equal(births.length, 1);
  assert.deepEqual(births[0].programs, [PUMP]);
  assert.equal(births[0].decimals, 6);
  assert.match(births[0].mint, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.ok(births[0].signature && births[0].payer);
  assert.ok(block.transactions.length > 1, 'fixture also contains non-launch transactions');
});

test('scanBlock on an empty or missing block yields nothing', () => {
  assert.deepEqual(scanBlock(null), []);
  assert.deepEqual(scanBlock({ transactions: [] }), []);
});

const blockCfg = { ...cfg, source: 'blocks', maxLag: 60, pollMs: 1 };

/** Chain tip at `head`; every slot answers with the recorded block unless listed in `skipped` / `pending`. */
function fakeSlots({ head = 1000, start = 995, skipped = [], pending = [] } = {}) {
  return scriptedRpc({
    getSlot: () => head,
    getBlock: ([slot]) => {
      if (skipped.includes(slot)) throw new Error('{"code":-32007,"message":"Slot was skipped"}');
      if (pending.includes(slot))
        throw new Error('{"code":-32004,"message":"Block not available for slot"}');
      return block;
    },
    _start: start,
  });
}

async function runBlocks(rpc, { start = 995, rounds = 1, overrides = {} } = {}) {
  const state = createMemoryState({ slot: start });
  const notify = collectNotifier();
  await runSolana({
    chain,
    rpcUrl: '',
    registry: { known: () => false },
    notify,
    state,
    log: silent,
    rpc,
    cfg: { ...blockCfg, ...overrides },
    maxRounds: rounds,
  });
  return { state, notify };
}

test('block source scans every slot from the cursor to the tip and alerts on the unknown program', async () => {
  const rpc = fakeSlots();
  const { state, notify } = await runBlocks(rpc);
  assert.equal(state.get().slot, 1000);
  assert.deepEqual(
    rpc.calls.filter((c) => c.method === 'getBlock').map((c) => c.params[0]),
    [996, 997, 998, 999, 1000],
  );
  assert.equal(notify.sent.length, 1, '5 births from pump.fun ≥ minTokens 3');
  assert.equal(notify.sent[0].payload.address, PUMP);
  assert.equal(rpc.calls[1].params[1].maxSupportedTransactionVersion, 1);
});

test('block source skips skipped slots and waits on not-yet-available ones', async () => {
  const pending = [999];
  const rpc = fakeSlots({ skipped: [997], pending });
  const { state, notify } = await runBlocks(rpc, { overrides: { minTokens: 3 } });
  assert.equal(state.get().slot, 998, 'stops before the pending slot without advancing past it');
  assert.equal(notify.sent.length, 0, 'only 996 and 998 counted so far');
  pending.length = 0; // the block is served on the next poll
  const again = await runBlocks(rpc, { start: state.get().slot });
  assert.equal(again.state.get().slot, 1000);
});

test('block source caps catch-up at maxLag slots and logs the gap', async () => {
  const rpc = fakeSlots({ head: 5000, start: 100 });
  const logs = [];
  const state = createMemoryState({ slot: 100 });
  await runSolana({
    chain,
    rpcUrl: '',
    registry: { known: () => false },
    notify: collectNotifier(),
    state,
    log: (m) => logs.push(m),
    rpc,
    cfg: { ...blockCfg, maxLag: 10 },
    maxRounds: 1,
  });
  assert.equal(rpc.calls.filter((c) => c.method === 'getBlock').length, 10);
  assert.equal(state.get().slot, 5000);
  assert.ok(logs.some((l) => /slots behind/.test(l)));
});

test('block source starts at the tip on a fresh state and falls back to tx version 0 on -32015', async () => {
  let rejected = 0;
  const rpc = scriptedRpc({
    getSlot: () => 50,
    getBlock: ([, opts]) => {
      if (opts.maxSupportedTransactionVersion === 1) {
        rejected++;
        throw new Error('{"code":-32015,"message":"Transaction version (1) is not supported"}');
      }
      return block;
    },
  });
  const state = createMemoryState();
  await runSolana({
    chain,
    rpcUrl: '',
    registry: { known: () => false },
    notify: collectNotifier(),
    state,
    log: silent,
    rpc,
    cfg: blockCfg,
    maxRounds: 2,
  });
  assert.equal(state.get().slot, 50);
  assert.equal(rejected, 1);
});

test('metadata source still works when selected explicitly', async () => {
  const { rpc } = fakeChain(pump);
  const state = createMemoryState();
  const notify = collectNotifier();
  await runSolana({
    chain,
    rpcUrl: '',
    registry: { known: () => false },
    notify,
    state,
    log: silent,
    rpc,
    cfg: { ...cfg, source: 'metadata' },
    maxRounds: 1,
  });
  assert.equal(notify.sent.length, 1);
  assert.equal(state.get().cursor, 'sig0');
});

// ---- wrappers that CPI into a known launchpad -----------------------------------------------------
import { innerPrograms } from '../detector/solana.mjs';
const WRAPPER = 'J7pourVwqP1VtRNBiFNqbdGxwkx7ta2LHAURURRRJqmd';

/** The recorded pump.fun tx rewritten as if a bundler program had CPI'd into pump.fun. */
function wrapped() {
  const tx = structuredClone(pump);
  const outer = tx.transaction.message.instructions;
  const pumpIxs = outer.filter((i) => i.programId === PUMP);
  tx.transaction.message.instructions = [
    ...outer.filter((i) => i.programId !== PUMP),
    { programId: WRAPPER, accounts: [], data: 'x' },
  ];
  tx.meta.innerInstructions.push({
    index: tx.transaction.message.instructions.length - 1,
    instructions: pumpIxs,
  });
  return tx;
}

test('innerPrograms lists CPI targets minus system programs', () => {
  const inner = innerPrograms(wrapped());
  assert.ok(inner.includes(PUMP), 'pump.fun reached via CPI');
  assert.ok(!inner.includes(WRAPPER));
  assert.ok(
    !inner.includes('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
    'system programs dropped',
  );
  assert.deepEqual(outerPrograms(wrapped()), [WRAPPER]);
});

test('a wrapper that CPIs into a registered launchpad is credited to the launchpad, not alerted', async () => {
  const sigs = Array.from({ length: 4 }, (_, i) => ({ signature: `w${i}`, err: null }));
  const rpc = scriptedRpc({ getSignaturesForAddress: () => sigs, getTransaction: () => wrapped() });
  const state = createMemoryState();
  const notify = collectNotifier();
  await runSolana({
    chain,
    rpcUrl: '',
    registry: { known: (_d, a) => a === PUMP },
    notify,
    state,
    log: silent,
    rpc,
    cfg: { ...cfg, minTokens: 3 },
    maxRounds: 1,
  });
  assert.equal(notify.sent.length, 0);
  assert.equal(state.get().entrypoints[`program:${WRAPPER}`], undefined, 'wrapper never counted');
  assert.equal(state.get().entrypoints[`program:${PUMP}`].tokens.length, 4);
});

test('the same wrapper IS alerted when the launchpad it calls is unknown', async () => {
  const sigs = Array.from({ length: 3 }, (_, i) => ({ signature: `u${i}`, err: null }));
  const rpc = scriptedRpc({ getSignaturesForAddress: () => sigs, getTransaction: () => wrapped() });
  const notify = collectNotifier();
  await runSolana({
    chain,
    rpcUrl: '',
    registry: { known: () => false },
    notify,
    state: createMemoryState(),
    log: silent,
    rpc,
    cfg: { ...cfg, minTokens: 3 },
    maxRounds: 1,
  });
  assert.equal(notify.sent.length, 1);
  assert.equal(notify.sent[0].payload.address, WRAPPER);
});

test('block source fetches blocks in parallel but applies them in slot order', async () => {
  const order = [];
  const rpc = scriptedRpc({
    getSlot: () => 1006,
    getBlock: async ([slot]) => {
      order.push(slot);
      await new Promise((r) => setTimeout(r, slot % 2 ? 15 : 1)); // odd slots answer late
      return block;
    },
  });
  const state = createMemoryState({ slot: 1000 });
  const notify = collectNotifier();
  await runSolana({
    chain,
    rpcUrl: '',
    registry: { known: () => false },
    notify,
    state,
    log: silent,
    rpc,
    cfg: { ...blockCfg, concurrency: 3 },
    maxRounds: 1,
  });
  assert.deepEqual(order, [1001, 1002, 1003, 1004, 1005, 1006], 'issued in batches of 3, in order');
  assert.equal(state.get().slot, 1006);
  assert.equal(notify.sent.length, 1, '6 births counted once each');
  assert.equal(notify.sent[0].payload.count, 3, 'alert fired at the threshold, in slot order');
});

test('block source with a pending slot inside a parallel batch stops exactly there', async () => {
  const pending = [1003];
  const rpc = fakeSlots({ head: 1006, pending });
  const { state } = await runBlocks(rpc, { start: 1000, overrides: { concurrency: 3 } });
  assert.equal(state.get().slot, 1002);
  pending.length = 0;
  const again = await runBlocks(rpc, { start: 1002, overrides: { concurrency: 3 } });
  assert.equal(again.state.get().slot, 1006);
});
