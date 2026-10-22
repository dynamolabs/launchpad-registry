import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decodeString,
  mintsByTx,
  hookFromInitLog,
  tokenFromInitLog,
  buildAlert,
  runEvm,
  DEFAULT_IGNORE,
  V4_INITIALIZE_TOPIC,
} from '../detector/evm.mjs';
import { createMemoryState, scriptedRpc, collectNotifier, silent } from './helpers.mjs';

const fx = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')).result;
const clankerReceipt = fx('rh-clanker-receipt');
const clankerTx = fx('rh-clanker-tx');
const dopplerReceipt = fx('rh-doppler-receipt');
const CLANKER_TOKEN = '0x397da6f4bd11b29d8e629e62e8b8f1a9a7b79b07';
const MOONME = '0xb783754bcc9469efd8e85bdd4d2584c36f57240d';
const SPCX = '0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea';

test('decodeString handles ABI strings, bytes32 and garbage', () => {
  assert.equal(decodeString(fx('rh-clanker-symbol')), 'UHI');
  assert.equal(decodeString(fx('rh-doppler-symbol')), 'SPCX');
  assert.equal(decodeString('0x' + Buffer.from('WETH').toString('hex').padEnd(64, '0')), 'WETH');
  assert.equal(decodeString('0x'), '');
  assert.equal(decodeString('0xzz'), '');
});

test('mintsByTx finds the ERC-20 born in the Clanker tx and skips the ERC-721 position mint', () => {
  const byTx = mintsByTx(clankerReceipt.logs);
  assert.equal(byTx.size, 1);
  assert.deepEqual([...byTx.get(clankerReceipt.transactionHash)], [CLANKER_TOKEN]);
});

test('hookFromInitLog reads the hook from the Doppler Initialize log', () => {
  const init = dopplerReceipt.logs.find((l) => l.topics[0] === V4_INITIALIZE_TOPIC);
  assert.equal(hookFromInitLog(init), '0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544');
  assert.equal(hookFromInitLog({ ...init, data: '0x' + '0'.repeat(192) }), null);
});

test('tokenFromInitLog prefers the currency minted in the same tx, then non-quote, then currency1', () => {
  const init = dopplerReceipt.logs.find((l) => l.topics[0] === V4_INITIALIZE_TOPIC);
  const minted = new Set([...mintsByTx(dopplerReceipt.logs).values()].flatMap((s) => [...s]));
  assert.equal(tokenFromInitLog(init, { mintedInTx: minted }), MOONME);
  assert.equal(tokenFromInitLog(init, { quoteTokens: [SPCX] }), MOONME);
  assert.equal(
    tokenFromInitLog(init, { quoteTokens: [SPCX, MOONME] }),
    MOONME,
    'falls back to currency1',
  );
  assert.equal(tokenFromInitLog(init), SPCX, 'without hints currency0 wins');
});

test('buildAlert carries explorer, dexscreener and issue links', () => {
  const chain = {
    dir: 'evm-4663',
    name: 'Robinhood Chain',
    explorer: 'https://rh-scan.com/',
    dexscreenerId: 'robinhood',
  };
  const hit = {
    kind: 'hook',
    address: '0xhook',
    count: 3,
    first: 0,
    tokens: [{ a: '0xt', s: 'T', c: '0xdev' }],
  };
  const alert = buildAlert({
    chain,
    hit,
    cfg: { windowMin: 60, repoUrl: 'https://github.com/o/r' },
  });
  assert.match(alert.lines[0], /Uniswap V4 hook: 0xhook/);
  assert.deepEqual(
    alert.links.map((l) => l.text),
    ['explorer', 'dexscreener', 'add to registry'],
  );
  assert.equal(alert.links[0].url, 'https://rh-scan.com/address/0xhook');
  assert.match(alert.links[2].url, /title=%5Bevm-4663%5D%200xhook/);
});

test('DEFAULT_IGNORE covers the ERC-4337 EntryPoints', () => {
  assert.ok(DEFAULT_IGNORE.includes('0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789'));
  assert.ok(DEFAULT_IGNORE.includes('0x0000000071727de22e5e9d8baf0edac6f37da032'));
});

