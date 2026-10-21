---
name: add-launchpad
description: Add or update a launchpad entry in launchpad-registry from an example launch transaction. Use when asked to register a launchpad, add a program/factory/hook, or fix an entry.
---

# add-launchpad

1. Identify the chain. Find its `dir` in `registry/chains.json` (add the chain there first if missing).
2. From an example launch tx, collect: the program / factory / launcher / hook address, the instruction or event that creates the token, which field holds the new token, token standard, graduation target.
   - Solana: `node scripts/fetch-idl.mjs <id>` after creating the file snapshots the IDL; use instruction names from it. Discriminator = sha256("global:<name>")[0..8], `npm run verify -- --write` fills it.
   - EVM: `topic0` = keccak256 of the canonical event signature; `npm run verify -- --write` checks it.
3. Create `registry/<dir>/<id>.json` by copying the closest existing entry. `id` = file name, lowercase slug. Frontends on multi-tenant programs (Raydium LaunchLab, Meteora DBC) use `builtOn` + `platform-config` / `partner-config` contracts, never a second copy of the program.
4. Every address needs a `sources` link that shows it. Tags must exist in `registry/tags.json`.
5. Run, in order: `npm run validate`, `npm run verify -- --write`, `node scripts/fixtures.mjs <id>`, `npm run build`, `npm test`. Commit `dist/` and `docs/`.
6. Open a PR using the template. Do not add referral links or marketing language; `status` is a fact, not a rating.
