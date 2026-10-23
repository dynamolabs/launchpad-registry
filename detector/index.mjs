#!/usr/bin/env node
// Generic new-launchpad detector: flags programs / factories / hooks that mint tokens but are NOT in the registry.
//   node detector/index.mjs --chain evm-4663 --rpc https://... [--min 3] [--window 60] [--v4 0xPoolManager]
//   node detector/index.mjs --chain solana   --rpc https://... [--min 5] [--window 60] [--source blocks|metadata]
// Notify via env: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, DISCORD_WEBHOOK, WEBHOOK_URL.
// --watch [ids|all] adds the watchlist feed: launches of registered launchpads, picked per Telegram chat
// (/watch, /unwatch, /watching) or broadcast for the listed ids; TRADE_REF + BUY_BUTTONS shape the buy buttons.
// State in --state (default ./detector-state-<chain>.json). See detector/README.md.
import { readFileSync } from 'node:fs';
import { isMain } from '../lib/files.mjs';
import { splitList } from '../lib/text.mjs';
import { makeNotifier } from './notify.mjs';
import { loadRegistry } from './registry.mjs';
import { openState } from './state.mjs';
import { runEvm } from './evm.mjs';
import { runSolana } from './solana.mjs';
import { createWatch } from './watch.mjs';
import { pollCommands } from './telegram.mjs';

/** `--flag value` / `--flag` (boolean) → object. Exported for tests. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    out[argv[i].slice(2)] = next === undefined || next.startsWith('--') ? 'true' : next;
  }
  return out;
}

/** Resolves CLI flags + chain defaults into the engine config. Exported for tests. */
export function buildConfig(args, chain, env = process.env) {
  const solana = chain.family === 'solana';
  const source = args.source || 'blocks';
  const defaultPoll = solana ? (source === 'metadata' ? 8000 : 1000) : 4000;
  return {
    source,
    maxLag: Number(args.lag || 60),
    concurrency: Number(args.concurrency || 3),
    windowMin: Number(args.window || 60),
    minTokens: Number(args.min || (solana ? 5 : 3)),
    pollMs: Number(args.poll || defaultPoll),
    chunk: Math.min(Number(args.chunk || 200), chain.maxLogRange || 200),
    batch: Number(args.batch || 100),
    v4PoolManager: args.v4?.toLowerCase(),
    quoteTokens: [...(chain.quoteTokens || []), ...splitList(args.quotes)].map((a) =>
      a.toLowerCase(),
    ),
    ignore: [...(chain.ignore || []), ...splitList(args.ignore)],
    repoUrl: env.REPO_URL || 'https://github.com/dynamolabs/launchpad-registry',
    // --watch (Telegram commands only) / --watch all / --watch pump-fun,bags (broadcast to every sink)
    watch: args.watch ? (args.watch === 'true' ? [] : splitList(args.watch)) : null,
    // with --watch: poll the chain only while some chat (or --watch id) is subscribed
    scanOnDemand: args['scan-on-demand'] === 'true',
    tradeRef: env.TRADE_REF || '',
    buyButtons: splitList(env.BUY_BUTTONS),
    telegramAllow: splitList(env.TELEGRAM_ALLOW),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = new URL('..', import.meta.url);
  if (args.help || !args.chain) {
    const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8');
    console.log(readme.split('\n').slice(0, 40).join('\n'));
    process.exit(args.help ? 0 : 1);
  }
  const chains = JSON.parse(readFileSync(new URL('registry/chains.json', root), 'utf8'));
  const chain = chains.find((c) => c.dir === args.chain);
  if (!chain) {
    console.error(`unknown --chain ${args.chain}; known: ${chains.map((c) => c.dir).join(', ')}`);
    process.exit(1);
  }
  const rpcUrl = args.rpc || process.env.RPC_URL || chain.rpc?.[0];
  const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);
  const registrySrc =
    args.registry || process.env.REGISTRY_URL || new URL('dist/addresses.json', root).pathname;
  const registry = await loadRegistry(registrySrc, { log });
  const notify = makeNotifier({ log });
  const state = openState(args.state || `./detector-state-${chain.dir}.json`);
  const cfg = buildConfig(args, chain);
  log(
    `launchpad-registry detector · ${chain.name} · rpc ${rpcUrl.replace(/(api[-_]?key=)[^&]+/i, '$1…')}`,
  );
  let onLaunch;
  let standby;
  if (cfg.watch) {
    const watch = createWatch({
      chain,
      state,
      notify,
      registry,
      log,
      broadcast: cfg.watch,
      ref: cfg.tradeRef,
      apps: cfg.buyButtons,
      repoUrl: cfg.repoUrl,
    });
    onLaunch = watch.onLaunch;
    if (cfg.scanOnDemand) {
      standby = { active: () => watch.watchlist.size() > 0 || watch.broadcast.length > 0 };
    }
    // TELEGRAM_COMMANDS=0: send cards but never poll getUpdates (a second process sharing the bot token)
    const token = process.env.TELEGRAM_COMMANDS === '0' ? '' : process.env.TELEGRAM_BOT_TOKEN;
    log(
      `[watch] broadcast ${watch.broadcast.length ? watch.broadcast.join(',') : '-'}, ${watch.watchlist.size()} chats watching, ` +
        `${cfg.scanOnDemand ? 'scan on demand, ' : ''}` +
        `buy ref ${cfg.tradeRef ? 'set' : '-'}, commands ${token ? 'on' : 'off'}`,
    );
    if (token) {
      pollCommands({
        token,
        state,
        command: watch.command,
        reply: notify.telegramText,
        allow: cfg.telegramAllow,
        log,
      }).catch((err) => log(`[telegram] poller stopped: ${err.message}`));
    }
  }
  const run = chain.family === 'solana' ? runSolana : runEvm;
  await run({ chain, rpcUrl, registry, notify, state, cfg, log, onLaunch, standby });
}

// only run when executed directly (tests import parseArgs/buildConfig)
if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
