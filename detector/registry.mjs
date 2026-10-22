// Loads dist/addresses.json (local path or URL) and refreshes it periodically,
// so a merged registry PR silences the matching alert without a restart.
import { readFileSync } from 'node:fs';

/**
 * @param {string} src  file path or http(s) URL of addresses.json
 * @param {object} [opts]
 * @param {number} [opts.refreshMs=3600000]  reload interval; 0 disables
 * @param {Function} [opts.log]
 */
export async function loadRegistry(src, { refreshMs = 3600e3, log = console.log } = {}) {
  const current = { addresses: {}, generated: null };

  async function load() {
    try {
      const json = /^https?:/.test(src)
        ? await (await fetch(src)).json()
        : JSON.parse(readFileSync(src, 'utf8'));
      current.addresses = json.addresses || {};
      current.generated = json.generated;
      log(
        `[registry] ${Object.keys(current.addresses).length} addresses (built ${current.generated}) from ${src}`,
      );
    } catch (err) {
      log(`[registry] load failed: ${err.message}`);
    }
  }

  await load();
  if (refreshMs > 0) setInterval(load, refreshMs).unref();

  const keyOf = (dir, address) =>
    `${dir}:${dir.startsWith('evm') ? String(address).toLowerCase() : address}`;

  return {
    /** [{ id, role, label }] owning this address on this chain dir, or []. */
    lookup: (dir, address) => current.addresses[keyOf(dir, address)] || [],
    /** true when some registry entry claims the address. */
    known: (dir, address) => (current.addresses[keyOf(dir, address)] || []).length > 0,
    /** Build date of the loaded file. */
    generated: () => current.generated,
  };
}
