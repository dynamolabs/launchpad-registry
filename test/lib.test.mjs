import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorDiscriminator, canonicalSignature, topic0 } from '../lib/hash.mjs';
import { makeRpc, rpcBatch, RpcError, isRateLimit } from '../lib/rpc.mjs';
import { addressKey, rpcUrlFor } from '../lib/files.mjs';

const jsonResponse = (body, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

test('anchorDiscriminator matches pump.fun create and LaunchLab initialize', () => {
  assert.equal(anchorDiscriminator('create'), '181ec828051c0777');
  assert.equal(anchorDiscriminator('initialize'), 'afaf6d1f0d989bed');
});

test('canonicalSignature strips names, indexed and whitespace', () => {
  assert.equal(
    canonicalSignature('Transfer(address indexed from, address indexed to, uint256 value)'),
    'Transfer(address,address,uint256)',
  );
  assert.equal(
    canonicalSignature('Initialize( bytes32 id , address c0 )'),
    'Initialize(bytes32,address)',
  );
});

test('topic0 of ERC-20 Transfer', () => {
  assert.equal(
    topic0('Transfer(address indexed from, address indexed to, uint256 value)'),
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  );
});

test('makeRpc returns result and throws RpcError with the code', async () => {
  const fetch = async (_url, { body }) => {
    const { method } = JSON.parse(body);
    if (method === 'ok') return jsonResponse({ jsonrpc: '2.0', id: 1, result: 42 });
    return jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32015, message: 'bad version' } });
  };
  const rpc = makeRpc('http://x', { fetch, retries: 0 });
  assert.equal(await rpc('ok'), 42);
  await assert.rejects(rpc('bad'), (err) => err instanceof RpcError && err.code === -32015);
});

test('makeRpc retries rate limits with backoff and gives up after `retries`', async () => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    return calls < 3
      ? jsonResponse('Too Many Requests', 429)
      : jsonResponse({ jsonrpc: '2.0', id: 1, result: 'done' });
  };
  const rpc = makeRpc('http://x', { fetch, retries: 3, backoffMs: 1 });
  assert.equal(await rpc('any'), 'done');
  assert.equal(calls, 3);

  calls = 0;
  const strict = makeRpc('http://x', {
    fetch: async () => (calls++, jsonResponse('x', 429)),
    retries: 1,
    backoffMs: 1,
  });
  await assert.rejects(strict('any'), /429/);
  assert.equal(calls, 2);
});

test('makeRpc paces requests and rejects non-JSON answers (Cloudflare pages)', async () => {
  const stamps = [];
  const fetch = async () => {
    stamps.push(Date.now());
    return jsonResponse({ jsonrpc: '2.0', id: 1, result: 1 });
  };
  const rpc = makeRpc('http://x', { fetch, minIntervalMs: 30 });
  await Promise.all([rpc('a'), rpc('b'), rpc('c')]);
  assert.ok(stamps[2] - stamps[0] >= 55, `expected ≥55 ms spread, got ${stamps[2] - stamps[0]}`);

  const html = makeRpc('http://x', {
    fetch: async () => jsonResponse('<html>blocked</html>', 403),
  });
  await assert.rejects(html('eth_blockNumber'), /non-JSON answer \(HTTP 403\)/);
});

test('isRateLimit recognises the usual shapes', () => {
  assert.ok(isRateLimit(new Error('HTTP 429')));
  assert.ok(isRateLimit(new Error('{"code":-32005,"message":"limit"}')));
  assert.ok(isRateLimit(new Error('Too many requests for a specific RPC call')));
  assert.ok(!isRateLimit(new Error('invalid params')));
});

test('rpcBatch keeps request order and nulls errored items', async () => {
  const fetch = async (_url, { body }) => {
    const reqs = JSON.parse(body);
    const answers = reqs.map((r) =>
      r.params[0] === 'bad' ? { id: r.id, error: {} } : { id: r.id, result: r.params[0] },
    );
    return jsonResponse(answers.reverse());
  };
  const out = await rpcBatch(
    'http://x',
    [
      { method: 'm', params: ['a'] },
      { method: 'm', params: ['bad'] },
      { method: 'm', params: ['c'] },
    ],
    { fetch },
  );
  assert.deepEqual(out, ['a', null, 'c']);
});

test('addressKey lower-cases EVM only; rpcUrlFor honours env overrides', () => {
  assert.equal(addressKey({ dir: 'evm-1', family: 'evm' }, '0xABC'), 'evm-1:0xabc');
  assert.equal(addressKey({ dir: 'solana', family: 'solana' }, 'AbC'), 'solana:AbC');
  const evm = { family: 'evm', id: 4663, rpc: ['https://public'] };
  assert.equal(rpcUrlFor(evm, {}), 'https://public');
  assert.equal(rpcUrlFor(evm, { EVM_RPC_4663: 'https://mine' }), 'https://mine');
  assert.equal(
    rpcUrlFor({ family: 'solana', rpc: ['https://p'] }, { SOLANA_RPC: 'https://s' }),
    'https://s',
  );
});

test('isRateLimit ignores result-set-too-large answers and numbers that merely contain 429', () => {
  assert.ok(
    !isRateLimit(
      new Error(
        'eth_getLogs: {"code":-32000,"message":"block range too large: 94294290-94299289"}',
      ),
    ),
  );
  assert.ok(!isRateLimit(new Error('query returned more than 10000 results')));
  assert.ok(!isRateLimit(new Error('tx 0x4290000000000000000000000000000000000000 not found')));
  assert.ok(isRateLimit(new Error('HTTP 429')));
  assert.ok(isRateLimit({ code: -32005, message: 'x' }));
  assert.ok(isRateLimit(new Error('{"code":429,"message":"Too Many Requests"}')));
});

test('makeRpc concurrency allows N requests in flight and never more', async () => {
  let inFlight = 0;
  let peak = 0;
  const fetch = async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight--;
    return jsonResponse({ jsonrpc: '2.0', id: 1, result: 1 });
  };
  const rpc = makeRpc('http://x', { fetch, concurrency: 3 });
  await Promise.all(Array.from({ length: 8 }, () => rpc('m')));
  assert.equal(peak, 3);
  const serial = makeRpc('http://x', { fetch, concurrency: 1 });
  peak = 0;
  await Promise.all([serial('a'), serial('b'), serial('c')]);
  assert.equal(peak, 1);
});
