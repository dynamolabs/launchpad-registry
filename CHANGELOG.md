# Changelog

Data follows semver (see CONTRIBUTING.md): **major** = an entry or address removed / changed, **minor** = entries or addresses added, **patch** = metadata only.

## 0.6.0 — 2026-10-23
- **Added** BNB Smart Chain (`evm-56`, chain entry with PancakeSwap factories/routers ignored, WBNB/USDT/USDC quotes, 1 500-block log range for public RPCs) with two launchpads: **four.meme** (TokenManager2, `TokenCreate` event verified on-chain, dominant BNB launchpad) and **Gang** (gang.fun, agent-only bonding curve: buys require the Binance Agentic Wallet Agent ID, a soulbound SPACE ID `.ai` NFT, listed as the gate contract). 32 launchpads on 5 chains.
- `scripts/fixtures.mjs` reads the token from a log data word when `launch.tokenField` is `data[N]` (events whose token is not indexed).
- Detector: `TELEGRAM_COMMANDS=0` sends cards without polling `getUpdates`, so a second detector process (another chain) can share one bot token.

## 0.5.1 — 2026-10-22
- `--scan-on-demand` (with `--watch`): the chain is not polled while nobody is subscribed and resumes at the tip when someone is. Solana block scanning costs ~70 % of a core; a hosted watch bot with an empty list was starving the other processes on the same box.
- `/watch` also matches a launchpad's website domain (`/watch pangea.trade`), suggestions are looser, and an unknown name answers with a pre-filled "add to registry" issue link and is counted in `state.watch.requests`.

## 0.5.0 — 2026-10-22
- **Watch feed** (`detector --watch`): launches on *registered* launchpads, as token cards with buy buttons, for Telegram chats that subscribe with `/watch <id|name>` / `/unwatch` / `/watching` / `/launchpads` (per-chat lists persisted in the state file; `TELEGRAM_ALLOW` restricts who may subscribe) or broadcast to every sink for `--watch pump-fun,bags` / `--watch all`. Credits a launch to the launchpad whose program, factory or hook runs in the transaction or whose partner/platform config is among its accounts, preferring a frontend (`builtOn`) over its base; shared DEX programs and other roles (fee wallets…) never credit. Solana cards carry name/symbol from Token-2022 metadata or the Metaplex create-metadata instruction. Sends are queued (the chain cursor never waits for Telegram), chats that blocked the bot are unsubscribed, queued updates from before the first start are skipped, `--watch` names are resolved and unknown ones reported.
- Notifier: `buttons` on an alert become a Telegram inline keyboard (`TRADE_REF`, `BUY_BUTTONS`), per-chat sends with a status result, one retry after a Telegram 429.
- Fixed: a launchpad appearing both as outer program and as CPI target of one transaction counted the birth twice toward the alert threshold.
- Fixed: under pm2 (`pm2 start detector/index.mjs …`, the documented recipe) the detector loaded and then did nothing, because pm2's fork container is `argv[1]`; `isMain` now also honours pm2's `pm_exec_path`.
- Release assets now include `dist/trade-links.json`; `npm test` runs `node --test` without a directory argument (Node 22 stopped recursing into `test/`).

## 0.4.0 — 2026-10-22
- **Trade links**: `registry/trade-links.json` (+ `schema/trade-link.schema.json`, `dist/trade-links.json`) lists the trading bots and terminals that alert bots put under a token card, with their deep-link templates and a verification level (production / docs / community) and sources: Trojan, BONKbot, GMGN (Telegram + web), Maestro, Banana Gun, SolTradingBot, Unibot, Bloom, Based, Blazing Sol, Axiom, Photon, BullX, DEX Screener.
- Library: `tradeLinks` and `buyLinks({ chain, token, ref, pool })` fill the templates for one token and skip apps whose inputs are missing; types in `index.d.ts`.
- Brand assets in `brand/` (mark, wordmark, lockups), used by the README and the site.
- Release workflow publishes through npm trusted publishing; Dependabot skips major npm bumps.

