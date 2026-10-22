// Test doubles for the detector: in-memory state, scripted RPC, collecting notifier.

export const silent = () => {};

/** detector/state.mjs look-alike without disk or timers. */
export function createMemoryState(initial = {}) {
  const state = { seen: {}, entrypoints: {}, cursor: null, ...initial };
  return {
    get: () => state,
    touch: () => {},
    markSeen: (key) => {
      if (state.seen[key]) return false;
      state.seen[key] = 1;
      return true;
    },
    save: () => {},
  };
}

/**
 * JSON-RPC stand-in: handlers[method](params) → result. Records every call in `.calls`.
 * Unknown methods throw like a real RPC would.
 */
export function scriptedRpc(handlers) {
  const calls = [];
  const rpc = async (method, params = []) => {
    calls.push({ method, params });
    const handler = handlers[method];
    if (!handler) throw new Error(`${method}: method not found`);
    return handler(params);
  };
  rpc.calls = calls;
  return rpc;
}

/** Notifier that stores alerts instead of sending them. */
export function collectNotifier() {
  const sent = [];
  return {
    sent,
    send: async (alert) => {
      sent.push(alert);
    },
  };
}
