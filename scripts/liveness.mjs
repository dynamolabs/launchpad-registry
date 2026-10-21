#!/usr/bin/env node
// Weekly liveness: finds the most recent activity of each launchpad, stamps `lastActivity`, flips status active↔inactive after 30 quiet days.
//   node scripts/liveness.mjs [--write] [--days 30]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname, WRITE = process.argv.includes('--write'), QUIET_DAYS = Number(process.argv[process.argv.indexOf('--days') + 1] || 30);
const chains = JSON.parse(readFileSync(join(root, 'registry/chains.json'), 'utf8'));
const call = async (url, method, params) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const j = await r.json(); if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error).slice(0, 120)}`); return j.result; };
const sleep = ms => new Promise(r => setTimeout(r, ms)), day = 864e5, today = new Date().toISOString().slice(0, 10);
let changed = 0;
for (const c of chains) {
  const url = c.family === 'solana' ? (process.env.SOLANA_RPC || c.rpc[0]) : (process.env[`EVM_RPC_${c.id}`] || c.rpc[0]);
  let files = []; try { files = readdirSync(join(root, 'registry', c.dir)).filter(f => f.endsWith('.json')); } catch {}
  let head, blockMs;
  if (c.family === 'evm' && files.length) { head = Number(await call(url, 'eth_blockNumber')); const b1 = await call(url, 'eth_getBlockByNumber', ['0x' + head.toString(16), false]), b0 = await call(url, 'eth_getBlockByNumber', ['0x' + (head - 10000).toString(16), false]); blockMs = (Number(b1.timestamp) - Number(b0.timestamp)) * 1000 / 10000; }
  for (const f of files) {
    const file = join(root, c.dir ? `registry/${c.dir}/${f}` : f), e = JSON.parse(readFileSync(file, 'utf8'));
    const keys = e.contracts.filter(k => ['program', 'factory', 'launcher', 'curve', 'hook', 'platform-config', 'partner-config', 'deployer'].includes(k.role));
    let last = null;
    try {
      if (c.family === 'solana') {
        for (const k of keys.slice(0, 3)) { const s = await call(url, 'getSignaturesForAddress', [k.address, { limit: 1 }]); if (s[0]?.blockTime) last = Math.max(last || 0, s[0].blockTime * 1000); await sleep(200); }
      } else {
        // scan back up to QUIET_DAYS in chunks of ~1 day, stop at first log touching any key address (as emitter or in a tx to it is too costly → emitter only; hooks via PoolManager data)
        const perDay = Math.round(day / blockMs), chunk = Math.min(perDay, c.maxLogRange || 50000);
        const addrs = keys.filter(k => k.role !== 'hook' && k.role !== 'deployer').map(k => k.address);
        const hooks = keys.filter(k => k.role === 'hook').map(k => k.address.toLowerCase()), pm = e.contracts.find(k => /PoolManager/i.test(k.label || ''))?.address;
        outer: for (let to = head; to > head - perDay * QUIET_DAYS; to -= chunk) {
          const range = { fromBlock: '0x' + Math.max(0, to - chunk + 1).toString(16), toBlock: '0x' + to.toString(16) };
          let logs = [];
          try { if (addrs.length) logs = await call(url, 'eth_getLogs', [{ ...range, address: addrs }]); if (!logs.length && hooks.length && pm) logs = (await call(url, 'eth_getLogs', [{ ...range, address: pm, topics: [e.launch?.topic0].filter(Boolean) }])).filter(x => hooks.includes('0x' + x.data.slice(2 + 64 * 2 + 24, 2 + 64 * 3))); }
          catch (x) { if (/429/.test(x.message)) { await sleep(2500); to += chunk; continue; } throw x; }
          if (logs.length) { const b = await call(url, 'eth_getBlockByNumber', [logs[logs.length - 1].blockNumber, false]); last = Number(b.timestamp) * 1000; break outer; }
          await sleep(120);
        }
      }
    } catch (x) { console.log(`! ${e.id}: ${x.message}`); continue; }
    const lastDate = last ? new Date(last).toISOString().slice(0, 10) : null;
    const quiet = last ? (Date.now() - last) / day : null;
    let status = e.status;
    if (quiet !== null && quiet > QUIET_DAYS && e.status === 'active') status = 'inactive';
    if (quiet !== null && quiet <= QUIET_DAYS && ['inactive', 'unknown'].includes(e.status)) status = 'active';
    const line = `${e.id.padEnd(22)} last ${lastDate || 'none in window'}${quiet !== null ? ` (${quiet.toFixed(0)} d ago)` : ''}${status !== e.status ? `  ${e.status} → ${status}` : ''}`;
    console.log(line);
    if (WRITE && (lastDate !== e.lastActivity || status !== e.status)) { if (lastDate) e.lastActivity = lastDate; e.status = status; e.updated = today; writeFileSync(file, JSON.stringify(e, null, 2) + '\n'); changed++; }
  }
}
console.log(WRITE ? `${changed} file(s) updated` : 'dry run (use --write)');