/** Builds a fake chain where `launches` txs from one entrypoint each mint a fresh ERC-20 in block 100. */
function fakeChain({
  launches = 3,
  entrypoint = '0xfac70000000000000000000000000000000000ad',
  existing = false,
  erc20 = true,
  to = entrypoint,
} = {}) {
  const logs = [];
  const txs = {};
  for (let i = 0; i < launches; i++) {
    const token = `0x${(i + 1).toString(16).padStart(40, '0')}`;
    const hash = `0xtx${i}`;
    logs.push({
      address: token,
      transactionHash: hash,
      topics: [
        clankerReceipt.logs[0].topics[0],
        '0x' + '0'.repeat(64),
        '0x' + '0'.repeat(24) + 'dead'.padEnd(40, '0'),
      ],
    });
    txs[hash] = { ...clankerTx, hash, to, blockNumber: '0x64' };
  }
  return scriptedRpc({
    eth_blockNumber: () => '0x64',
    eth_getLogs: ([{ topics }]) => (topics[1] ? logs : []),
    eth_getTransactionByHash: ([hash]) => txs[hash] || null,
    eth_getCode: () => (existing ? '0x6001' : '0x'),
    eth_call: ([{ data }]) =>
      data === '0x313ce567' ? (erc20 ? '0x12'.padEnd(66, '0') : '0x') : fx('rh-clanker-symbol'),
  });
}

const chain = { dir: 'evm-4663', id: 4663, name: 'RH', family: 'evm' };
const cfg = {
  windowMin: 60,
  minTokens: 3,
  pollMs: 1,
  chunk: 200,
  quoteTokens: [],
  ignore: [],
  repoUrl: 'https://r',
};
const registry = (knownAddresses = []) => ({ known: (_dir, a) => knownAddresses.includes(a) });

async function run(rpc, { minRounds = 2, reg = registry() } = {}) {
  const state = createMemoryState();
  const notify = collectNotifier();
  await runEvm({
    chain,
    rpcUrl: '',
    registry: reg,
    notify,
    state,
    cfg,
    log: silent,
    rpc,
    maxRounds: minRounds,
  });
  return { state, notify };
}

test('runEvm alerts once for an unknown entrypoint minting 3 tokens', async () => {
  const { notify, state } = await run(fakeChain());
  assert.equal(notify.sent.length, 1);
  assert.match(notify.sent[0].lines[0], /entrypoint \(tx\.to\): 0xfac7/);
  assert.equal(notify.sent[0].payload.count, 3);
  assert.equal(state.get().cursor, 100, 'cursor advanced to head');
});

test('runEvm stays silent for registered entrypoints', async () => {
  const { notify } = await run(fakeChain(), {
    reg: registry(['0xfac70000000000000000000000000000000000ad']),
  });
  assert.equal(notify.sent.length, 0);
});

