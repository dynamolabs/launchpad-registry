#!/usr/bin/env node
// Validates every registry file against the schema plus cross-file rules. Exit 1 on any error.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ROOT, readJson, isMain } from '../lib/files.mjs';

async function main() {
  const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
  const MAX_LOGO_BYTES = 65536;
  /** roles that several entries may legitimately share (quote tokens, shared DEX programs, multi-tenant configs) */
  const SHARED_ROLES = new Set(['token', 'platform-config', 'partner-config', 'router', 'other']);

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validateLaunchpad = ajv.compile(readJson(join(ROOT, 'schema/launchpad.schema.json')));
  const validateChain = ajv.compile(readJson(join(ROOT, 'schema/chain.schema.json')));
  const validateTradeLink = ajv.compile(readJson(join(ROOT, 'schema/trade-link.schema.json')));

  const errors = [];
  const fail = (file, message) => errors.push(`${file}: ${message}`);

  const chains = readJson(join(ROOT, 'registry/chains.json'));
  if (!Array.isArray(chains)) throw new Error('registry/chains.json must be an array');
  const tags = readJson(join(ROOT, 'registry/tags.json'));
  const chainByDir = new Map();
  for (const chain of chains) {
    if (!validateChain(chain)) fail('registry/chains.json', ajv.errorsText(validateChain.errors));
    chainByDir.set(chain.dir, chain);
  }

  const tradeLinks = readJson(join(ROOT, 'registry/trade-links.json'));
  if (!Array.isArray(tradeLinks)) throw new Error('registry/trade-links.json must be an array');
  const linkIds = new Set();
  for (const app of tradeLinks) {
    const file = `registry/trade-links.json#${app.id}`;
    if (!validateTradeLink(app)) fail(file, ajv.errorsText(validateTradeLink.errors));
    if (linkIds.has(app.id)) fail(file, 'duplicate id');
    linkIds.add(app.id);
    for (const dir of app.chains || [])
      if (!chainByDir.has(dir)) fail(file, `chain "${dir}" not in registry/chains.json`);
    for (const [key, tpl] of Object.entries(app.links || {})) {
      if (!tpl) continue;
      const unknown = tpl.replace(/\{(token|ref|pool|dexscreenerId)\}/g, '').match(/[{}]/);
      if (unknown) fail(file, `links.${key}: unknown placeholder in ${tpl}`);
      if (key === 'referral' && !tpl.includes('{ref}'))
        fail(file, 'links.referral must contain {ref}');
      if (key === 'tokenNoRef' && tpl.includes('{ref}'))
        fail(file, 'links.tokenNoRef must not contain {ref}');
    }
  }

  const ids = new Map(); // id → file
  const claimed = new Map(); // "dir:address" → id
  const entries = [];

  function checkEntry(file, entry, chain, dir) {
    if (entry.id !== basename(file, '.json')) fail(file, `file name must equal id "${entry.id}"`);
    if (ids.has(entry.id)) fail(file, `duplicate id, also in ${ids.get(entry.id)}`);
    ids.set(entry.id, file);

    if (entry.chain.family !== chain.family || String(entry.chain.id) !== String(chain.id)) {
      fail(
        file,
        `chain ${entry.chain.family}:${entry.chain.id} does not match directory ${dir} (${chain.family}:${chain.id})`,
      );
    }

    for (const contract of entry.contracts) {
      const pattern = chain.family === 'solana' ? BASE58 : EVM_ADDRESS;
      if (!pattern.test(contract.address))
        fail(file, `bad ${chain.family} address "${contract.address}"`);
      const key = `${dir}:${chain.family === 'evm' ? contract.address.toLowerCase() : contract.address}`;
      const owner = claimed.get(key);
      if (owner && owner !== entry.id && !SHARED_ROLES.has(contract.role) && !entry.builtOn) {
        fail(
          file,
          `address ${contract.address} already claimed by ${owner} (set builtOn if this is a frontend)`,
        );
      }
      claimed.set(key, entry.id);
    }

    for (const tag of entry.tags || [])
      if (!tags[tag]) fail(file, `tag "${tag}" not in registry/tags.json`);

    for (const field of ['logo', 'idl', 'abi']) {
      if (entry[field] && !existsSync(join(ROOT, entry[field])))
        fail(file, `${field} file ${entry[field]} missing`);
    }
    if (entry.logo && existsSync(join(ROOT, entry.logo))) {
      const size = statSync(join(ROOT, entry.logo)).size;
      if (size > MAX_LOGO_BYTES)
        fail(file, `logo ${entry.logo} is ${size} bytes (max ${MAX_LOGO_BYTES})`);
    }

    if (entry.launch?.topic0 && chain.family !== 'evm') fail(file, 'topic0 only valid on EVM');
    if (entry.launch?.discriminator && chain.family !== 'solana')
      fail(file, 'discriminator only valid on Solana');
  }

  for (const dir of readdirSync(join(ROOT, 'registry'))) {
    const dirPath = join(ROOT, 'registry', dir);
    if (!statSync(dirPath).isDirectory()) continue;
    const chain = chainByDir.get(dir);
    if (!chain) {
      fail(`registry/${dir}`, 'directory has no entry in registry/chains.json');
      continue;
    }
    for (const name of readdirSync(dirPath)
      .filter((f) => f.endsWith('.json'))
      .sort()) {
      const file = `registry/${dir}/${name}`;
      let entry;
      try {
        entry = JSON.parse(readFileSync(join(dirPath, name), 'utf8'));
      } catch (err) {
        fail(file, `invalid JSON: ${err.message}`);
        continue;
      }
      if (!validateLaunchpad(entry)) {
        fail(file, ajv.errorsText(validateLaunchpad.errors, { separator: '\n    ' }));
        continue;
      }
      checkEntry(file, entry, chain, dir);
      entries.push({ file, entry });
    }
  }

  for (const { file, entry } of entries) {
    if (entry.builtOn && !ids.has(entry.builtOn))
      fail(file, `builtOn "${entry.builtOn}" is not a registered id`);
  }

  if (errors.length) {
    console.error(`✖ ${errors.length} problem(s):\n` + errors.map((e) => '  ' + e).join('\n'));
    process.exit(1);
  }
  console.log(`✔ ${entries.length} launchpads across ${chainByDir.size} chains valid`);
}

if (isMain(import.meta.url)) await main();
