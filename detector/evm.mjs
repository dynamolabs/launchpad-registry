// EVM engine: every ERC-20 mint-from-zero → the tx.to entrypoint (or the Uniswap V4 hook) that created it
// → counted per window by the tracker → one alert per unknown entrypoint.
import { makeRpc, isRateLimit, sleep } from '../lib/rpc.mjs';
import { createTracker, migrateLegacyKeys } from './tracker.mjs';

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const V4_INITIALIZE_TOPIC =
  '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
const ZERO_WORD = '0x' + '0'.repeat(64);
const ZERO_ADDRESS = '0x' + '0'.repeat(40);
const SELECTOR_DECIMALS = '0x313ce567';
const SELECTOR_SYMBOL = '0x95d89b41';

/**
 * Addresses that create tokens on every chain but are never a launchpad:
 * ERC-4337 EntryPoints, Multicall3, CREATE2 deployers.
 */
export const DEFAULT_IGNORE = [
  '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789', // EntryPoint v0.6
  '0x0000000071727de22e5e9d8baf0edac6f37da032', // EntryPoint v0.7
  '0x4337084d9e255ff0702461cf8895ce9e3b5ff108', // EntryPoint v0.8
  '0xca11bde05977b3631167028862be2a173976ca11', // Multicall3
  '0x4e59b44847b379578588920ca78fbf26c0b4956c', // deterministic-deployment-proxy
  '0x914d7fec6aac8cd542e72bca78b30650d45643d7', // Safe singleton factory
];

/** Last 20 bytes of a 32-byte word, 0x-prefixed. */
export const wordToAddress = (word) => '0x' + word.slice(-40).toLowerCase();

