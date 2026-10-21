#!/usr/bin/env node
// Aggregates registry/**.json into dist/ (consumers fetch these raw files).
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname, out = join(root, 'dist');
mkdirSync(join(out, 'by-chain'), { recursive: true });
const chains = JSON.parse(readFileSync(join(root, 'registry/chains.json'), 'utf8'));
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const tags = JSON.parse(readFileSync(join(root, 'registry/tags.json'), 'utf8'));
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
const meta = { version, generated: new Date().toISOString().slice(0, 10), count: all.length, chains: chains.map(c => ({ family: c.family, id: c.id, dir: c.dir, name: c.name, count: byChain[c.dir].length })) };
writeFileSync(join(out, 'launchpads.json'), JSON.stringify({ ...meta, launchpads: all }, null, 2) + '\n');
writeFileSync(join(out, 'addresses.json'), JSON.stringify({ generated: meta.generated, addresses }, null, 2) + '\n');
writeFileSync(join(out, 'chains.json'), JSON.stringify(chains, null, 2) + '\n');
writeFileSync(join(out, 'tags.json'), JSON.stringify(tags, null, 2) + '\n');
const dirOf = l => chains.find(c => c.family === l.chain.family && String(c.id) === String(l.chain.id));
writeFileSync(join(out, 'launchpads.min.json'), JSON.stringify({ ...meta, launchpads: all.map(l => ({ id: l.id, name: l.name, chain: dirOf(l).dir, caip2: dirOf(l).caip2, status: l.status, model: l.model, builtOn: l.builtOn, addresses: l.contracts.map(c => c.address) })) }) + '\n');
const csvEsc = v => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
const rows = [['id', 'name', 'chain', 'caip2', 'status', 'model', 'builtOn', 'address', 'role', 'label', 'launch_kind', 'launch_name', 'topic0', 'discriminator', 'website', 'firstSeen', 'lastActivity']];
for (const l of all) for (const c of l.contracts) rows.push([l.id, l.name, dirOf(l).dir, dirOf(l).caip2, l.status, l.model, l.builtOn, c.address, c.role, c.label, l.launch?.kind, l.launch?.name, l.launch?.topic0, l.launch?.discriminator, l.website, l.firstSeen, l.lastActivity]);
writeFileSync(join(out, 'launchpads.csv'), rows.map(r => r.map(csvEsc).join(',')).join('\n') + '\n');
for (const [dir, list] of Object.entries(byChain)) writeFileSync(join(out, 'by-chain', `${dir}.json`), JSON.stringify(list, null, 2) + '\n');
import('./site.mjs').catch(e => console.error('site:', e.message));
console.log(`built dist/: ${all.length} launchpads, ${Object.keys(addresses).length} addresses, ${chains.length} chains`);
