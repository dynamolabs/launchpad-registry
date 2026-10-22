#!/usr/bin/env node
// Checks every registry address on-chain and cross-checks launch signatures.
//   node scripts/verify-onchain.mjs            → report only
//   node scripts/verify-onchain.mjs --write    → stamp contracts[].checked, fill missing topic0 / discriminator
// RPC overrides: SOLANA_RPC, EVM_RPC_<chainId>
import { loadChains, loadEntries, rpcUrlFor, writeJson, today, isMain } from '../lib/files.mjs';
import { makeRpc, sleep } from '../lib/rpc.mjs';
import { anchorDiscriminator, topic0 } from '../lib/hash.mjs';

async function main() {
  const WRITE = process.argv.includes('--write');
  /** roles that must have code on EVM */
  const CONTRACT_ROLES = new Set([
    'program',
    'factory',
    'launcher',
    'hook',
    'curve',
    'router',
    'registry',
    'token',
    'other',
  ]);
  const CONFIG_ROLES = new Set(['platform-config', 'partner-config']);
  const EOA_ROLES = new Set(['deployer', 'authority']);

  let problems = 0;
  let checks = 0;
  const warn = (file, message) => {
    problems++;
    console.log(`  ✖ ${file}: ${message}`);
  };
  const stamp = today();

  async function verifySolana(rpc, entries) {
    const all = [...new Set(entries.flatMap(({ entry }) => entry.contracts.map((c) => c.address)))];
    const info = new Map();
    for (let i = 0; i < all.length; i += 100) {
      const slice = all.slice(i, i + 100);
      const res = await rpc('getMultipleAccounts', [slice, { encoding: 'base64' }]);
      res.value.forEach((account, j) => info.set(slice[j], account));
      await sleep(300);
    }
    for (const { name, entry } of entries) {
      for (const contract of entry.contracts) {
        checks++;
        const account = info.get(contract.address);
        if (!account) {
          warn(name, `${contract.role} ${contract.address} does NOT exist on-chain`);
          continue;
        }
        if (contract.role === 'program' && !account.executable) {
          warn(
            name,
            `${contract.address} is role=program but not executable (owner ${account.owner})`,
          );
        }
        if (CONFIG_ROLES.has(contract.role) && account.executable) {
          warn(name, `${contract.address} is a config role but executable`);
        }
        if (WRITE) contract.checked = stamp;
      }
    }
  }

  async function verifyEvm(rpc, entries) {
    for (const { name, entry } of entries) {
      for (const contract of entry.contracts) {
        checks++;
        let code;
        try {
          code = await rpc('eth_getCode', [contract.address, 'latest']);
        } catch (err) {
          warn(name, `${contract.address} RPC error ${err.message}`);
          continue;
        }
        const hasCode = Boolean(code && code !== '0x');
        if (CONTRACT_ROLES.has(contract.role) && !hasCode)
          warn(name, `${contract.role} ${contract.address} has NO code`);
        if (EOA_ROLES.has(contract.role) && hasCode) {
          console.log(
            `  ℹ ${name}: ${contract.role} ${contract.address} is a contract, not an EOA`,
          );
        }
        if (WRITE && (hasCode || !CONTRACT_ROLES.has(contract.role))) contract.checked = stamp;
        await sleep(120);
      }
    }
  }

  /** topic0 must equal keccak(signature); Anchor discriminators must equal sha256("global:<name>")[:8]. */
  function verifyLaunchSignatures(chain, { name, entry }) {
    const launch = entry.launch;
    if (!launch) return;
    if (chain.family === 'evm' && launch.signature) {
      const expected = topic0(launch.signature);
      if (launch.topic0 && launch.topic0 !== expected)
        warn(name, `topic0 ${launch.topic0} ≠ keccak(signature) ${expected}`);
      else if (!launch.topic0) {
        console.log(`  + ${name}: topic0 ${expected}`);
        if (WRITE) launch.topic0 = expected;
      }
    }
    if (
      chain.family === 'solana' &&
      launch.kind === 'instruction' &&
      /^[a-z0-9_]+$/.test(launch.name || '')
    ) {
      const expected = anchorDiscriminator(launch.name);
      if (launch.discriminator && launch.discriminator !== expected) {
        warn(
          name,
          `discriminator ${launch.discriminator} ≠ anchor(global:${launch.name}) ${expected}`,
        );
      } else if (!launch.discriminator) {
        console.log(`  + ${name}: discriminator(global:${launch.name}) ${expected}`);
        if (WRITE) launch.discriminator = expected;
      }
    }
  }

  for (const chain of loadChains()) {
    const entries = loadEntries(chain).map((x) => ({ ...x, name: x.file.split('/').pop() }));
    if (!entries.length) continue;
    const url = rpcUrlFor(chain);
    console.log(`\n${chain.name} (${chain.dir}) via ${url.replace(/api-key=.*|\/v2\/.*/, '…')}`);
    const rpc = makeRpc(url, { minIntervalMs: 50 });
    if (chain.family === 'solana') await verifySolana(rpc, entries);
    else await verifyEvm(rpc, entries);
    for (const item of entries) verifyLaunchSignatures(chain, item);
    if (WRITE) {
      for (const { file, entry } of entries) {
        entry.updated = stamp;
        writeJson(file, entry);
      }
    }
  }

  console.log(
    `\n${checks} addresses checked, ${problems} problem(s)${WRITE ? ', files updated' : ''}`,
  );
  process.exit(problems ? 1 : 0);
}

if (isMain(import.meta.url)) await main();
