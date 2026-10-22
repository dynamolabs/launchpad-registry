#!/usr/bin/env node
// Finds a recent real launch tx for a launchpad using its `launch` spec and records it under `fixtures`
// (proof that the spec works).
//   node scripts/fixtures.mjs <id> [<id> ...]      scan the launchpad's own history
//   node scripts/fixtures.mjs --all
//   node scripts/fixtures.mjs <id>=<known mint>    Solana: walk that mint back to its creation tx
// RPC: SOLANA_RPC / EVM_RPC_<chainId> or the chain's public RPC.
// SOLANA_SIG_RPC = separate RPC for getSignaturesForAddress (some providers index signatures incompletely).
// Tuning: FIXTURE_MAX_SIGS (3000), FIXTURE_BATCH (25), FIXTURE_PACE_MS (250), FIXTURE_MAX_BLOCKS (400000).
import { loadAllEntries, rpcUrlFor, writeJson, today, isMain } from '../lib/files.mjs';
import { makeRpc, rpcBatch, isRateLimit, sleep } from '../lib/rpc.mjs';
import {
  TRANSFER_TOPIC,
  wordToAddress,
  hookFromInitLog,
  mintsByTx,
  tokenFromInitLog,
} from '../detector/evm.mjs';
import { findFungibleMint, allInstructions, feePayer } from '../detector/solana.mjs';

const env = process.env;
const MAX_SIGS = Number(env.FIXTURE_MAX_SIGS || 3000);
const BATCH = Number(env.FIXTURE_BATCH || 25);
const PACE_MS = Number(env.FIXTURE_PACE_MS || 250);
const MAX_BLOCKS = Number(env.FIXTURE_MAX_BLOCKS || 400000);
const ZERO_WORD = '0x' + '0'.repeat(64);
const TX_OPTS = { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 };
const toHex = (n) => '0x' + n.toString(16);
const dateOf = (unixSeconds) => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

/** getTransaction for many signatures: JSON-RPC batch, sequential fallback when the RPC rejects batches. */
async function getTransactions(url, rpc, signatures) {
  try {
    return await rpcBatch(
      url,
      signatures.map((s) => ({ method: 'getTransaction', params: [s, TX_OPTS] })),
    );
  } catch {
    const out = [];
    for (const s of signatures)
      out.push(await rpc('getTransaction', [s, TX_OPTS]).catch(() => null));
    return out;
  }
}

/** A fixture from a Solana tx, or null when it is not a launch of this entry. */
function pickSolana(tx, signature, entry, via) {
  const minted = findFungibleMint(tx);
  if (!minted) return null;
  const program = entry.contracts.find((c) => c.role === 'program')?.address;
  if (
    program &&
    entry.launch?.kind !== 'mint-only' &&
    !allInstructions(tx).some((i) => i.programId === program)
  ) {
    return null;
  }
  if (entry.token?.addressPattern && !new RegExp(entry.token.addressPattern).test(minted.mint))
    return null;
  return {
    tx: signature,
    token: minted.mint,
    creator: feePayer(tx),
    date: dateOf(tx.blockTime),
    note: `found by scripts/fixtures.mjs via ${via.role} ${via.address.slice(0, 8)}`,
  };
}

/** Oldest signature of an account (its creation tx for a mint), paging backwards. */
async function oldestSignature(rpc, address) {
  let last;
  for (let page = 0; page < 20; page++) {
    const sigs = await rpc('getSignaturesForAddress', [address, { limit: 1000, before: last }]);
    if (!sigs.length) break;
    last = sigs[sigs.length - 1].signature;
    if (sigs.length < 1000) break;
    await sleep(200);
  }
  return last;
}

export async function findSolana(url, entry, mintHint) {
  const rpc = makeRpc(url, { minIntervalMs: 100 });
  const sigRpc = env.SOLANA_SIG_RPC ? makeRpc(env.SOLANA_SIG_RPC, { minIntervalMs: 100 }) : rpc;
  // most specific identity first: platform/partner config > program > deployer
  const key =
    entry.contracts.find((c) => ['platform-config', 'partner-config'].includes(c.role)) ||
    entry.contracts.find((c) => c.role === 'program') ||
    entry.contracts.find((c) => c.role === 'deployer');

  if (mintHint) {
    const signature = await oldestSignature(sigRpc, mintHint);
    if (!signature) {
      console.log(
        `  (no signature history for ${mintHint} on this RPC; try SOLANA_SIG_RPC=https://api.mainnet-beta.solana.com)`,
      );
      return null;
    }
    const [tx] = await getTransactions(url, rpc, [signature]);
    return pickSolana(tx, signature, entry, key || { role: 'mint', address: mintHint });
  }
  if (!key) return null;

  let before;
  let scanned = 0;
  while (scanned < MAX_SIGS) {
    const page = await sigRpc('getSignaturesForAddress', [key.address, { limit: 1000, before }]);
    if (!page.length) break;
    before = page[page.length - 1].signature;
    scanned += page.length;
    for (let i = 0; i < page.length; i += BATCH) {
      const chunk = page
        .slice(i, i + BATCH)
        .filter((x) => !x.err)
        .map((x) => x.signature);
      if (!chunk.length) continue;
      const txs = await getTransactions(url, rpc, chunk);
      await sleep(PACE_MS);
      for (let k = 0; k < txs.length; k++) {
        const hit = pickSolana(txs[k], chunk[k], entry, key);
        if (hit) return hit;
      }
    }
    if (page.length < 1000) break;
  }
  return null;
}

