# detector

Finds launchpads that are **not in the registry yet**: any program (Solana), tx.to entrypoint or Uniswap V4 hook (EVM) that creates ≥ N tokens inside a rolling window and has no registry entry fires one alert, with a pre-filled "add to registry" issue link.

```
node detector/index.mjs --chain evm-4663 --v4 0x8366a39cc670b4001a1121b8f6a443a643e40951   # quote tokens come from registry/chains.json
node detector/index.mjs --chain evm-1776 --rpc https://sentry.evm-rpc.injective.network --min 3
node detector/index.mjs --chain solana   --rpc https://your-rpc --min 5 --window 60
```

| flag                           | default                         | meaning                                                                                                |
| ------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `--chain`                      | required                        | a `dir` from `registry/chains.json` (`solana`, `evm-4663`, …)                                          |
| `--rpc`                        | chain's public RPC              | HTTP JSON-RPC URL (`RPC_URL` env works too)                                                            |
| `--min`                        | 3 (EVM) / 5 (Solana)            | tokens per window before an alert                                                                      |
| `--window`                     | 60                              | rolling window in minutes                                                                              |
| `--v4`                         | –                               | Uniswap V4 PoolManager address → key launchpads by **hook** (needed on chains where pads are V4 hooks) |
| `--quotes`                     | chain's `quoteTokens`           | extra quote tokens (WETH, USDC…) so the non-quote currency is reported as the token                    |
| `--ignore`                     | –                               | extra addresses never to alert on (established DEXes, routers)                                         |
| `--registry`                   | local `dist/addresses.json`     | path or URL; reloaded hourly, so merged PRs silence alerts automatically                               |
| `--state`                      | `./detector-state-<chain>.json` | persisted cursor + seen tokens + counters                                                              |
| `--poll`, `--chunk`, `--batch` | 4000 ms / 200 blocks / 100 sigs | tuning                                                                                                 |

Notifications (all optional): `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`, `DISCORD_WEBHOOK`, `WEBHOOK_URL` (JSON POST). Console always.

## Modules

| file                     | role                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `index.mjs`              | CLI flags → config, picks the engine                                                    |
| `evm.mjs` / `solana.mjs` | pure helpers (`mintsByTx`, `hookFromInitLog`, `findFungibleMint`, …) + the polling loop |
| `tracker.mjs`            | rolling-window counter: when does an entrypoint become an alert                         |
| `registry.mjs`           | loads `dist/addresses.json` (path or URL), hourly refresh                               |
| `state.mjs`              | persisted cursor / seen set / counters                                                  |
| `notify.mjs`             | console, Telegram, Discord, webhook                                                     |

Engines accept an injected `rpc` function and `maxRounds`, which is how `test/detector-*.test.mjs` run them offline against recorded RPC answers in `test/fixtures/`.

## How it works

- **EVM:** `eth_getLogs` for `Transfer(from=0x0)` per block chunk → the minting contract is checked for `decimals()` (drops NFTs) → `tx.to` of the creating tx is the entrypoint. With `--v4`, `Initialize` logs on the PoolManager are keyed by the hook address because on V4 pads `tx.to` is the shared PositionManager.
- **Solana:** polls `getSignaturesForAddress` on the Token Metadata program, keeps txs that contain an `initializeMint`/`initializeMint2` with `decimals > 0` (decimals 0 = NFT), and counts every non-system outer program in those txs. Token-2022 mints that use the metadata extension instead of Metaplex are not covered yet (PR welcome: subscribe to `InitializeMint` on Token-2022 as well).
- **Rate limits:** one in-flight request per endpoint, paced (60 ms EVM / 120 ms Solana), HTTP 429 and `-32005` retried with exponential backoff, then the poll loop backs off 6× on persistent limits.
- **State:** `seen` is capped at 20 000 keys (oldest dropped), entrypoints that never alerted are pruned once their window is empty, writes are atomic (`.tmp` + rename).
- Launchpads that rotate their entrypoint (see `launchproof` on Robinhood Chain) show up as several low-count entrypoints; lower `--min` or key on the deployer for those.

## Run forever

```
pm2 start detector/index.mjs --name detect-rh -- --chain evm-4663 --v4 0x8366a39cc670b4001a1121b8f6a443a643e40951 --quotes 0x0bd7d308f8e1639fab988df18a8011f41eacad73
```

or `docker build -t launchpad-detector . && docker run -e TELEGRAM_BOT_TOKEN=… -e TELEGRAM_CHAT_ID=… launchpad-detector --chain evm-4663`
