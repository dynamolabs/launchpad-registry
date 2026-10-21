#!/usr/bin/env node
// Generic new-launchpad detector. Flags programs / factories / hooks that mint tokens but are NOT in the registry.
//   node detector/index.mjs --chain evm-4663 --rpc https://... [--min 3] [--window 60] [--v4 0xPoolManager]
//   node detector/index.mjs --chain solana   --rpc https://... [--min 5] [--window 60]
// Notify via env: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, DISCORD_WEBHOOK, WEBHOOK_URL. State in --state (default ./detector-state-<chain>.json).
import { readFileSync } from 'node:fs';
import { makeNotifier } from './notify.mjs';
import { loadRegistry } from './registry.mjs';
import { openState } from './state.mjs';
import { runEvm } from './evm.mjs';
import { runSolana } from './solana.mjs';
const args = Object.fromEntries(process.argv.slice(2).map((a, i, v) => a.startsWith('--') ? [a.slice(2), v[i + 1]?.startsWith('--') || v[i + 1] === undefined ? 'true' : v[i + 1]] : []).filter(x => x.length));
if (args.help || !args.chain) { console.log(readFileSync(new URL('./README.md', import.meta.url), 'utf8').split('\n').slice(0, 40).join('\n')); process.exit(args.help ? 0 : 1); }
const root = new URL('..', import.meta.url);
const chains = JSON.parse(readFileSync(new URL('registry/chains.json', root), 'utf8'));
const chain = chains.find(c => c.dir === args.chain) || (() => { console.error(`unknown --chain ${args.chain}; known: ${chains.map(c => c.dir).join(', ')}`); process.exit(1); })();
const rpcUrl = args.rpc || process.env.RPC_URL || chain.rpc?.[0];
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);
const registry = await loadRegistry(args.registry || process.env.REGISTRY_URL || new URL('dist/addresses.json', root).pathname, { log });
const notify = makeNotifier({ log });
const state = openState(args.state || `./detector-state-${chain.dir}.json`);
const cfg = {
  windowMin: Number(args.window || 60), minTokens: Number(args.min || (chain.family === 'solana' ? 5 : 3)), pollMs: Number(args.poll || (chain.family === 'solana' ? 8000 : 4000)),
  chunk: Math.min(Number(args.chunk || 200), chain.maxLogRange || 200), batch: Number(args.batch || 100), v4PoolManager: args.v4?.toLowerCase(), quoteTokens: [...(chain.quoteTokens || []), ...(args.quotes || '').split(',')].map(a => a.toLowerCase()).filter(Boolean),
  ignore: [...(chain.ignore || []), ...(args.ignore || '').split(',').filter(Boolean)], repoUrl: process.env.REPO_URL || 'https://github.com/OWNER/launchpad-registry',
};
log(`launchpad-registry detector · ${chain.name} · rpc ${rpcUrl.replace(/(api[-_]?key=)[^&]+/i, '$1…')}`);
await (chain.family === 'solana' ? runSolana : runEvm)({ chain, rpcUrl, registry, notify, state, cfg, log });
