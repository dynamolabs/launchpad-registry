#!/usr/bin/env node
// Finds a recent real launch tx for a launchpad using its `launch` spec and records it under `fixtures` (proof the spec works).
//   node scripts/fixtures.mjs <id> [<id> ...]   |   node scripts/fixtures.mjs --all   |   node scripts/fixtures.mjs <id>=<known mint>  (Solana: walk the mint to its creation tx)
// RPC: SOLANA_RPC / EVM_RPC_<chainId> or the chain's public RPC. SOLANA_SIG_RPC = separate RPC for getSignaturesForAddress (some providers have incomplete signature indexes).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname, today = new Date().toISOString().slice(0, 10);
const chains = JSON.parse(readFileSync(join(root, 'registry/chains.json'), 'utf8'));
const rpcOf = c => c.family === 'solana' ? (process.env.SOLANA_RPC || c.rpc[0]) : (process.env[`EVM_RPC_${c.id}`] || c.rpc[0]);
const call = async (url, method, params) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const j = await r.json(); if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error).slice(0, 160)}`); return j.result; };
const sleep = ms => new Promise(r => setTimeout(r, ms)), PACE = Number(process.env.FIXTURE_PACE_MS || 250);
const entries = [];
for (const c of chains) { let fs = []; try { fs = readdirSync(join(root, 'registry', c.dir)).filter(f => f.endsWith('.json')); } catch {} for (const f of fs) entries.push({ chain: c, file: join(root, 'registry', c.dir, f), e: JSON.parse(readFileSync(join(root, 'registry', c.dir, f), 'utf8')) }); }
const mintHints = Object.fromEntries(process.argv.filter(a => a.includes('=') && !a.startsWith('--')).map(a => a.split('=')));
const want = process.argv.includes('--all') ? entries : entries.filter(x => process.argv.slice(2).includes(x.e.id) || mintHints[x.e.id]);
if (!want.length) { console.error('usage: node scripts/fixtures.mjs <id>... | --all'); process.exit(1); }

const batchTx = async (url, sigs) => { // JSON-RPC batch, falls back to sequential if the RPC rejects batches
  const body = sigs.map((s, i) => ({ jsonrpc: '2.0', id: i, method: 'getTransaction', params: [s, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }] }));
  try { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (Array.isArray(j)) return j.sort((a, b) => a.id - b.id).map(x => x.result || null); } catch {}
  const out = []; for (const s of sigs) { try { out.push(await call(url, 'getTransaction', [s, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }])); } catch { out.push(null); } await sleep(150); } return out;
};
export async function findSolana(url, e, mintHint) {
  const sigUrl = process.env.SOLANA_SIG_RPC || url;
  // scan recent txs of the most specific identity (platform/partner config > program) for one that initializes a mint with decimals > 0.
  // With a mint hint (<id>=<mint>), walk that mint's history to its creation tx instead.
  const key = e.contracts.find(c => ['platform-config', 'partner-config'].includes(c.role)) || e.contracts.find(c => c.role === 'program') || e.contracts.find(c => c.role === 'deployer');
  if (!key && !mintHint) return null;
  const MAX = Number(process.env.FIXTURE_MAX_SIGS || 3000), BATCH = Number(process.env.FIXTURE_BATCH || 25);
  let before, scanned = 0, candidates = [];
  if (mintHint) { let last; for (let i = 0; i < 20; i++) { const page = await call(sigUrl, 'getSignaturesForAddress', [mintHint, { limit: 1000, before: last }]); if (!page.length) break; last = page[page.length - 1].signature; if (page.length < 1000) break; await sleep(200); } if (!last) { console.log(`  (no signature history for ${mintHint} on this RPC; try SOLANA_RPC=https://api.mainnet-beta.solana.com)`); return null; } candidates = [last]; }
  while (!mintHint && scanned < MAX) {
    const page = await call(sigUrl, 'getSignaturesForAddress', [key.address, { limit: 1000, before }]); if (!page.length) break; await sleep(Number(process.env.FIXTURE_SIG_PACE_MS || 0));
    before = page[page.length - 1].signature; scanned += page.length;
    for (let i = 0; i < page.length; i += BATCH) {
      const chunk = page.slice(i, i + BATCH).filter(x => !x.err).map(x => x.signature); if (!chunk.length) continue;
      const txs = await batchTx(url, chunk); await sleep(PACE);
      for (let k = 0; k < txs.length; k++) { const hit = pick(txs[k], chunk[k], e, key); if (hit) return hit; }
    }
    if (page.length < 1000) break;
  }
  for (const sig of candidates) { const tx = (await batchTx(url, [sig]))[0]; const hit = pick(tx, sig, e, key || { role: 'mint', address: mintHint }); if (hit) return hit; }
  return null;
  function pick(tx, signature, e, key) {
    if (!tx?.meta || tx.meta.err) return null;
    const all = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions || []).flatMap(i => i.instructions)];
    const mint = all.find(i => i.parsed && /^initializeMint2?$/.test(i.parsed.type) && i.parsed.info.decimals > 0);
    if (!mint) return null;
    const prog = e.contracts.find(c => c.role === 'program')?.address;
    if (prog && e.launch?.kind !== 'mint-only' && !all.some(i => i.programId === prog)) return null;
    if (e.token?.addressPattern && !new RegExp(e.token.addressPattern).test(mint.parsed.info.mint)) return null;
    return { tx: signature, token: mint.parsed.info.mint, creator: tx.transaction.message.accountKeys.find(k => k.signer)?.pubkey, date: new Date(tx.blockTime * 1000).toISOString().slice(0, 10), note: `found by scripts/fixtures.mjs via ${key.role} ${key.address.slice(0, 8)}` };
  }
}
export async function findEvm(url, e, chain) {
  const l = e.launch || {}; const head = Number(await call(url, 'eth_blockNumber'));
  const addrs = e.contracts.filter(c => ['factory', 'launcher', 'curve', 'router', 'program'].includes(c.role)).map(c => c.address);
  const hooks = e.contracts.filter(c => c.role === 'hook').map(c => c.address.toLowerCase());
  const pm = e.contracts.find(c => /PoolManager/i.test(c.label || ''))?.address;
  const step = Math.min(l.topic0 ? 5000 : 800, chain.maxLogRange || 5000), maxBack = Number(process.env.FIXTURE_MAX_BLOCKS || 400000);
  for (let to = head; to > head - maxBack; to -= step) {
    const range = { fromBlock: '0x' + Math.max(0, to - step + 1).toString(16), toBlock: '0x' + to.toString(16) };
    let logs = [];
    try {
      if (l.topic0 && hooks.length && pm) { logs = (await call(url, 'eth_getLogs', [{ ...range, address: pm, topics: [l.topic0] }])).filter(x => hooks.includes('0x' + x.data.slice(2 + 64 * 2 + 24, 2 + 64 * 3))); }
      else if (l.topic0 && addrs.length) logs = await call(url, 'eth_getLogs', [{ ...range, address: addrs, topics: [l.topic0] }]);
      else if (addrs.length) { // fall back: ERC-20 mint-from-zero in a tx whose tx.to is one of our launchers
        const mints = await call(url, 'eth_getLogs', [{ ...range, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', '0x' + '0'.repeat(64)] }]);
        for (const m of mints.slice(-60).reverse()) { const tx = await call(url, 'eth_getTransactionByHash', [m.transactionHash]); if (tx?.to && addrs.map(a => a.toLowerCase()).includes(tx.to.toLowerCase())) { logs = [{ ...m, _to: tx.to, _from: tx.from }]; break; } }
      }
    } catch (x) { if (/429|limit of|exceeds|too many/i.test(x.message)) { await sleep(3000); if (!/429/.test(x.message)) continue; to += step; continue; } throw x; }
    if (!logs.length) { await sleep(150); continue; }
    const log = logs[logs.length - 1], tx = await call(url, 'eth_getTransactionByHash', [log.transactionHash]);
    const tf = l.tokenField || '';
    let token = /topics\[(\d)\]/.test(tf) ? '0x' + log.topics[Number(tf.match(/topics\[(\d)\]/)[1])].slice(26) : (log.topics?.[1] && l.topic0 ? '0x' + log.topics[1].slice(26) : log.address);
    if (hooks.length && pm) { const cur = [log.topics[2], log.topics[3]].map(t => '0x' + t.slice(26)); const quotes = [...(chain.quoteTokens || []), ...(chain.ignore || [])].map(a => a.toLowerCase()); token = cur.find(c => !quotes.includes(c) && c !== '0x' + '0'.repeat(40)) || cur[1]; }
    const blk = await call(url, 'eth_getBlockByNumber', [log.blockNumber, false]);
    return { tx: log.transactionHash, token, creator: tx?.from, date: new Date(Number(blk.timestamp) * 1000).toISOString().slice(0, 10), note: `found by scripts/fixtures.mjs (${l.topic0 ? 'topic0' : 'mint-from-zero'} in blocks ${Number(range.fromBlock)}-${Number(range.toBlock)})` };
  }
  return null;
}
for (const { chain, file, e } of want) {
  const url = rpcOf(chain);
  try {
    const fx = chain.family === 'solana' ? await findSolana(url, e, mintHints[e.id]) : await findEvm(url, e, chain);
    if (!fx) { console.log(`- ${e.id}: nothing found`); continue; }
    e.fixtures = [fx, ...(e.fixtures || []).filter(x => x.tx !== fx.tx)].slice(0, 3); e.updated = today;
    writeFileSync(file, JSON.stringify(e, null, 2) + '\n');
    console.log(`+ ${e.id}: ${fx.tx.slice(0, 16)}… token ${fx.token} (${fx.date})`);
  } catch (x) { console.log(`- ${e.id}: ${x.message}`); }
}
