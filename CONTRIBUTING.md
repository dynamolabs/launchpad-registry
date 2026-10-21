# Contributing

## Add a launchpad

1. Copy the closest existing file in `registry/<chain>/` to `registry/<chain>/<id>.json`.
   - `id`: lowercase slug, unique registry-wide, equals the file name. Same brand on several chains → suffix the chain (`virtuals-robinhood`).
2. Fill `contracts`. Put every address a detector needs, with the right `role`:
   - `program` (Solana program / EVM core contract), `factory`, `launcher` (tx.to entrypoint), `hook` (Uniswap V4), `curve`, `router`
   - `platform-config` / `partner-config` for frontends on multi-tenant programs (Raydium LaunchLab, Meteora DBC); set `builtOn` to the underlying program's id
   - `deployer` / `authority` for wallets that sign or own every launch
3. Fill `launch` so someone can subscribe: instruction or event name, `topic0` / `selector` / `discriminator`, and which field carries the new token.
4. Every claim needs a link in `sources` (explorer page of the contract, official docs, IDL, announcement). No source, no merge.
5. Run `npm run validate`, then `npm run verify -- --write` (checks every address on-chain and stamps `checked`; set `SOLANA_RPC` / `EVM_RPC_<chainId>` for private RPCs), then `npm run build` and commit `dist/` and `docs/` too.

## Update or deprecate

- Set `status` to `inactive` when a pad has had no launches for 30+ days or its frontend is gone. Do not delete files; history matters for decoders and analytics.
- Rotating contracts (new factory version, rotated hook): append, label the old one, keep both.

## Keep it neutral

- No paid listings, no ranking, no "recommended" flags. A `status: active` entry means "launches tokens", nothing more.
- Do not add referral links to `website`.

## Versioning (dataset semver)

- **major**: an entry or address removed, or an address/chain changed
- **minor**: entries or addresses added
- **patch**: metadata only (names, websites, notes, logos, fixtures, lastActivity)

Maintainers bump `package.json` version, add a CHANGELOG line and push a `vX.Y.Z` tag; the release workflow publishes to npm and attaches `dist/` to the GitHub release.

## Proof, not claims

- `npm run verify -- --write` must pass (every address exists on-chain; Anchor discriminators / topic0 recomputed).
- `node scripts/fixtures.mjs <id>` should find a real launch tx. If it cannot, say why in the PR; entries without a fixture get `status: unknown`.
- Multi-tenant programs attract impostor configs (we have seen 30+ `platform-config` accounts named "letsbonk.fun", some pointing at google.com). Only register a config that has produced real launches, and link one in `sources`.

## Chains

Add the chain to `registry/chains.json` (`dir` must match the directory name) before adding its first launchpad.

## Review checklist (maintainers)

- [ ] address format matches chain family; EVM addresses either checksummed or lowercase
- [ ] `builtOn` target exists
- [ ] `sources` resolve and show the address
- [ ] `dist/` rebuilt
