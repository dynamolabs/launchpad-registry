// Minimal JSON-RPC client shared by the detector and the maintenance scripts.
// Serialises calls per endpoint, paces them, and retries rate-limit answers with backoff.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Error thrown for a JSON-RPC `error` object. `code` is the RPC error code. */
export class RpcError extends Error {
  constructor(method, error) {
    super(`${method}: ${JSON.stringify(error).slice(0, 200)}`);
    this.name = 'RpcError';
    this.method = method;
    this.code = error?.code;
    this.rpcMessage = error?.message;
  }
}

/** true for the usual "slow down" answers (HTTP 429, -32005, "rate limit", "too many requests"). */
export function isRateLimit(err) {
  if (err?.code === -32005 || err?.code === -32029) return true;
  const text = String(err?.message || err);
  return /\bHTTP 429\b|"code":\s*(429|-32005|-32029)\b|\b429 Too Many\b|rate.?limit|too many requests/i.test(
    text,
  );
}

/**
 * Builds a JSON-RPC client.
 * @param {string} url            endpoint
 * @param {object} [opts]
 * @param {number} [opts.minIntervalMs=0]  minimum gap between two requests (simple rate limiter)
 * @param {number} [opts.retries=4]        retries on rate-limit answers (exponential backoff)
 * @param {number} [opts.backoffMs=1500]   first backoff delay
 * @param {number} [opts.timeoutMs=30000]  per-request timeout
 * @param {Function} [opts.fetch]          fetch implementation (tests inject one)
 * @returns {(method: string, params?: any[]) => Promise<any>}
 */
export function makeRpc(url, opts = {}) {
  const {
    minIntervalMs = 0,
    retries = 4,
    backoffMs = 1500,
    timeoutMs = 30000,
    fetch: fetchImpl = globalThis.fetch,
  } = opts;
  let lastAt = 0;
  let chain = Promise.resolve();

  async function once(method, params) {
    const wait = lastAt + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 429) throw new Error(`${method}: HTTP 429`);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${method}: non-JSON answer (HTTP ${res.status}): ${text.slice(0, 120)}`);
    }
    if (json.error) throw new RpcError(method, json.error);
    return json.result;
  }

  async function withRetry(method, params) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await once(method, params);
      } catch (err) {
        if (attempt >= retries || !isRateLimit(err)) throw err;
        await sleep(backoffMs * 2 ** attempt);
      }
    }
  }

  // one in-flight request per endpoint keeps the pacing honest when callers fire in parallel
  return (method, params = []) => {
    const run = chain.then(() => withRetry(method, params));
    chain = run.catch(() => {});
    return run;
  };
}

/** JSON-RPC batch; returns results in request order (null where a request errored). */
export async function rpcBatch(url, calls, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c.method, params: c.params }));
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error('batch not supported by this RPC');
  const out = new Array(calls.length).fill(null);
  for (const r of json) if (r.result !== undefined) out[r.id] = r.result;
  return out;
}

export { sleep };