## 0.3.0 — 2026-10-22
- **Code rewrite for contributors**: shared `lib/` (JSON-RPC client with pacing + 429/-32005 backoff, hashing, file helpers), detector split into pure helpers + `tracker.mjs` + thin loops, every script reformatted (Prettier/ESLint, 100 columns) and runnable only as a CLI (`isMain`), so modules import cleanly in tests.
- **Tests 8 → 58**, all offline: detector engines run against recorded RPC answers (`test/fixtures/`: pump.fun, LaunchLab, Clanker, Doppler on Robinhood Chain), tracker window/threshold rules, state persistence, notifier fan-out, CLI config, RPC retry/pacing.
- **Fixed** detector state growth: `seen` capped (20 000), idle entrypoints pruned; MCP server now reports the dataset version (was `0.0.0`); V4 hook pools name the currency minted in the same tx as the launched token (was: first non-quote currency).
- **Fixed data**: `doppler-robinhood` fixtures pointed at the numeraire (SPCX / VIRTUAL) instead of the launched token.
- `meta.version` exported from the library; `index.d.ts` covers `fixtures`, `externalIds`, `idl`, `abi`, `logo`, `lastActivity`, chain `caip2`/`ignore`/`quoteTokens`/`maxLogRange`.
- CI runs lint + tests; new npm scripts `lint`, `format`, `fixtures`, `liveness`.
- **Solana detector rewritten around block scanning** (`--source blocks`, default): a 5-minute dry run of the Metaplex-signature source saw 3 launches and zero pump.fun, because Token-2022 metadata-extension mints never touch Metaplex. Block scanning (`getBlock` jsonParsed, tx version 1) saw 6 pump.fun launches in 40 blocks. The old source remains as `--source metadata`. Births whose tx CPIs into a registered launchpad are credited to it, so pump.fun bundler programs are not flagged as new launchpads. Blocks are fetched in parallel (`--concurrency`, default 3; JSON-RPC client gained a concurrency semaphore): coverage on publicnode rose from ~45 % to ~83 % of slots. Solana `ignore` list in `registry/chains.json` for DEX programs whose pool creation mints LP tokens (Raydium, Meteora, Orca, PumpSwap).
- **Post-review fixes** (independent code review of the rewrite): tokens and signatures are marked seen only after they are fully processed, so an RPC failure mid-range is retried instead of silently dropping launches (Solana cursor now advances per processed signature); V4 pools are deduplicated per tx+hook on retries; v0.2 state keys (`to:`/`prog:`) are migrated so already-alerted launchpads do not alert again after upgrading; pruning is persisted; `isRateLimit` no longer treats "result set too large" or any string containing 429 as a rate limit; `fixtures.mjs` retries rate limits at most 5 times and skips oversized ranges instead of looping forever, and resolves V4 hook tokens with the same receipt-based rule as the detector; `liveness.mjs --days` without a value falls back to 30; every script is side-effect free on import (`isMain` guard), covered by a test; registry tests use `lib/hash.mjs` instead of a private copy.

## 0.2.0 — 2026-10-21
- **Added** Solana: Moonshot/Moonit (legacy program **and** its current Meteora DBC config, USDC quote), Bags (DBC config), Boop.fun, Heaven, Jupiter Studio (DBC partner). Injective: RunUp token factory address.
- `externalIds.geckoterminal` dex ids for every Solana launchpad GeckoTerminal lists (pump-fun, raydium-launchlab, letsbonk-fun, meteora-dbc, moonit, moonshot, boop-fun, heaven, bags-fm).
- Every address re-verified on-chain; `checked` stamps; Anchor discriminators for pump.fun `create`, LaunchLab `initialize`, DBC `initialize_virtual_pool_*`, Boop `create_token`.
- Real launch `fixtures` per entry (`scripts/fixtures.mjs`), IDL snapshots in `idl/` (`scripts/fetch-idl.mjs`), logos in `icons/`, `externalIds` aliases, CAIP-2 ids, `registry/tags.json` dictionary.
- New outputs: `launchpads.min.json`, `launchpads.csv`, `tags.json`; `version` in every dist file.
- Weekly liveness job (`scripts/liveness.mjs` + Action) → `lastActivity`, auto status flips via PR.
- MCP server (`mcp/`), `llms.txt`, agent skill `skills/add-launchpad`, PR check comment bot, release workflow (tag → npm + GitHub release), CODEOWNERS, SECURITY.md, Dependabot.
- Data relicensed CC0 (`LICENSE-DATA`); code stays MIT.

## 0.1.0 — 2026-10-21
- Initial release: 25 launchpads on Solana, Robinhood Chain (4663) and Injective EVM (1776), all addresses verified on-chain.
- Schema, validator, `dist/` outputs, npm package with TypeScript types, generic detector (Solana + EVM), GitHub Pages site.
