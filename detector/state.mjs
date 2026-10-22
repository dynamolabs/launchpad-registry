// Persisted detector state: cursor, seen set and per-entrypoint counters.
// Written atomically (tmp + rename) every few seconds when dirty, on exit, and on SIGINT/SIGTERM.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

const EMPTY = () => ({ seen: {}, entrypoints: {}, cursor: null });

/**
 * @param {string} file           JSON file (created on first save)
 * @param {object} [opts]
 * @param {number} [opts.maxSeen=20000]   oldest `seen` keys are dropped beyond this
 * @param {number} [opts.saveMs=5000]     autosave interval; 0 disables the timer (tests)
 * @param {boolean} [opts.handleSignals=true]
 */
export function openState(file, { maxSeen = 20000, saveMs = 5000, handleSignals = true } = {}) {
  let state = EMPTY();
  try {
    state = { ...state, ...JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    // first run: nothing persisted yet
  }
  let dirty = false;

  function trimSeen() {
    const keys = Object.keys(state.seen);
    if (keys.length <= maxSeen) return;
    for (const k of keys.slice(0, keys.length - maxSeen)) delete state.seen[k];
  }

  /** Marks a key as seen; returns false when it was already there. */
  function markSeen(key) {
    if (state.seen[key]) return false;
    state.seen[key] = 1;
    dirty = true;
    if (Object.keys(state.seen).length > maxSeen * 1.25) trimSeen();
    return true;
  }

  function save() {
    if (!dirty) return;
    trimSeen();
    writeFileSync(file + '.tmp', JSON.stringify(state));
    renameSync(file + '.tmp', file);
    dirty = false;
  }

  if (saveMs > 0) setInterval(save, saveMs).unref();
  if (handleSignals) {
    process.on('exit', save);
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.once(sig, () => {
        save();
        process.exit(0);
      });
    }
  }

  return {
    get: () => state,
    touch: () => {
      dirty = true;
    },
    markSeen,
    save,
  };
}
