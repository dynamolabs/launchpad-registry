# Changelog

Data follows semver (see CONTRIBUTING.md): **major** = an entry or address removed / changed, **minor** = entries or addresses added, **patch** = metadata only.

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
