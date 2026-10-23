# detector

Finds launchpads that are **not in the registry yet**: any program (Solana), tx.to entrypoint or Uniswap V4 hook (EVM) that creates ≥ N tokens inside a rolling window and has no registry entry fires one alert, with a pre-filled "add to registry" issue link.

```
node detector/index.mjs --chain evm-4663 --v4 0x8366a39cc670b4001a1121b8f6a443a643e40951   # quote tokens come from registry/chains.json
node detector/index.mjs --chain evm-1776 --rpc https://sentry.evm-rpc.injective.network --min 3
node detector/index.mjs --chain solana   --rpc https://your-rpc --min 5 --window 60            # block scanning (default)
node detector/index.mjs --chain solana   --rpc https://your-rpc --source metadata               # cheap mode, Metaplex-only
```

| flag                           | default                                                                            | meaning                                                                                                                                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--chain`                      | required                                                                           | a `dir` from `registry/chains.json` (`solana`, `evm-4663`, …)                                                                                                                                                                          |
| `--rpc`                        | chain's public RPC                                                                 | HTTP JSON-RPC URL (`RPC_URL` env works too)                                                                                                                                                                                            |
| `--min`                        | 3 (EVM) / 5 (Solana)                                                               | tokens per window before an alert                                                                                                                                                                                                      |
| `--window`                     | 60                                                                                 | rolling window in minutes                                                                                                                                                                                                              |
| `--v4`                         | –                                                                                  | Uniswap V4 PoolManager address → key launchpads by **hook** (needed on chains where pads are V4 hooks)                                                                                                                                 |
| `--quotes`                     | chain's `quoteTokens`                                                              | extra quote tokens (WETH, USDC…) so the non-quote currency is reported as the token                                                                                                                                                    |
| `--ignore`                     | –                                                                                  | extra addresses never to alert on (established DEXes, routers)                                                                                                                                                                         |
| `--registry`                   | local `dist/addresses.json`                                                        | path or URL; reloaded hourly, so merged PRs silence alerts automatically                                                                                                                                                               |
| `--state`                      | `./detector-state-<chain>.json`                                                    | persisted cursor + seen tokens + counters                                                                                                                                                                                              |
| `--source`                     | `blocks`                                                                           | Solana only: `blocks` scans every confirmed block with `getBlock` (catches Token-2022 metadata-extension launches such as pump.fun); `metadata` polls the Token Metadata program's signatures (cheap, misses Token-2022-only mints)    |
| `--lag`                        | 60                                                                                 | Solana `blocks`: when the RPC cannot keep up, skip ahead to at most this many slots behind the tip                                                                                                                                     |
| `--concurrency`                | 3                                                                                  | Solana `blocks`: blocks fetched in parallel (applied in slot order); raise on a dedicated RPC, lower to 1 if the RPC rate-limits                                                                                                       |
| `--poll`, `--chunk`, `--batch` | 4000 ms (EVM) / 1000 ms (Solana blocks) / 8000 ms (metadata); 200 blocks; 100 sigs | tuning                                                                                                                                                                                                                                 |
| `--watch`                      | off                                                                                | watch feed (below): `--watch` alone enables the Telegram commands; `--watch pump-fun,bags` or `--watch all` also broadcasts those launchpads' launches to every configured sink                                                        |
| `--scan-on-demand`             | off                                                                                | with `--watch`: do not poll the chain at all while no chat (and no `--watch` id) is subscribed; resumes at the tip when someone subscribes. Block scanning costs real CPU (~70 % of a core on Solana), so a hosted bot should set this |

Notifications (all optional): `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`, `DISCORD_WEBHOOK`, `WEBHOOK_URL` (JSON POST). Console always.

## Watch feed (`--watch`)

The threshold alert above fires once per _unknown_ launchpad. The watch feed is the opposite: every launch on a launchpad that **is** registered, for the people who asked for it, as a token card with buy buttons.

```
TELEGRAM_BOT_TOKEN=… TRADE_REF=yourcode node detector/index.mjs --chain solana --watch
```

- Anyone who opens the bot picks launchpads with `/watch pump.fun` (id, name or alias; `/launchpads` lists them, `/watch all` takes everything), drops them with `/unwatch <id>` / `/unwatch all`, and checks `/watching`. Lists are stored per chat in the state file (`watch.chats`), so they survive restarts. `TELEGRAM_ALLOW=123,456` restricts the commands to those chat ids; by default anyone may use them, which is what a public feed bot wants. `TELEGRAM_COMMANDS=0` sends cards but never polls `getUpdates`, for a second process (another chain) that shares the bot token. Other `/commands` are ignored, so the bot can live in a group with other bots.
- `--watch pump-fun,bags` (or `all`) additionally sends those launches to **every** configured sink (console, `TELEGRAM_CHAT_ID`, Discord, webhook) without anyone subscribing. Webhook payloads carry `kind: "launch"`, `launchpad`, and `token` (`address`, `symbol`, `name`, `creator` when known).
- Buy buttons come from `registry/trade-links.json` through `buyLinks()`: `TRADE_REF` is your referral code (apps that need one are skipped without it), `BUY_BUTTONS=trojan,based,gmgn-telegram,bonkbot,axiom,dexscreener` picks and orders them (that list is the default). Bots that run their own copy use their own referral; the dataset ships none.
- A launch is credited to the registered launchpad whose program, factory or hook runs in the transaction, or whose partner/platform config is among its accounts (other roles such as fee wallets never credit); a frontend built on another entry (`builtOn`, e.g. Bags on Meteora DBC) wins over the base, and shared DEX programs (role `other`) are never credited. `--watch` names resolve like `/watch` (id, name or alias) and unknown ones are reported at start. Name and symbol come from Token-2022 metadata (pump.fun and clones) or the Metaplex create-metadata instruction (LaunchLab, letsbonk, DBC).
- Sends go through one queue (the chain cursor never waits for Telegram); a chat that blocked the bot (403) or no longer exists is unsubscribed automatically. Telegram's bot limits apply: ~1 message per second per chat and 30 per second overall. pump.fun alone launches ~15 tokens per minute at busy hours, so a watcher of `all` on Solana gets a busy chat; a 429 is retried once after Telegram's `retry_after`. One `getUpdates` poller per bot token: Telegram answers 409 to a second one, which the log names; updates queued before the first start are skipped.

## Modules

| file                     | role                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `index.mjs`              | CLI flags → config, picks the engine                                                    |
| `evm.mjs` / `solana.mjs` | pure helpers (`mintsByTx`, `hookFromInitLog`, `findFungibleMint`, …) + the polling loop |
| `tracker.mjs`            | rolling-window counter: when does an entrypoint become an alert                         |
| `registry.mjs`           | loads `dist/addresses.json` (path or URL), hourly refresh                               |
| `state.mjs`              | persisted cursor / seen set / counters                                                  |
| `notify.mjs`             | console, Telegram, Discord, webhook; inline keyboards for buy buttons                   |
| `watch.mjs`              | watch feed: per-chat lists, `/watch` commands, launch cards with buy buttons            |
| `telegram.mjs`           | `getUpdates` long-poll that answers the watch commands                                  |

Engines accept an injected `rpc` function and `maxRounds`, which is how `test/detector-*.test.mjs` run them offline against recorded RPC answers in `test/fixtures/`.

## How it works

- **EVM:** `eth_getLogs` for `Transfer(from=0x0)` per block chunk → the minting contract is checked for `decimals()` (drops NFTs) → `tx.to` of the creating tx is the entrypoint. With `--v4`, `Initialize` logs on the PoolManager are keyed by the hook address because on V4 pads `tx.to` is the shared PositionManager.
- **Solana (`--source blocks`, default):** polls `getSlot` and fetches every confirmed block (`getBlock`, jsonParsed, tx version 1), keeps txs that contain an `initializeMint`/`initializeMint2` with `decimals > 0` (decimals 0 = NFT), and counts every non-system outer program in those txs. This is the only HTTP-level source that sees Token-2022 metadata-extension launches (pump.fun and its clones never touch Metaplex). Cost: ~3 MB and ~300 ms per block on a public RPC, i.e. the RPC must sustain ~2.5 blocks/s or the detector skips ahead (`--lag`). DEX programs whose pool creation mints an LP token are excluded via `registry/chains.json` → `ignore` and registry `other` roles. When any program in the tx, outer or via CPI, is a registered launchpad, the birth is credited to that launchpad: bundlers and sniper programs that CPI into pump.fun are not reported as launchpads. Blocks are fetched `--concurrency` at a time (default 3) and applied in slot order. Measured on publicnode: 1 in flight covered ~45 % of slots, 3 in flight ~83 % (77 of 450 slots skipped in 3 minutes, 160 pump.fun launches seen); a dedicated RPC or `--concurrency 5` should reach 100 %. RSS ~470 MB with 3 blocks in flight. Prediction-market programs that mint outcome tokens (e.g. ids starting `prediCt…`, `TitanPM…`) show up as unknown token-minting programs; add them to `--ignore` or the chain `ignore` list once identified.
- **Solana (`--source metadata`):** polls `getSignaturesForAddress` on the Token Metadata program instead. Two orders of magnitude cheaper, but blind to Token-2022-only mints; a dry run on 2026-10-22 saw 3 launches in 5 minutes where block scanning sees ~70.
- **Rate limits:** one in-flight request per endpoint, paced (60 ms EVM / 120 ms Solana), HTTP 429 and `-32005` retried with exponential backoff, then the poll loop backs off 6× on persistent limits.
- **State:** `seen` is capped at 20 000 keys (oldest dropped), entrypoints that never alerted are pruned once their window is empty, writes are atomic (`.tmp` + rename).
- Launchpads that rotate their entrypoint (see `launchproof` on Robinhood Chain) show up as several low-count entrypoints; lower `--min` or key on the deployer for those.

## Run forever

```
pm2 start detector/index.mjs --name detect-rh -- --chain evm-4663 --v4 0x8366a39cc670b4001a1121b8f6a443a643e40951 --quotes 0x0bd7d308f8e1639fab988df18a8011f41eacad73
```

or `docker build -t launchpad-detector . && docker run -e TELEGRAM_BOT_TOKEN=… -e TELEGRAM_CHAT_ID=… launchpad-detector --chain evm-4663`
