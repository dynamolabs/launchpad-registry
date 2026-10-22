# Changelog

Data follows semver (see CONTRIBUTING.md): **major** = an entry or address removed / changed, **minor** = entries or addresses added, **patch** = metadata only.

## 0.5.0 — 2026-10-22
- **Watch feed** (`detector --watch`): launches on *registered* launchpads, as token cards with buy buttons, for Telegram chats that subscribe with `/watch <id|name>` / `/unwatch` / `/watching` / `/launchpads` (per-chat lists persisted in the state file; `TELEGRAM_ALLOW` restricts who may subscribe) or broadcast to every sink for `--watch pump-fun,bags` / `--watch all`. Credits a launch to the launchpad whose program, factory, hook or partner/platform config is in the transaction, preferring a frontend (`builtOn`) over its base; shared DEX programs are never credited. Solana cards carry name/symbol from Token-2022 metadata.
- Notifier: `buttons` on an alert become a Telegram inline keyboard (`TRADE_REF`, `BUY_BUTTONS`), per-chat sends, one retry after a Telegram 429.
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
