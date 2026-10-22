<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/lockup-dark.svg">
    <img src="brand/lockup-light.svg" alt="launchpad-registry" width="520">
  </picture>
</p>

# launchpad-registry

[![validate](https://github.com/dynamolabs/launchpad-registry/actions/workflows/ci.yml/badge.svg)](https://github.com/dynamolabs/launchpad-registry/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/launchpad-registry)](https://www.npmjs.com/package/launchpad-registry)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**The open registry of token launchpads.** Program IDs, factories, Uniswap V4 hooks, multi-tenant configs and launch events, on Solana and EVM chains, in reviewed JSON, plus a detector that finds launchpads nobody has registered yet.

Every sniper, radar, dashboard and wallet tracker reverse-engineers the same addresses from raw transactions. This repo makes that work shared, versioned and reviewable, the way [`ethereum-lists/chains`](https://github.com/ethereum-lists/chains) did for chain IDs.

**Browse:** https://dynamolabs.github.io/launchpad-registry · **Data:** [`dist/launchpads.json`](dist/launchpads.json) · **Add one:** [CONTRIBUTING.md](CONTRIBUTING.md)

## Buy buttons (trade links)

Every alert bot ends its token card with the same row of buttons: Trojan, BONKbot, GMGN, Maestro, Axiom, Photon, BullX, DEX Screener… `registry/trade-links.json` holds their deep-link templates (`{token}`, `{ref}`, `{pool}`), each marked `production` (used by bots we run), `docs` (the app's own documentation) or `community` (links in the wild), with the source and the date checked.

```js
import { buyLinks } from 'launchpad-registry';
buyLinks({ chain: 'solana', token: mint, ref: 'yourcode' });
// → [{ id: 'trojan', name: 'Trojan', kind: 'telegram', url: 'https://t.me/solana_trojanbot?start=r-yourcode-<mint>', verified: 'production' }, …]
```

Apps whose template needs a referral code are left out when you pass none (unless they have a no-referral variant). Referral codes are yours; the registry only carries the URL shape. Fix or add one in `registry/trade-links.json` with a source link.

## Coverage

| chain                  | dir        | launchpads                                                                                                                                                                                       |
| ---------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Solana                 | `solana`   | pump.fun · Raydium LaunchLab (+ letsbonk, StonkFun) · Meteora DBC (+ Bags, Moonshot, Jupiter Studio, Blocks, FarmFun, Bots Family) · Moonit (legacy program) · Boop · Heaven · Pangea · kids.fun |
| Robinhood Chain `4663` | `evm-4663` | Pons · HoodPump · NOXA · RobinFun · Virtuals · pmav · launchproof · LaunchHood · Trencher · HudPad · Clanker · Doppler                                                                           |
| Injective EVM `1776`   | `evm-1776` | runup.fun · Sprout · IMORTAL                                                                                                                                                                     |
| Arc `5042`             | `evm-5042` | none yet                                                                                                                                                                                         |

Every address was checked on-chain (`npm run verify`): programs are executable, contracts have code, Anchor discriminators and `topic0` hashes are recomputed in CI. Entries carry a real launch tx as a **fixture** (`scripts/fixtures.mjs`), the program's **IDL snapshot** (`idl/`), a **logo** (`icons/`) and an automated weekly **liveness** stamp (`lastActivity`, status flips after 30 quiet days).

## Use the data

**Fetch** (no install):

```js
const { launchpads } = await (
  await fetch(
    'https://raw.githubusercontent.com/dynamolabs/launchpad-registry/main/dist/launchpads.json',
  )
).json();
```

**npm:**

```sh
npm i launchpad-registry
```

```js
import { lookup, isKnown, forChain, frontendsOf, active } from 'launchpad-registry';

lookup('solana', 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj');
// → [{ launchpad: { id: 'raydium-launchlab', … }, role: 'program' }]

isKnown('evm-4663', hookAddress); // Uniswap V4 pads are keyed by hook, case-insensitive
forChain({ family: 'evm', id: 4663 }); // every Robinhood Chain launchpad
frontendsOf('meteora-dbc'); // pads built on a multi-tenant program
active(); // status === 'active'
```

Files in `dist/`: `launchpads.json` (all), `launchpads.min.json` (ids + addresses only), `addresses.json` (reverse index `chain:address → [{id, role}]`), `launchpads.csv` (one row per address, for Dune / spreadsheets), `by-chain/<dir>.json`, `chains.json`, `tags.json`. Every file carries `version` (semver of the dataset) and `generated`. CDN: `https://cdn.jsdelivr.net/gh/OWNER/launchpad-registry@main/dist/launchpads.json`. TypeScript types ship in `index.d.ts`.

**AI agents:** `mcp/` is an MCP server (`lookup`, `search`, `get`, `frontends_of`, `list_chains`), see [`mcp/README.md`](mcp/README.md); `llms.txt` summarises the data for LLMs; `skills/add-launchpad` teaches an agent how to contribute an entry.

## What one entry looks like

```jsonc
{
  "id": "hoodpump",
  "name": "HoodPump",
  "website": "https://hoodpump.fun",
  "chain": { "family": "evm", "id": 4663 },
  "status": "active",
  "model": "bonding-curve",
  "contracts": [{ "address": "0x12db…892b", "role": "curve", "checked": "2026-10-21" }],
  "launch": {
    "kind": "event",
    "name": "Created",
    "signature": "Created(address indexed token, …)",
    "topic0": "0x3794…68dc",
    "tokenField": "topics[1]",
    "creatorField": "topics[2]",
  },
  "token": { "standard": "erc20", "metadata": "calldata", "decimals": 18 },
  "graduation": { "target": "uniswap-v3", "event": "Graduated" },
  "sources": ["https://robinhoodchain.blockscout.com/address/0x12db…"],
}
```

| field                      | why a bot needs it                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts[].role`         | what to subscribe to: `program`, `factory`, `launcher` (tx.to), `hook` (Uniswap V4), `platform-config` / `partner-config` (frontends on Raydium LaunchLab, Meteora DBC), `deployer`, `curve` |
| `launch`                   | how one launch appears: Anchor instruction + `discriminator`, ABI event + `topic0`, 4-byte `selector`, and which field carries the new token                                                 |
| `builtOn`                  | frontend → underlying program (`letsbonk` → `raydium-launchlab`)                                                                                                                             |
| `model`                    | `bonding-curve` · `direct-pool` · `funding-round` · `meta-launchpad`                                                                                                                         |
| `token`                    | `spl` / `token-2022` / `erc20`, where metadata lives, vanity suffix (`pump$`, `4663$`)                                                                                                       |
| `graduation`               | where and when a curve migrates                                                                                                                                                              |
| `sources`                  | the explorer / docs links every claim is backed by                                                                                                                                           |
| `fixtures`                 | real launch txs that prove the spec; `idl` / `abi` point to decoder files in-repo                                                                                                            |
| `externalIds`              | the same launchpad's name at Codex, Solana Tracker, DexScreener… so datasets join                                                                                                            |
| `checked` / `lastActivity` | last on-chain verification (`npm run verify`) and last observed launch (weekly liveness job)                                                                                                 |

Schema: [`schema/launchpad.schema.json`](schema/launchpad.schema.json). Chains: [`registry/chains.json`](registry/chains.json).

## Find what is missing: the detector

```sh
node detector/index.mjs --chain evm-4663 --v4 0x8366a39cc670b4001a1121b8f6a443a643e40951 --quotes 0x0bd7…ad73
node detector/index.mjs --chain solana --rpc https://your-rpc --min 5
```

Any program, entrypoint or hook that creates ≥ N fungible tokens in a rolling window **and is not in the registry** triggers one alert (console, Telegram, Discord or webhook) with a pre-filled issue link. Merged PRs silence it automatically because the detector reloads the registry hourly. Details and pm2/Docker recipes in [`detector/README.md`](detector/README.md).

The same process can run a **watch feed** (`--watch`): every launch on a launchpad that _is_ registered, as a card with buy buttons, for the Telegram chats that asked for it with `/watch pump.fun` (`/unwatch`, `/watching`, `/launchpads`) or broadcast for the ids you pass (`--watch pump-fun,bags`, `--watch all`). Buttons come from the trade links above with your own `TRADE_REF`.

## Used by

- `sol-launchpad-radar` and `inj-launchpad-radar` (Telegram radars for new launchpads on Solana / Injective) load `dist/addresses.json` hourly to tell registered programs from unknown ones. Add yours via PR.

## Contribute

```sh
npm ci
# add registry/<chain>/<id>.json  (copy the closest existing file)
npm run validate   # schema + unique ids + address format + builtOn resolves
npm run verify     # every address exists on-chain; fills discriminators / topic0
npm run fixtures -- <id>   # finds a real launch tx and records it under `fixtures`
npm run build      # regenerates dist/ and docs/index.html
npm test           # offline: registry rules + detector engines against recorded RPC answers
npm run lint       # eslint + prettier (`npm run format` fixes)
```

Code layout: `lib/` (JSON-RPC client with pacing and 429 backoff, hashing, file helpers) is shared by `scripts/` and `detector/`; the detector's chain engines are pure functions plus a thin polling loop, so every rule is unit-tested without a network.

Rules in short: one launchpad per file, file name = `id`, every address backed by a `sources` link, `status` honest, no paid listings, no referral links. The long version is [CONTRIBUTING.md](CONTRIBUTING.md).

## Versioning

The dataset is semver'd (`version` in every `dist/` file, tags `vX.Y.Z`, [CHANGELOG](CHANGELOG.md)): **major** when an entry or address is removed or changed, **minor** when entries/addresses are added, **patch** for metadata. Pin a tag if you need stability: `cdn.jsdelivr.net/gh/OWNER/launchpad-registry@v0.1.0/dist/launchpads.json`.

## Roadmap

- [ ] Base, BNB, Ethereum mainnet, Arc entries (Clanker, Zora, Flaunch, four.meme, Virtuals Base…)
- [ ] Bags, Believe, DAOs.fun config keys on Solana (need fixture txs)
- [x] Token-2022 metadata-extension mints in the detector (block scanning, 0.3.0)
- [ ] Yellowstone gRPC mode in the detector (block scanning over HTTP needs ~8 MB/s)
- [ ] Public keyless lookup API
- [ ] Schema registered at SchemaStore

## License

Code is MIT ([LICENSE](LICENSE)); data in `registry/`, `dist/`, `idl/`, `abi/`, `icons/` is CC0 ([LICENSE-DATA](LICENSE-DATA)), so it can be merged into any dataset without attribution. A listing is a fact about on-chain activity, not an endorsement. Nothing here is financial advice.
