#!/usr/bin/env node
// Snapshots the on-chain IDL of every Solana `program` contract into idl/<id>.json via idl.solana.com (PMP first, Anchor fallback).
//   node scripts/fetch-idl.mjs [id ...]      (no args = all Solana entries)
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname, API = process.env.IDL_API || 'https://idl-one.vercel.app/api/idl';
mkdirSync(join(root, 'idl'), { recursive: true });
const only = new Set(process.argv.slice(2));
for (const f of readdirSync(join(root, 'registry/solana')).filter(f => f.endsWith('.json'))) {
  const file = join(root, 'registry/solana', f), e = JSON.parse(readFileSync(file, 'utf8'));
  if (only.size && !only.has(e.id)) continue;
  const prog = e.contracts.find(c => c.role === 'program'); if (!prog) continue;
  try {
    const r = await fetch(`${API}?programId=${prog.address}`); const d = await r.json();
    let c = d.idl ?? d.content; if (typeof c === 'string') { try { c = JSON.parse(c); } catch {} } if (c?.idl) c = c.idl;
    if (!c || d.error) { console.log(`- ${e.id}: ${d.error || 'no IDL'}`); continue; }
    const name = c.name || c.metadata?.name, version = c.version || c.metadata?.version;
    writeFileSync(join(root, `idl/${e.id}.json`), JSON.stringify({ programId: prog.address, name, version, source: d.type, fetched: new Date().toISOString().slice(0, 10), via: 'https://idl.solana.com', idl: c }, null, 1) + '\n');
    if (!e.idl) { e.idl = `idl/${e.id}.json`; writeFileSync(file, JSON.stringify(e, null, 2) + '\n'); }
    console.log(`+ ${e.id}: ${name}@${version} (${d.type}, ${c.instructions?.length ?? 0} ix)`);
  } catch (x) { console.log(`- ${e.id}: ${x.message}`); }
  await new Promise(r => setTimeout(r, 300));
}