test('runEvm ignores ERC-4337 EntryPoint as tx.to', async () => {
  const { notify } = await run(fakeChain({ to: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' }));
  assert.equal(notify.sent.length, 0);
});

test('runEvm skips contracts that already had code (LP / receipt tokens) and non-ERC-20s', async () => {
  assert.equal((await run(fakeChain({ existing: true }))).notify.sent.length, 0);
  assert.equal((await run(fakeChain({ erc20: false }))).notify.sent.length, 0);
});

test('runEvm counts direct deploys (tx.to = null) as no entrypoint', async () => {
  const { notify } = await run(fakeChain({ to: null }));
  assert.equal(notify.sent.length, 0);
});

test('runEvm does not re-process a token it has already seen', async () => {
  const rpc = fakeChain();
  const { notify } = await run(rpc, { minRounds: 4 });
  assert.equal(notify.sent.length, 1);
  assert.equal(rpc.calls.filter((c) => c.method === 'eth_getTransactionByHash').length, 3);
});

test('runEvm keys V4 pools by hook and names the minted currency', async () => {
  const init = dopplerReceipt.logs.find((l) => l.topics[0] === V4_INITIALIZE_TOPIC);
  const rpc = scriptedRpc({
    eth_blockNumber: () => '0x64',
    eth_getLogs: ([{ address }]) =>
      address ? [0, 1, 2].map((i) => ({ ...init, transactionHash: `0xpool${i}` })) : [],
    eth_getTransactionByHash: () => ({ from: '0xDEV' }),
    eth_call: () => fx('rh-doppler-symbol'),
  });
  const state = createMemoryState();
  const notify = collectNotifier();
  await runEvm({
    chain,
    rpcUrl: '',
    registry: registry(),
    notify,
    state,
    log: silent,
    rpc,
    maxRounds: 2,
    cfg: {
      ...cfg,
      v4PoolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
      quoteTokens: [SPCX],
    },
  });
  assert.equal(notify.sent.length, 1);
  assert.match(
    notify.sent[0].lines[0],
    /Uniswap V4 hook: 0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544/,
  );
  assert.equal(notify.sent[0].payload.tokens[0].a, MOONME);
  assert.equal(notify.sent[0].payload.tokens[0].c, '0xdev');
});

test('runEvm survives RPC errors and keeps polling', async () => {
  let n = 0;
  const rpc = scriptedRpc({
    eth_blockNumber: () => {
      if (n++ === 1) throw new Error('HTTP 429');
      return '0x64';
    },
    eth_getLogs: () => [],
  });
  const { state } = await run(rpc, { minRounds: 3 });
  assert.equal(state.get().cursor, 100);
});

test('runEvm retries a range after a tx fetch failure without losing the tokens', async () => {
  let failed = false;
  const base = fakeChain();
  const rpc = scriptedRpc({
    eth_blockNumber: () => '0x64',
    eth_getLogs: (p) => base('eth_getLogs', p),
    eth_getTransactionByHash: ([hash]) => {
      if (hash === '0xtx1' && !failed) {
        failed = true;
        throw new Error('fetch timeout');
      }
      return base('eth_getTransactionByHash', [hash]);
    },
    eth_getCode: () => '0x',
    eth_call: (p) => base('eth_call', p),
  });
  const { notify, state } = await run(rpc, { minRounds: 4 });
  assert.equal(notify.sent.length, 1, 'all three tokens eventually counted');
  assert.equal(notify.sent[0].payload.count, 3);
  assert.equal(state.get().cursor, 100);
});

test('runEvm does not count the same V4 pool twice when a range is retried', async () => {
  const init = dopplerReceipt.logs.find((l) => l.topics[0] === V4_INITIALIZE_TOPIC);
  let calls = 0;
  const rpc = scriptedRpc({
    eth_blockNumber: () => '0x64',
    eth_getLogs: ([{ address }]) =>
      address ? [0, 1].map((i) => ({ ...init, transactionHash: `0xpool${i}` })) : [],
    eth_getTransactionByHash: () => {
      if (calls++ === 1) throw new Error('fetch timeout'); // second pool fetch fails → range retried
      return { from: '0xdev' };
    },
    eth_call: () => fx('rh-doppler-symbol'),
  });
  const state = createMemoryState();
  const notify = collectNotifier();
  await runEvm({
    chain,
    rpcUrl: '',
    registry: registry(),
    notify,
    state,
    log: silent,
    rpc,
    maxRounds: 4,
    cfg: { ...cfg, minTokens: 3, v4PoolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951' },
  });
  assert.equal(notify.sent.length, 0, 'two pools stay two births after the retry, never three');
  assert.equal(
    state.get().entrypoints['hook:0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544'].tokens.length,
    2,
  );
});

test('runEvm reports launches on a registered hook to onLaunch and skips unknown ones', async () => {
  const rpc = scriptedRpc({
    eth_blockNumber: () => '0x64',
    eth_getLogs: ([{ topics }]) =>
      topics[0] === V4_INITIALIZE_TOPIC
        ? dopplerReceipt.logs.filter((l) => l.topics[0] === V4_INITIALIZE_TOPIC)
        : [],
    eth_getTransactionByHash: () => ({ ...clankerTx, from: '0xabc' }),
    eth_call: () => fx('rh-doppler-symbol'),
    eth_getCode: () => '0x',
  });
  const HOOK = '0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544';
  const launches = [];
  const notify = collectNotifier();
  await runEvm({
    chain,
    rpcUrl: '',
    registry: { known: (_d, a) => a === HOOK },
    notify,
    state: createMemoryState(),
    log: silent,
    rpc,
    maxRounds: 2,
    cfg: {
      ...cfg,
      v4PoolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
      quoteTokens: [SPCX],
    },
    onLaunch: async (l) => launches.push(l),
  });
  assert.equal(launches.length, 1);
  assert.deepEqual(launches[0].programs, [HOOK]);
  assert.equal(launches[0].token.address, MOONME);
  assert.equal(launches[0].token.symbol, 'SPCX');
  assert.equal(notify.sent.length, 0);
});

test('runEvm standby skips polling while inactive and resumes at the tip', async () => {
  const rpc = fakeChain();
  let checks = 0;
  const state = createMemoryState({ cursor: 50 });
  const notify = collectNotifier();
  await runEvm({
    chain,
    rpcUrl: '',
    registry: registry(),
    notify,
    state,
    log: silent,
    rpc,
    cfg,
    standby: { active: () => ++checks > 2, pollMs: 1 }, // paused for two rounds, then active
    maxRounds: 4,
  });
  const ranges = rpc.calls
    .filter((c) => c.method === 'eth_getLogs')
    .map((c) => c.params[0].fromBlock);
  assert.ok(
    ranges.length > 0 && ranges.every((f) => Number(f) === 100),
    'scanned only the tip block',
  );
});
