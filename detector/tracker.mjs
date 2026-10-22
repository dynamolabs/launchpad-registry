// Counts fungible-token births per entrypoint inside a rolling window and decides when to alert.
// Pure bookkeeping: no RPC, no I/O. Both chain engines feed it.

/**
 * @param {object} opts
 * @param {object} opts.state       the `entrypoints` object from detector/state.mjs
 * @param {number} opts.windowMin   rolling window in minutes
 * @param {number} opts.minTokens   births inside the window before an entrypoint is reported
 * @param {(address: string) => boolean} opts.isKnown   registry check
 * @param {Iterable<string>} [opts.ignore]   addresses never reported (DEX routers, account-abstraction entrypoints…)
 * @param {() => number} [opts.now]
 */
export function createTracker({
  state,
  windowMin,
  minTokens,
  isKnown,
  ignore = [],
  now = Date.now,
}) {
  const windowMs = windowMin * 60e3;
  const ignored = new Set([...ignore].map((a) => String(a).toLowerCase()));
  const normalize = (address) => (address.startsWith('0x') ? address.toLowerCase() : address);

  /**
   * Records one token birth.
   * @param {'entrypoint'|'hook'|'program'} kind
   * @param {string} address   entrypoint / hook / program id
   * @param {{ address: string, symbol?: string, creator?: string }} token
   * @returns {null | { address, kind, count, first, tokens }}
   *   the entry the first time it crosses the threshold, else null
   */
  function record(kind, address, token) {
    address = normalize(address);
    if (ignored.has(address)) return null;
    const key = `${kind}:${address}`;
    const t = now();
    const entry = (state[key] ??= { kind, first: t, tokens: [], alerted: false });
    entry.tokens.push({ a: token.address, s: token.symbol, c: token.creator, t });
    entry.tokens = entry.tokens.filter((x) => t - x.t < windowMs);
    if (entry.alerted || entry.tokens.length < minTokens || isKnown(address)) return null;
    entry.alerted = true;
    return { address, kind, count: entry.tokens.length, first: entry.first, tokens: entry.tokens };
  }

  /** Drops entrypoints that never alerted and have nothing left inside the window. Returns how many were removed. */
  function prune() {
    const t = now();
    let removed = 0;
    for (const [key, entry] of Object.entries(state)) {
      entry.tokens = entry.tokens.filter((x) => t - x.t < windowMs);
      if (!entry.alerted && entry.tokens.length === 0) {
        delete state[key];
        removed++;
      }
    }
    return removed;
  }

  return { record, prune };
}
