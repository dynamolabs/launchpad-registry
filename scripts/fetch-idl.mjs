#!/usr/bin/env node
// Snapshots the on-chain IDL of every Solana `program` contract into idl/<id>.json via idl.solana.com.
//   node scripts/fetch-idl.mjs [id ...]      (no args = all Solana entries)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadChains, loadEntries, writeJson, today, isMain } from '../lib/files.mjs';
import { sleep } from '../lib/rpc.mjs';

async function main() {
  const API = process.env.IDL_API || 'https://idl-one.vercel.app/api/idl';
  const only = new Set(process.argv.slice(2));
  mkdirSync(join(ROOT, 'idl'), { recursive: true });

  /** The API answers { idl } or { content }, sometimes JSON-encoded as a string, sometimes nested once more. */
  function unwrap(answer) {
    let idl = answer.idl ?? answer.content;
    if (typeof idl === 'string') {
      try {
        idl = JSON.parse(idl);
      } catch {
        return null;
      }
    }
    return idl?.idl ?? idl ?? null;
  }

  const solana = loadChains().find((c) => c.family === 'solana');
  for (const { file, entry } of loadEntries(solana)) {
    if (only.size && !only.has(entry.id)) continue;
    const program = entry.contracts.find((c) => c.role === 'program');
    if (!program) continue;
    try {
      const answer = await (await fetch(`${API}?programId=${program.address}`)).json();
      const idl = unwrap(answer);
      if (!idl || answer.error) {
        console.log(`- ${entry.id}: ${answer.error || 'no IDL'}`);
        continue;
      }
      const name = idl.name || idl.metadata?.name;
      const version = idl.version || idl.metadata?.version;
      writeJson(
        join(ROOT, `idl/${entry.id}.json`),
        {
          programId: program.address,
          name,
          version,
          source: answer.type,
          fetched: today(),
          via: 'https://idl.solana.com',
          idl,
        },
        1,
      );
      if (!entry.idl) {
        entry.idl = `idl/${entry.id}.json`;
        writeJson(file, entry);
      }
      console.log(
        `+ ${entry.id}: ${name}@${version} (${answer.type}, ${idl.instructions?.length ?? 0} ix)`,
      );
    } catch (err) {
      console.log(`- ${entry.id}: ${err.message}`);
    }
    await sleep(300);
  }
}

if (isMain(import.meta.url)) await main();
