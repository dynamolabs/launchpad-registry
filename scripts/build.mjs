#!/usr/bin/env node
// Aggregates registry/**.json into dist/ (the files consumers fetch), then renders docs/index.html.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT,
  readJson,
  writeJson,
  loadChains,
  loadEntries,
  addressKey,
  today,
  isMain,
} from '../lib/files.mjs';
import { renderSite } from './site.mjs';

async function main() {
  const out = join(ROOT, 'dist');
  mkdirSync(join(out, 'by-chain'), { recursive: true });

  const chains = loadChains();
  const version = readJson(join(ROOT, 'package.json')).version;
  const tags = readJson(join(ROOT, 'registry/tags.json'));

  const all = [];
  const byChain = {};
  const addresses = {};
  for (const chain of chains) {
    const list = loadEntries(chain).map((x) => x.entry);
    byChain[chain.dir] = list;
    all.push(...list);
    for (const entry of list) {
      for (const contract of entry.contracts) {
        const key = addressKey(chain, contract.address);
        (addresses[key] ??= []).push({ id: entry.id, role: contract.role, label: contract.label });
      }
    }
  }

  const chainOf = (entry) =>
    chains.find((c) => c.family === entry.chain.family && String(c.id) === String(entry.chain.id));

  const meta = {
    version,
    generated: today(),
    count: all.length,
    chains: chains.map((c) => ({
      family: c.family,
      id: c.id,
      dir: c.dir,
      name: c.name,
      count: byChain[c.dir].length,
    })),
  };

  writeJson(join(out, 'launchpads.json'), { ...meta, launchpads: all });
  writeJson(join(out, 'addresses.json'), { generated: meta.generated, addresses });
  writeJson(join(out, 'chains.json'), chains);
  writeJson(join(out, 'tags.json'), tags);
  for (const [dir, list] of Object.entries(byChain))
    writeJson(join(out, 'by-chain', `${dir}.json`), list);

  const slim = all.map((l) => ({
    id: l.id,
    name: l.name,
    chain: chainOf(l).dir,
    caip2: chainOf(l).caip2,
    status: l.status,
    model: l.model,
    builtOn: l.builtOn,
    addresses: l.contracts.map((c) => c.address),
  }));
  writeFileSync(
    join(out, 'launchpads.min.json'),
    JSON.stringify({ ...meta, launchpads: slim }) + '\n',
  );

  const csvCell = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    'id',
    'name',
    'chain',
    'caip2',
    'status',
    'model',
    'builtOn',
    'address',
    'role',
    'label',
    'launch_kind',
    'launch_name',
    'topic0',
    'discriminator',
    'website',
    'firstSeen',
    'lastActivity',
  ];
  const rows = [header];
  for (const l of all) {
    for (const c of l.contracts) {
      rows.push([
        l.id,
        l.name,
        chainOf(l).dir,
        chainOf(l).caip2,
        l.status,
        l.model,
        l.builtOn,
        c.address,
        c.role,
        c.label,
        l.launch?.kind,
        l.launch?.name,
        l.launch?.topic0,
        l.launch?.discriminator,
        l.website,
        l.firstSeen,
        l.lastActivity,
      ]);
    }
  }
  writeFileSync(
    join(out, 'launchpads.csv'),
    rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n',
  );

  try {
    renderSite();
  } catch (err) {
    console.error('site:', err.message);
  }
  console.log(
    `built dist/: ${all.length} launchpads, ${Object.keys(addresses).length} addresses, ${chains.length} chains`,
  );
}

if (isMain(import.meta.url)) await main();