async function hookPoolToken(rpc, log, chain) {
  // same rule as the detector: the currency minted in this tx wins, then the first non-quote currency
  const receipt = await rpc('eth_getTransactionReceipt', [log.transactionHash]).catch(() => null);
  const mintedInTx = new Set(
    [...mintsByTx(receipt?.logs || []).values()].flatMap((set) => [...set]),
  );
  const quoteTokens = [...(chain.quoteTokens || []), ...(chain.ignore || [])];
  return tokenFromInitLog(log, { quoteTokens, mintedInTx });
}

export async function findEvm(url, entry, chain) {
  const rpc = makeRpc(url, { minIntervalMs: 80 });
  const launch = entry.launch || {};
  const head = Number(await rpc('eth_blockNumber'));
  const launchers = entry.contracts
    .filter((c) => ['factory', 'launcher', 'curve', 'router', 'program'].includes(c.role))
    .map((c) => c.address);
  const hooks = entry.contracts
    .filter((c) => c.role === 'hook')
    .map((c) => c.address.toLowerCase());
  const poolManager = entry.contracts.find((c) => /PoolManager/i.test(c.label || ''))?.address;
  const step = Math.min(launch.topic0 ? 5000 : 800, chain.maxLogRange || 5000);

  async function logsIn(range) {
    if (launch.topic0 && hooks.length && poolManager) {
      const logs = await rpc('eth_getLogs', [
        { ...range, address: poolManager, topics: [launch.topic0] },
      ]);
      return logs.filter((l) => hooks.includes(hookFromInitLog(l)));
    }
    if (launch.topic0 && launchers.length) {
      return rpc('eth_getLogs', [{ ...range, address: launchers, topics: [launch.topic0] }]);
    }
    if (!launchers.length) return [];
    // fallback: an ERC-20 mint-from-zero whose tx.to is one of our launchers
    const wanted = new Set(launchers.map((a) => a.toLowerCase()));
    const mints = await rpc('eth_getLogs', [{ ...range, topics: [TRANSFER_TOPIC, ZERO_WORD] }]);
    for (const mint of mints.slice(-60).reverse()) {
      const tx = await rpc('eth_getTransactionByHash', [mint.transactionHash]);
      if (tx?.to && wanted.has(tx.to.toLowerCase())) return [mint];
    }
    return [];
  }

  let retries = 0;
  for (let to = head; to > head - MAX_BLOCKS; to -= step) {
    const range = { fromBlock: toHex(Math.max(0, to - step + 1)), toBlock: toHex(to) };
    let logs;
    try {
      logs = await logsIn(range);
      retries = 0;
    } catch (err) {
      if (isRateLimit(err) && retries++ < 5) {
        await sleep(3000);
        to += step; // retry the same range, at most 5 times in a row
        continue;
      }
      if (/limit of|exceeds|too many|more than|too large/i.test(err.message)) {
        console.log(
          `  (skipping blocks ${Number(range.fromBlock)}-${Number(range.toBlock)}: ${err.message.slice(0, 80)})`,
        );
        continue; // deterministic "result set too large": move on instead of looping forever
      }
      throw err;
    }
    if (!logs.length) {
      await sleep(150);
      continue;
    }
    const log = logs[logs.length - 1];
    const tx = await rpc('eth_getTransactionByHash', [log.transactionHash]);
    const block = await rpc('eth_getBlockByNumber', [log.blockNumber, false]);
    let token;
    const fieldMatch = /topics\[(\d)\]/.exec(launch.tokenField || '');
    if (hooks.length && poolManager) token = await hookPoolToken(rpc, log, chain);
    else if (fieldMatch) token = wordToAddress(log.topics[Number(fieldMatch[1])]);
    else if (launch.topic0 && log.topics[1]) token = wordToAddress(log.topics[1]);
    else token = log.address;
    return {
      tx: log.transactionHash,
      token,
      creator: tx?.from,
      date: dateOf(Number(block.timestamp)),
      note: `found by scripts/fixtures.mjs (${launch.topic0 ? 'topic0' : 'mint-from-zero'} in blocks ${Number(range.fromBlock)}-${Number(range.toBlock)})`,
    };
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const mintHints = Object.fromEntries(
    args.filter((a) => a.includes('=') && !a.startsWith('--')).map((a) => a.split('=')),
  );
  const wanted = loadAllEntries().filter(
    ({ entry }) => args.includes('--all') || args.includes(entry.id) || mintHints[entry.id],
  );
  if (!wanted.length) {
    console.error('usage: node scripts/fixtures.mjs <id>... | --all | <id>=<mint>');
    process.exit(1);
  }
  for (const { chain, file, entry } of wanted) {
    const url = rpcUrlFor(chain);
    try {
      const fixture =
        chain.family === 'solana'
          ? await findSolana(url, entry, mintHints[entry.id])
          : await findEvm(url, entry, chain);
      if (!fixture) {
        console.log(`- ${entry.id}: nothing found`);
        continue;
      }
      entry.fixtures = [
        fixture,
        ...(entry.fixtures || []).filter((x) => x.tx !== fixture.tx),
      ].slice(0, 3);
      entry.updated = today();
      writeJson(file, entry);
      console.log(
        `+ ${entry.id}: ${fixture.tx.slice(0, 16)}… token ${fixture.token} (${fixture.date})`,
      );
    } catch (err) {
      console.log(`- ${entry.id}: ${err.message}`);
    }
  }
}

if (isMain(import.meta.url)) await main();
