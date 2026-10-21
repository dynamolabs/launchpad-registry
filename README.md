# launchpad-registry

[![validate](https://github.com/OWNER/launchpad-registry/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/launchpad-registry/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/launchpad-registry)](https://www.npmjs.com/package/launchpad-registry)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**The open registry of token launchpads.** Program IDs, factories, Uniswap V4 hooks, multi-tenant configs and launch events, on Solana and EVM chains, in reviewed JSON, plus a detector that finds launchpads nobody has registered yet.

Every sniper, radar, dashboard and wallet tracker reverse-engineers the same addresses from raw transactions. This repo makes that work shared, versioned and reviewable, the way [`ethereum-lists/chains`](https://github.com/ethereum-lists/chains) did for chain IDs.

**Browse:** https://OWNER.github.io/launchpad-registry · **Data:** [`dist/launchpads.json`](dist/launchpads.json) · **Add one:** [CONTRIBUTING.md](CONTRIBUTING.md)

## Coverage

| chain | dir | launchpads |
|---|---|---|
| Solana | `solana` | pump.fun · Raydium LaunchLab (+ letsbonk, StonkFun) · Meteora DBC (+ Blocks, FarmFun, Bots Family) · Pangea · kids.fun |
| Robinhood Chain `4663` | `evm-4663` | Pons · HoodPump · NOXA · RobinFun · Virtuals · pmav · launchproof · LaunchHood · Trencher · HudPad · Clanker · Doppler |
| Injective EVM `1776` | `evm-1776` | runup.fun · Sprout · IMORTAL |
| Arc `5042` | `evm-5042` | none yet |

Every address was checked on-chain (`npm run verify`): programs are executable, contracts have code, Anchor discriminators and `topic0` hashes are recomputed in CI.

## Use the data

**Fetch** (no install):

```js
const { launchpads } = await (await fetch('https://raw.githubusercontent.com/OWNER/launchpad-registry/main/dist/launchpads.json')).json();
```

**npm:**

```sh
npm i launchpad-registry
```

```js
import { lookup, isKnown, forChain, frontendsOf, active } from 'launchpad-registry';

lookup('solana', 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj');
// → [{ launchpad: { id: 'raydium-launchlab', … }, role: 'program' }]

isKnown('evm-4663', hookAddress);         // Uniswap V4 pads are keyed by hook, case-insensitive
forChain({ family: 'evm', id: 4663 });    // every Robinhood Chain launchpad
frontendsOf('meteora-dbc');               // pads built on a multi-tenant program
active();                                 // status === 'active'
```

Files in `dist/`: `launchpads.json` (all), `addresses.json` (reverse index `chain:address → [{id, role}]`), `by-chain/<dir>.json`, `chains.json`. TypeScript types ship in `index.d.ts`.

## What one entry looks like

```jsonc
{
  "id": "hoodpump", "name": "HoodPump", "website": "https://hoodpump.fun",
  "chain": { "family": "evm", "id": 4663 }, "status": "active", "model": "bonding-curve",
  "contracts": [{ "address": "0x12db…892b", "role": "curve", "checked": "2026-10-21" }],
  "launch": { "kind": "event", "name": "Created", "signature": "Created(address indexed token, …)",
              "topic0": "0x3794…68dc", "tokenField": "topics[1]", "creatorField": "topics[2]" },
  "token": { "standard": "erc20", "metadata": "calldata", "decimals": 18 },
  "graduation": { "target": "uniswap-v3", "event": "Graduated" },
  "sources": ["https://robinhoodchain.blockscout.com/address/0x12db…"]
}
```

| field | why a bot needs it |
|---|---|
| `contracts[].role` | what to subscribe to: `program`, `factory`, `launcher` (tx.to), `hook` (Uniswap V4), `platform-config` / `partner-config` (frontends on Raydium LaunchLab, Meteora DBC), `deployer`, `curve` |
| `launch` | how one launch appears: Anchor instruction + `discriminator`, ABI event + `topic0`, 4-byte `selector`, and which field carries the new token |
| `builtOn` | frontend → underlying program (`letsbonk` → `raydium-launchlab`) |
| `model` | `bonding-curve` · `direct-pool` · `funding-round` · `meta-launchpad` |
| `token` | `spl` / `token-2022` / `erc20`, where metadata lives, vanity suffix (`pump$`, `4663$`) |
| `graduation` | where and when a curve migrates |
| `sources` | the explorer / docs links every claim is backed by |

Schema: [`schema/launchpad.schema.json`](schema/launchpad.schema.json). Chains: [`registry/chains.json`](registry/chains.json).

## Find what is missing: the detector

```sh
node detector/index.mjs --chain evm-4663 --v4 0x8366a39cc670b4001a1121b8f6a443a643e40951 --quotes 0x0bd7…ad73
node detector/index.mjs --chain solana --rpc https://your-rpc --min 5
```

Any program, entrypoint or hook that creates ≥ N fungible tokens in a rolling window **and is not in the registry** triggers one alert (console, Telegram, Discord or webhook) with a pre-filled issue link. Merged PRs silence it automatically because the detector reloads the registry hourly. Details and pm2/Docker recipes in [`detector/README.md`](detector/README.md).

## Contribute

```sh
npm ci
# add registry/<chain>/<id>.json  (copy the closest existing file)
npm run validate   # schema + unique ids + address format + builtOn resolves
npm run verify     # every address exists on-chain; fills discriminators / topic0
npm run build      # regenerates dist/ and docs/index.html
npm test
```

Rules in short: one launchpad per file, file name = `id`, every address backed by a `sources` link, `status` honest, no paid listings, no referral links. The long version is [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

- [ ] Base, BNB, Ethereum mainnet, Arc entries
- [ ] Token-2022 metadata-extension mints in the Solana detector
- [ ] Fixture transactions per launchpad for decoder tests
- [ ] `verified` badge from published IDLs / verified source

## License

MIT, code and data. A listing is a fact about on-chain activity, not an endorsement. Nothing here is financial advice.
