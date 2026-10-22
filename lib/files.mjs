// Registry file access shared by scripts and the detector.
import { readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

/** Absolute path of the repository root. */
export const ROOT = new URL('..', import.meta.url).pathname;

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** Writes pretty JSON with a trailing newline (the format every registry file uses). */
export const writeJson = (file, data, indent = 2) =>
  writeFileSync(file, JSON.stringify(data, null, indent) + '\n');

/** registry/chains.json */
export const loadChains = (root = ROOT) => readJson(join(root, 'registry/chains.json'));

/** Today as YYYY-MM-DD (UTC). */
export const today = () => new Date().toISOString().slice(0, 10);

/**
 * Every launchpad file of one chain directory.
 * @returns {{ file: string, entry: object }[]} sorted by file name; [] when the directory is absent
 */
export function loadEntries(chain, root = ROOT) {
  const dir = join(root, 'registry', chain.dir);
  let files = [];
  try {
    if (statSync(dir).isDirectory()) files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files.sort().map((f) => ({ file: join(dir, f), entry: readJson(join(dir, f)) }));
}

/** All entries of all chains, each with its chain object. */
export function loadAllEntries(root = ROOT) {
  const out = [];
  for (const chain of loadChains(root)) {
    for (const { file, entry } of loadEntries(chain, root)) out.push({ chain, file, entry });
  }
  return out;
}

/** RPC URL for a chain: env override (SOLANA_RPC / EVM_RPC_<id>) or the chain's first public RPC. */
export function rpcUrlFor(chain, env = process.env) {
  const override = chain.family === 'solana' ? env.SOLANA_RPC : env[`EVM_RPC_${chain.id}`];
  return override || chain.rpc?.[0];
}

/** Address key used by dist/addresses.json and the detector: EVM lower-cased, Solana exact. */
export const addressKey = (chain, address) =>
  `${chain.dir}:${chain.family === 'evm' ? String(address).toLowerCase() : String(address)}`;

/**
 * true when the module at `importMetaUrl` is the script node was started with,
 * so importing a CLI module from a test stays side-effect free.
 * Under pm2 (fork mode) argv[1] is pm2's own container script, so its `pm_exec_path` env is checked too.
 */
export function isMain(importMetaUrl, { argv = process.argv, env = process.env } = {}) {
  for (const candidate of [argv[1], env.pm_exec_path]) {
    if (!candidate) continue;
    try {
      if (pathToFileURL(realpathSync(candidate)).href === importMetaUrl) return true;
    } catch {
      // not a path we can resolve
    }
  }
  return false;
}
