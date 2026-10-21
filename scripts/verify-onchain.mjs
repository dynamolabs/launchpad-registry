#!/usr/bin/env node
// Checks every registry address on-chain and cross-checks launch signatures.
//   node scripts/verify-onchain.mjs            → report only
//   node scripts/verify-onchain.mjs --write    → stamp contracts[].checked, fill missing topic0/discriminator
// RPC overrides: SOLANA_RPC, EVM_RPC_<chainId>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '@noble/hashes/sha256';
import { keccak_256 } from '@noble/hashes/sha3';
const root = new URL('..', import.meta.url).pathname, WRITE = process.argv.includes('--write'), today = new Date().toISOString().slice(0, 10);
const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const chains = JSON.parse(readFileSync(join(root, 'registry/chains.json'), 'utf8'));
const rpc = async (url, method, params, tries = 4) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const j = await r.json(); if (j.error) { if (tries > 0 && /429|limit/i.test(JSON.stringify(j.error))) { await sleep(2500 * (5 - tries)); return rpc(url, method, params, tries - 1); } throw new Error(`${method}: ${JSON.stringify(j.error)}`); } return j.result; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let problems = 0, checks = 0; const warn = (f, m) => { problems++; console.log(`  ✖ ${f}: ${m}`); };
const CONTRACT_ROLES = new Set(['program', 'factory', 'launcher', 'hook', 'curve', 'router', 'registry', 'token', 'other']);
for (const c of chains) {
  const dir = join(root, 'registry', c.dir);
  let files; try { files = readdirSync(dir).filter(f => f.endsWith('.json')).sort(); } catch { continue; }
  if (!files.length) continue;
  const url = c.family === 'solana' ? (process.env.SOLANA_RPC || c.rpc[0]) : (process.env[`EVM_RPC_${c.id}`] || c.rpc[0]);
  console.log(`\n${c.name} (${c.dir}) via ${url.replace(/api-key=.*|\/v2\/.*/,'…')}`);
  const entries = files.map(f => ({ f, e: JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
  // 1. existence
  if (c.family === 'solana') {
    const all = [...new Set(entries.flatMap(({ e }) => e.contracts.map(k => k.address)))];
    const info = new Map();
    for (let i = 0; i < all.length; i += 100) { const res = await rpc(url, 'getMultipleAccounts', [all.slice(i, i + 100), { encoding: 'base64' }]); res.value.forEach((v, j) => info.set(all[i + j], v)); await sleep(300); }
    for (const { f, e } of entries) for (const k of e.contracts) {
      checks++; const a = info.get(k.address);
      if (!a) { warn(f, `${k.role} ${k.address} does NOT exist on-chain`); continue; }
      if (k.role === 'program' && !a.executable) warn(f, `${k.address} is role=program but not executable (owner ${a.owner})`);
      if (['platform-config', 'partner-config'].includes(k.role) && a.executable) warn(f, `${k.address} is a config role but executable`);
      if (WRITE) k.checked = today;
    }
  } else {
    for (const { f, e } of entries) for (const k of e.contracts) {
      checks++; let code; try { code = await rpc(url, 'eth_getCode', [k.address, 'latest']); } catch (x) { warn(f, `${k.address} RPC error ${x.message}`); continue; }
      const has = code && code !== '0x';
      if (CONTRACT_ROLES.has(k.role) && !has) warn(f, `${k.role} ${k.address} has NO code`);
      if (['deployer', 'authority'].includes(k.role) && has) console.log(`  ℹ ${f}: ${k.role} ${k.address} is a contract, not an EOA`);
      if (WRITE && (has || !CONTRACT_ROLES.has(k.role))) k.checked = today;
      await sleep(120);
    }
  }
  // 2. launch signature cross-checks
  for (const { f, e } of entries) {
    const l = e.launch; if (!l) continue;
    if (c.family === 'evm' && l.signature) {
      const t = '0x' + hex(keccak_256(new TextEncoder().encode(l.signature.replace(/\s+indexed\s+/g, ' ').replace(/\s*,\s*/g, ',').replace(/\(\s+/, '(').replace(/\s+\)/, ')').replace(/ \w+(?=,|\))/g, ''))));
      if (l.topic0 && l.topic0 !== t) warn(f, `topic0 ${l.topic0} ≠ keccak(signature) ${t}`);
      else if (!l.topic0) { console.log(`  + ${f}: topic0 ${t}`); if (WRITE) l.topic0 = t; }
    }
    if (c.family === 'solana' && l.kind === 'instruction' && /^[a-z0-9_]+$/.test(l.name || '')) {
      const d = hex(sha256(new TextEncoder().encode(`global:${l.name}`)).slice(0, 8));
      if (l.discriminator && l.discriminator !== d) warn(f, `discriminator ${l.discriminator} ≠ anchor(global:${l.name}) ${d}`);
      else if (!l.discriminator) { console.log(`  + ${f}: discriminator(global:${l.name}) ${d}`); if (WRITE) l.discriminator = d; }
    }
  }
  if (WRITE) for (const { f, e } of entries) { e.updated = today; writeFileSync(join(dir, f), JSON.stringify(e, null, 2) + '\n'); }
}
console.log(`\n${checks} addresses checked, ${problems} problem(s)${WRITE ? ', files updated' : ''}`);
process.exit(problems ? 1 : 0);
