#!/usr/bin/env node
// Aggregates registry/**.json into dist/ (consumers fetch these raw files).
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname, out = join(root, 'dist');
mkdirSync(join(out, 'by-chain'), { recursive: true });
const chains = JSON.parse(readFileSync(join(root, 'registry/chains.json'), 'utf8'));
const all = [], byChain = {}, addresses = {};
for (const c of chains) {
  const p = join(root, 'registry', c.dir);
  let list = [];
  try { if (statSync(p).isDirectory()) list = readdirSync(p).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(readFileSync(join(p, f), 'utf8'))); } catch {}
  byChain[c.dir] = list; all.push(...list);
  for (const e of list) for (const k of e.contracts) {
    const a = c.family === 'evm' ? k.address.toLowerCase() : k.address;
    (addresses[`${c.dir}:${a}`] ??= []).push({ id: e.id, role: k.role, label: k.label });
  }
}
const meta = { generated: new Date().toISOString().slice(0, 10), count: all.length, chains: chains.map(c => ({ family: c.family, id: c.id, dir: c.dir, name: c.name, count: byChain[c.dir].length })) };
writeFileSync(join(out, 'launchpads.json'), JSON.stringify({ ...meta, launchpads: all }, null, 2) + '\n');
writeFileSync(join(out, 'addresses.json'), JSON.stringify({ generated: meta.generated, addresses }, null, 2) + '\n');
writeFileSync(join(out, 'chains.json'), JSON.stringify(chains, null, 2) + '\n');
for (const [dir, list] of Object.entries(byChain)) writeFileSync(join(out, 'by-chain', `${dir}.json`), JSON.stringify(list, null, 2) + '\n');
import('./site.mjs').catch(e => console.error('site:', e.message));
console.log(`built dist/: ${all.length} launchpads, ${Object.keys(addresses).length} addresses, ${chains.length} chains`);
