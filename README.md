# launchpad-registry

**A community-maintained registry of token launchpads: the program IDs, factories, hooks and launch events a bot needs to detect new launches, on Solana and EVM chains.**

Think `ethereum-lists/chains`, but for launchpads. Every sniper, radar, analytics dashboard and wallet tracker re-discovers the same addresses by reverse-engineering transactions. This repo makes that work shared and reviewable.

- `registry/<chain>/<id>.json` — one file per launchpad, validated against [`schema/launchpad.schema.json`](schema/launchpad.schema.json)
- `dist/launchpads.json` — everything, aggregated (fetch this)
- `dist/addresses.json` — reverse index `chain:address → launchpad`
- `dist/by-chain/<chain>.json` — one chain at a time

## Use it

```js
const r = await fetch('https://raw.githubusercontent.com/OWNER/launchpad-registry/main/dist/launchpads.json');
const { launchpads } = await r.json();
const solana = launchpads.filter(l => l.chain.family === 'solana' && l.status === 'active');
for (const l of solana) console.log(l.id, l.contracts.map(c => c.address));
```

Reverse lookup, e.g. inside a gRPC/WebSocket handler:

```js
const { addresses } = await (await fetch('.../dist/addresses.json')).json();
const hit = addresses[`solana:${programId}`];          // → [{ id: 'raydium-launchlab', role: 'program' }]
const evmHit = addresses[`evm-4663:${hook.toLowerCase()}`]; // Uniswap V4 pads are keyed by hook
```

See [`examples/`](examples/) for a runnable consumer.

## What is in an entry

| field | meaning |
|---|---|
| `contracts[]` | every address that identifies the pad: `program`, `factory`, `hook` (Uniswap V4), `platform-config` / `partner-config` (multi-tenant programs like Raydium LaunchLab and Meteora DBC), `deployer`, `curve`, … |
| `launch` | how one launch appears on-chain: Anchor instruction name / discriminator, ABI event + `topic0`, 4-byte selector, which field holds the new token |
| `builtOn` | frontend → underlying program (e.g. `letsbonk` is built on `raydium-launchlab`) |
| `model` | `bonding-curve`, `direct-pool`, `funding-round`, `meta-launchpad` |
| `token` | `spl` / `token-2022` / `erc20`, where metadata lives, vanity address pattern |
| `graduation` | where and when a curve migrates |
| `sources` | explorer / docs links that back every claim |

Full schema: [`schema/launchpad.schema.json`](schema/launchpad.schema.json). Chains: [`registry/chains.json`](registry/chains.json).

## Coverage

| chain | dir | launchpads |
|---|---|---|
| Solana | `solana` | pump.fun, Raydium LaunchLab (+ letsbonk, StonkFun), Meteora DBC (+ Blocks, FarmFun, Bots Family), Pangea, kids.fun |
| Robinhood Chain (4663) | `evm-4663` | Pons, HoodPump, NOXA, RobinFun, Virtuals, pmav, launchproof, LaunchHood, Trencher, HudPad, Clanker, Doppler |
| Injective EVM (1776) | `evm-1776` | runup.fun, Sprout, IMORTAL |
| Arc (5042) | `evm-5042` | none yet (o1-launchpad, aka.fun known to exist) |

Missing one? [Open a PR](CONTRIBUTING.md). Missing a chain? Add it to `registry/chains.json` and create the directory.

## Contribute

```sh
npm ci
# add or edit registry/<chain>/<id>.json
npm run validate   # schema + cross-file checks (unique ids, address format, builtOn exists)
npm run build      # regenerate dist/ (CI fails if dist/ is stale)
```

Rules, in short: one launchpad per file, file name = `id`, every address backed by a `sources` link, `status` honest. Details in [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

- [ ] `detector/` — generic new-launchpad detector: given an RPC, flags programs/factories that mint ≥ N tokens per hour and are **not** in the registry, and posts to Telegram/Discord/webhook. Lets the registry grow itself.
- [ ] Arc, Base, BNB, Ethereum mainnet entries
- [ ] Per-launchpad fixture transactions for decoder tests
- [ ] Verified badge: address matches a published IDL / verified source

## License

MIT. Data is contributed under the same license. Nothing here is financial advice; a listed launchpad is not an endorsed one.
