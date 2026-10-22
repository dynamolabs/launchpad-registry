#!/usr/bin/env node
// Weekly liveness: finds the most recent activity of each launchpad, stamps `lastActivity`,
// and flips status active ↔ inactive after N quiet days.
//   node scripts/liveness.mjs [--write] [--days 30]
import { loadChains, loadEntries, rpcUrlFor, writeJson, today, isMain } from '../lib/files.mjs';
import { makeRpc, isRateLimit, sleep } from '../lib/rpc.mjs';
import { hookFromInitLog } from '../detector/evm.mjs';

const WRITE = process.argv.includes('--write');
/** `--days N` → N; missing or non-numeric → 30. Exported for tests. */
export function parseDays(argv, fallback = 30) {
  const i = argv.indexOf('--days');
  const n = i > -1 ? Number(argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const QUIET_DAYS = parseDays(process.argv);
const DAY_MS = 864e5;
const ACTIVE_ROLES = new Set([
  'program',
  'factory',
  'launcher',
  'curve',
  'hook',
  'platform-config',
  'partner-config',
  'deployer',
]);
const toHex = (n) => '0x' + n.toString(16);

/** Latest block time (ms) touching any key address of the entry on Solana, or null. */
async function lastSolanaActivity(rpc, keys) {
  let last = null;
  for (const key of keys.slice(0, 3)) {
    const sigs = await rpc('getSignaturesForAddress', [key.address, { limit: 1 }]);
    if (sigs[0]?.blockTime) last = Math.max(last || 0, sigs[0].blockTime * 1000);
    await sleep(200);
  }
  return last;
}

/** Average block time in ms, sampled over the last 10 000 blocks. */
async function blockTimeMs(rpc, head) {
  const newest = await rpc('eth_getBlockByNumber', [toHex(head), false]);
  const older = await rpc('eth_getBlockByNumber', [toHex(head - 10000), false]);
  return ((Number(newest.timestamp) - Number(older.timestamp)) * 1000) / 10000;
}

/**
 * Scans back up to QUIET_DAYS in ~1-day chunks and stops at the first log emitted by a key address
 * (or, for hooks, the first PoolManager Initialize log carrying one of the entry's hooks).
 */
async function lastEvmActivity(rpc, chain, entry, keys, { head, blockMs }) {
  const perDay = Math.round(DAY_MS / blockMs);
  const chunk = Math.min(perDay, chain.maxLogRange || 50000);
  const emitters = keys
    .filter((k) => k.role !== 'hook' && k.role !== 'deployer')
    .map((k) => k.address);
  const hooks = keys.filter((k) => k.role === 'hook').map((k) => k.address.toLowerCase());
  const poolManager = entry.contracts.find((k) => /PoolManager/i.test(k.label || ''))?.address;

  for (let to = head; to > head - perDay * QUIET_DAYS; to -= chunk) {
    const range = { fromBlock: toHex(Math.max(0, to - chunk + 1)), toBlock: toHex(to) };
    let logs = [];
    try {
      if (emitters.length) logs = await rpc('eth_getLogs', [{ ...range, address: emitters }]);
      if (!logs.length && hooks.length && poolManager) {
        const topics = [entry.launch?.topic0].filter(Boolean);
        const inits = await rpc('eth_getLogs', [{ ...range, address: poolManager, topics }]);
        logs = inits.filter((l) => hooks.includes(hookFromInitLog(l)));
      }
    } catch (err) {
      if (!isRateLimit(err)) throw err;
      await sleep(2500);
      to += chunk; // retry the same range
      continue;
    }
    if (logs.length) {
      const block = await rpc('eth_getBlockByNumber', [logs[logs.length - 1].blockNumber, false]);
      return Number(block.timestamp) * 1000;
    }
    await sleep(120);
  }
  return null;
}

/** New status given quiet days: active → inactive past the threshold, inactive/unknown → active when seen. */
export function nextStatus(status, quietDays, threshold = QUIET_DAYS) {
  if (quietDays === null) return status;
  if (quietDays > threshold && status === 'active') return 'inactive';
  if (quietDays <= threshold && ['inactive', 'unknown'].includes(status)) return 'active';
  return status;
}

async function main() {
  let changed = 0;
  for (const chain of loadChains()) {
    const entries = loadEntries(chain);
    if (!entries.length) continue;
    const rpc = makeRpc(rpcUrlFor(chain), { minIntervalMs: 80 });
    let evmCtx;
    if (chain.family === 'evm') {
      const head = Number(await rpc('eth_blockNumber'));
      evmCtx = { head, blockMs: await blockTimeMs(rpc, head) };
    }
    for (const { file, entry } of entries) {
      const keys = entry.contracts.filter((k) => ACTIVE_ROLES.has(k.role));
      let last;
      try {
        last =
          chain.family === 'solana'
            ? await lastSolanaActivity(rpc, keys)
            : await lastEvmActivity(rpc, chain, entry, keys, evmCtx);
      } catch (err) {
        console.log(`! ${entry.id}: ${err.message}`);
        continue;
      }
      const lastDate = last ? new Date(last).toISOString().slice(0, 10) : null;
      const quiet = last ? (Date.now() - last) / DAY_MS : null;
      const status = nextStatus(entry.status, quiet);
      const ago = quiet !== null ? ` (${quiet.toFixed(0)} d ago)` : '';
      const flip = status !== entry.status ? `  ${entry.status} → ${status}` : '';
      console.log(`${entry.id.padEnd(22)} last ${lastDate || 'none in window'}${ago}${flip}`);
      if (WRITE && (lastDate !== entry.lastActivity || status !== entry.status)) {
        if (lastDate) entry.lastActivity = lastDate;
        entry.status = status;
        entry.updated = today();
        writeJson(file, entry);
        changed++;
      }
    }
  }
  console.log(WRITE ? `${changed} file(s) updated` : 'dry run (use --write)');
}

if (isMain(import.meta.url)) await main();