/** Decodes an ABI `string` or `bytes32` return value; '' when it cannot. */
export function decodeString(hex) {
  try {
    if (!hex || hex === '0x') return '';
    const buf = Buffer.from(hex.slice(2), 'hex');
    if (buf.length === 32) return buf.toString('utf8').replace(/\0+$/, '');
    const offset = Number(BigInt('0x' + buf.subarray(0, 32).toString('hex')));
    const length = Number(BigInt('0x' + buf.subarray(offset, offset + 32).toString('hex')));
    return buf.subarray(offset + 32, offset + 32 + length).toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Groups ERC-20 `Transfer(from = 0x0)` logs by transaction.
 * ERC-721 transfers (4 topics) are dropped.
 * @returns {Map<string, Set<string>>}  txHash → minted contract addresses (lower-case)
 */
export function mintsByTx(logs) {
  const byTx = new Map();
  for (const log of logs) {
    if (log.topics.length !== 3 || log.topics[0] !== TRANSFER_TOPIC || log.topics[1] !== ZERO_WORD)
      continue;
    const address = log.address.toLowerCase();
    if (!byTx.has(log.transactionHash)) byTx.set(log.transactionHash, new Set());
    byTx.get(log.transactionHash).add(address);
  }
  return byTx;
}

/** Hook address of a Uniswap V4 `Initialize` log (third data word), or null for hookless pools. */
export function hookFromInitLog(log) {
  const hook = wordToAddress(log.data.slice(2 + 64 * 2, 2 + 64 * 3));
  return hook === ZERO_ADDRESS ? null : hook;
}

/**
 * Which currency of a V4 `Initialize` log is the launched token: the one minted in the same tx when known,
 * else the first that is not a quote token, else currency1.
 */
export function tokenFromInitLog(log, { quoteTokens = [], mintedInTx = new Set() } = {}) {
  const currencies = [log.topics[2], log.topics[3]].map(wordToAddress);
  const quotes = new Set(quoteTokens.map((a) => a.toLowerCase()));
  return (
    currencies.find((c) => mintedInTx.has(c)) ||
    currencies.find((c) => !quotes.has(c) && c !== ZERO_ADDRESS) ||
    currencies[1]
  );
}

/** Builds the alert for one unknown entrypoint. */
export function buildAlert({ chain, hit, cfg }) {
  const explorer = chain.explorer?.replace(/\/$/, '');
  const latest = hit.tokens.at(-1);
  const samples = hit.tokens.slice(-5).map((x) => `${x.s || '?'} ${x.a}`);
  const issueTitle = encodeURIComponent(`[${chain.dir}] ${hit.address}`);
  return {
    title: `🚨 Unregistered launchpad on ${chain.name}`,
    lines: [
      `${hit.kind === 'hook' ? 'Uniswap V4 hook' : 'entrypoint (tx.to)'}: ${hit.address}`,
      `${hit.count} tokens in ${cfg.windowMin} min, first ${new Date(hit.first).toISOString().slice(0, 16)}Z`,
      `latest creator: ${latest.c}`,
      'sample tokens:',
      ...samples,
    ],
    links: [
      explorer && { text: 'explorer', url: `${explorer}/address/${hit.address}` },
      chain.dexscreenerId && {
        text: 'dexscreener',
        url: `https://dexscreener.com/${chain.dexscreenerId}/${latest.a}`,
      },
      {
        text: 'add to registry',
        url: `${cfg.repoUrl}/issues/new?template=new-launchpad.md&title=${issueTitle}`,
      },
    ].filter(Boolean),
    payload: {
      chain: chain.dir,
      kind: hit.kind,
      address: hit.address,
      count: hit.count,
      tokens: hit.tokens,
    },
  };
}

const toHex = (n) => '0x' + n.toString(16);

/**
 * Runs the EVM engine until the process exits.
 * @param {object} ctx
 * @param {object} ctx.chain      entry from registry/chains.json
 * @param {string} ctx.rpcUrl
 * @param {object} ctx.registry   from detector/registry.mjs
 * @param {object} ctx.notify     from detector/notify.mjs
 * @param {object} ctx.state      from detector/state.mjs
 * @param {object} ctx.cfg        { windowMin, minTokens, pollMs, chunk, v4PoolManager, quoteTokens, ignore, repoUrl }
 * @param {Function} ctx.log
 * @param {Function} [ctx.rpc]    injected JSON-RPC client (tests); defaults to makeRpc(rpcUrl)
 * @param {Function} [ctx.onLaunch]  from detector/watch.mjs: every launch on a *registered* entrypoint / hook,
 *   as { programs: [address], accounts: [], token }
 * @param {{ active: () => boolean, pollMs?: number }} [ctx.standby]  scan-on-demand: no RPC calls while inactive
 * @param {number} [ctx.maxRounds]  stop after this many poll rounds (tests); default forever
 */
export async function runEvm({
  chain,
  rpcUrl,
  registry,
  notify,
  state,
  cfg,
  log,
  rpc,
  onLaunch,
  standby,
  maxRounds = Infinity,
}) {
  rpc ??= makeRpc(rpcUrl, { minIntervalMs: cfg.rpcIntervalMs ?? 60 });
  const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']).catch(() => null);
  const s = state.get();
  s.entrypoints ??= {};
  if (migrateLegacyKeys(s.entrypoints) > 0) state.touch();
  const tracker = createTracker({
    state: s.entrypoints,
    windowMin: cfg.windowMin,
    minTokens: cfg.minTokens,
    isKnown: (address) => registry.known(chain.dir, address),
    ignore: [...DEFAULT_IGNORE, ...(cfg.ignore || [])],
  });

  /** true when the contract already had code one block before this tx: LP / receipt token, not a launch. */
  async function existedBefore(address, blockNumber) {
    const code = await rpc('eth_getCode', [address, toHex(Number(blockNumber) - 1)]).catch(
      () => null,
    );
    return Boolean(code && code !== '0x');
  }

  async function describeToken(address) {
    const decimals = await call(address, SELECTOR_DECIMALS);
    if (!decimals || decimals === '0x') return null; // not an ERC-20 (NFT etc.)
    const symbol = decodeString(await call(address, SELECTOR_SYMBOL)).slice(0, 24);
    return { address, symbol };
  }

  async function report(kind, address, token) {
    const hit = tracker.record(kind, address, token);
    if (hit) await notify.send(buildAlert({ chain, hit, cfg }));
    if (onLaunch && registry.known(chain.dir, address)) {
      await onLaunch({ programs: [address], accounts: [], token });
    }
    state.touch();
  }

  async function processMints(range) {
    const logs = await rpc('eth_getLogs', [{ ...range, topics: [TRANSFER_TOPIC, ZERO_WORD] }]);
    const minted = new Set();
    for (const [txHash, addresses] of mintsByTx(logs)) {
      // a token is marked seen only once fully processed, so an RPC failure mid-range is retried, not lost
      const fresh = [...addresses].filter((a) => !s.seen[a]);
      if (!fresh.length) continue;
      const tx = await rpc('eth_getTransactionByHash', [txHash]);
      if (!tx) continue;
      for (const address of fresh) {
        await classifyMint(address, tx);
        state.markSeen(address);
      }
    }
    return minted;

    async function classifyMint(address, tx) {
      if (await existedBefore(address, tx.blockNumber)) return;
      const token = await describeToken(address);
      if (!token) return;
      minted.add(address);
      token.creator = tx.from.toLowerCase();
      if (tx.to) await report('entrypoint', tx.to, token);
      else
        log(
          `[evm-${chain.id}] direct deploy ${token.symbol} ${address} by ${tx.from} (no entrypoint)`,
        );
    }
  }

  async function processV4Pools(range, minted) {
    const logs = await rpc('eth_getLogs', [
      { ...range, address: cfg.v4PoolManager, topics: [V4_INITIALIZE_TOPIC] },
    ]);
    for (const log of logs) {
      const hook = hookFromInitLog(log);
      if (!hook) continue;
      const seenKey = `v4:${log.transactionHash}:${hook}`;
      if (s.seen[seenKey]) continue;
      const tokenAddress = tokenFromInitLog(log, {
        quoteTokens: cfg.quoteTokens,
        mintedInTx: minted,
      });
      const symbol = decodeString(await call(tokenAddress, SELECTOR_SYMBOL)).slice(0, 24);
      const tx = await rpc('eth_getTransactionByHash', [log.transactionHash]);
      await report('hook', hook, {
        address: tokenAddress,
        symbol,
        creator: tx?.from?.toLowerCase() || '?',
      });
      state.markSeen(seenKey);
    }
  }

  let head = Number(await rpc('eth_blockNumber'));
  let cursor = s.cursor ?? head - 1;
  log(
    `[evm-${chain.id}] head ${head}, cursor ${cursor}, window ${cfg.windowMin} min, min ${cfg.minTokens} tokens, v4 ${cfg.v4PoolManager || '-'}`,
  );

  let paused = false;
  for (let round = 0; round < maxRounds; round++) {
    try {
      if (standby && !standby.active()) {
        if (!paused) {
          paused = true;
          log(`[evm-${chain.id}] standby: nobody is watching, chain polling paused`);
        }
        await sleep(standby.pollMs ?? 5000);
        continue;
      }
      head = Number(await rpc('eth_blockNumber'));
      if (paused) {
        paused = false;
        cursor = head - 1; // resume at the tip, not through the backlog
        log(`[evm-${chain.id}] resuming at block ${head}`);
      }
      if (head <= cursor) {
        await sleep(cfg.pollMs);
        continue;
      }
      const to = Math.min(head, cursor + cfg.chunk);
      const range = { fromBlock: toHex(cursor + 1), toBlock: toHex(to) };
      const minted = await processMints(range);
      if (cfg.v4PoolManager) await processV4Pools(range, minted);
      cursor = to;
      s.cursor = cursor;
      state.touch();
      if (round % 50 === 49 && tracker.prune() > 0) state.touch();
      if (to < head) continue; // still catching up: no sleep
    } catch (err) {
      const rateLimited = isRateLimit(err);
      log(`[evm-${chain.id}] ${err.message}${rateLimited ? ' (backing off)' : ''}`);
      await sleep(cfg.pollMs * (rateLimited ? 6 : 2));
    }
    await sleep(cfg.pollMs);
  }
}
