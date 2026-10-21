#!/usr/bin/env node
// Validates every registry file against the schema + cross-file rules. Exit 1 on any error.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = new URL('..', import.meta.url).pathname;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const vLaunchpad = ajv.compile(JSON.parse(readFileSync(join(root, 'schema/launchpad.schema.json'), 'utf8')));
const vChain = ajv.compile(JSON.parse(readFileSync(join(root, 'schema/chain.schema.json'), 'utf8')));

const errors = [];
const err = (f, m) => errors.push(`${f}: ${m}`);
const chains = JSON.parse(readFileSync(join(root, 'registry/chains.json'), 'utf8'));
if (!Array.isArray(chains)) throw new Error('registry/chains.json must be an array');
const TAGS = JSON.parse(readFileSync(join(root, 'registry/tags.json'), 'utf8'));
const { existsSync } = await import('node:fs');
const chainByDir = new Map();
for (const c of chains) {
  if (!vChain(c)) err('registry/chains.json', ajv.errorsText(vChain.errors));
  chainByDir.set(c.dir, c);
}

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, EVM = /^0x[0-9a-fA-F]{40}$/;
const ids = new Map(), addrs = new Map(), entries = [];
for (const dir of readdirSync(join(root, 'registry'))) {
  const p = join(root, 'registry', dir);
  if (!statSync(p).isDirectory()) continue;
  const chain = chainByDir.get(dir);
  if (!chain) { err(`registry/${dir}`, 'directory has no entry in registry/chains.json'); continue; }
  for (const f of readdirSync(p).filter(x => x.endsWith('.json')).sort()) {
    const file = `registry/${dir}/${f}`;
    let e;
    try { e = JSON.parse(readFileSync(join(p, f), 'utf8')); } catch (x) { err(file, `invalid JSON: ${x.message}`); continue; }
    if (!vLaunchpad(e)) { err(file, ajv.errorsText(vLaunchpad.errors, { separator: '\n    ' })); continue; }
    if (e.id !== basename(f, '.json')) err(file, `file name must equal id "${e.id}"`);
    if (ids.has(e.id)) err(file, `duplicate id, also in ${ids.get(e.id)}`); ids.set(e.id, file);
    if (e.chain.family !== chain.family || String(e.chain.id) !== String(chain.id)) err(file, `chain ${e.chain.family}:${e.chain.id} does not match directory ${dir} (${chain.family}:${chain.id})`);
    for (const c of e.contracts) {
      const ok = chain.family === 'solana' ? B58.test(c.address) : EVM.test(c.address);
      if (!ok) err(file, `bad ${chain.family} address "${c.address}"`);
      const key = `${dir}:${chain.family === 'evm' ? c.address.toLowerCase() : c.address}`;
      if (addrs.has(key) && addrs.get(key) !== e.id && !['token', 'platform-config', 'partner-config', 'router', 'other'].includes(c.role) && !e.builtOn) err(file, `address ${c.address} already claimed by ${addrs.get(key)} (set builtOn if this is a frontend)`);
      addrs.set(key, e.id);
    }
    for (const t of e.tags || []) if (!TAGS[t]) err(file, `tag "${t}" not in registry/tags.json`);
    for (const k of ['logo', 'idl', 'abi']) if (e[k] && !existsSync(join(root, e[k]))) err(file, `${k} file ${e[k]} missing`);
    if (e.logo) { const st = statSync(join(root, e.logo)); if (st.size > 65536) err(file, `logo ${e.logo} is ${st.size} bytes (max 65536)`); }
    if (e.launch?.topic0 && chain.family !== 'evm') err(file, 'topic0 only valid on EVM');
    if (e.launch?.discriminator && chain.family !== 'solana') err(file, 'discriminator only valid on Solana');
    entries.push({ file, e });
  }
}
for (const { file, e } of entries) if (e.builtOn && !ids.has(e.builtOn)) err(file, `builtOn "${e.builtOn}" is not a registered id`);

if (errors.length) { console.error(`✖ ${errors.length} problem(s):\n` + errors.map(x => '  ' + x).join('\n')); process.exit(1); }
console.log(`✔ ${entries.length} launchpads across ${chainByDir.size} chains valid`);
