// Loads dist/addresses.json (local path or URL) and refreshes it periodically.
import { readFileSync } from 'node:fs';
export async function loadRegistry(src, { refreshMs = 3600e3, log = console.log } = {}) {
  const state = { addresses: {}, generated: null };
  async function load() {
    try {
      const j = /^https?:/.test(src) ? await (await fetch(src)).json() : JSON.parse(readFileSync(src, 'utf8'));
      state.addresses = j.addresses || {}; state.generated = j.generated;
      log(`[registry] ${Object.keys(state.addresses).length} addresses (built ${state.generated}) from ${src}`);
    } catch (e) { log(`[registry] load failed: ${e.message}`); }
  }
  await load();
  if (refreshMs > 0) setInterval(load, refreshMs).unref();
  return {
    /** dir like "evm-4663" / "solana"; returns [{id, role, label}] or [] */
    lookup(dir, address) { return state.addresses[`${dir}:${dir.startsWith('evm') ? String(address).toLowerCase() : address}`] || []; },
    known(dir, address) { return this.lookup(dir, address).length > 0; },
  };
}
