// Every script must be importable without side effects (no network, no writes, no process.exit).
import { test } from 'node:test';
import assert from 'node:assert/strict';

for (const script of [
  'validate',
  'build',
  'site',
  'verify-onchain',
  'fetch-idl',
  'fixtures',
  'liveness',
]) {
  test(`scripts/${script}.mjs is side-effect free on import`, async () => {
    const mod = await import(`../scripts/${script}.mjs`);
    assert.ok(mod, 'imported');
  });
}
test('detector/index.mjs and mcp/server.mjs are side-effect free on import', async () => {
  assert.ok(await import('../detector/index.mjs'));
  assert.ok(await import('../mcp/server.mjs'));
});
