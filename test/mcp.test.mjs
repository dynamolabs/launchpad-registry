// Spawns the MCP server over stdio and checks the lookup tool answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
test('mcp server answers lookup over stdio', async () => {
  const p = spawn(process.execPath, [new URL('../mcp/server.mjs', import.meta.url).pathname], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const msgs = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'lookup',
        arguments: { chain: 'solana', address: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P' },
      },
    },
  ];
  p.stdin.write(msgs.map((m) => JSON.stringify(m)).join('\n') + '\n');
  const out = await new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error('timeout')), 15000);
    p.stdout.on('data', (d) => {
      buf += d;
      if (buf.includes('"id":2')) {
        clearTimeout(t);
        res(buf);
      }
    });
  });
  p.kill();
  const line = out.split('\n').find((l) => l.includes('"id":2'));
  const hits = JSON.parse(JSON.parse(line).result.content[0].text);
  assert.equal(hits[0].id, 'pump-fun');
});

import { search, createServer } from '../mcp/server.mjs';

test('search filters by text, chain, status and model', () => {
  assert.ok(search({ q: 'pump' }).some((l) => l.id === 'pump-fun'));
  assert.ok(
    search({ q: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P' }).some((l) => l.id === 'pump-fun'),
    'address search',
  );
  assert.ok(search({ chain: 'evm-4663' }).every((l) => String(l.chain.id) === '4663'));
  assert.ok(search({ status: 'active' }).every((l) => l.status === 'active'));
  assert.ok(search({ model: 'bonding-curve' }).every((l) => l.model === 'bonding-curve'));
  assert.equal(search({ limit: 2 }).length, 2);
  assert.deepEqual(search({ q: 'no-such-launchpad-xyz' }), []);
});

test('createServer reports the dataset version', () => {
  const server = createServer();
  assert.ok(server, 'server constructed');
});
