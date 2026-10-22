import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollCommands } from '../detector/telegram.mjs';
import { createMemoryState, silent } from './helpers.mjs';

/** Telegram stand-in: one getUpdates answer per call, records sendMessage bodies. */
function fakeTelegram(batches) {
  const calls = [];
  let i = 0;
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ method: url.split('/').pop(), body });
    if (url.endsWith('/getUpdates')) {
      const batch = batches[i++] ?? { ok: true, result: [] };
      return new Response(JSON.stringify(batch), { status: batch.ok ? 200 : 409 });
    }
    return new Response('{"ok":true}', { status: 200 });
  };
  return { fetch, calls };
}

const update = (id, chat, text) => ({ update_id: id, message: { chat: { id: chat }, text } });

test('pollCommands answers commands, advances the offset and skips chats outside the allow list', async () => {
  const state = createMemoryState();
  const tg = fakeTelegram([
    { ok: true, result: [update(9, 1, '/watch stale')] }, // backlog from before this start
    {
      ok: true,
      result: [
        update(10, 1, '/watch pump-fun'),
        update(11, 2, '/watch pump-fun'),
        update(12, 1, 'hello'),
        { update_id: 13, message: { chat: { id: 1 } } },
      ],
    },
  ]);
  const replies = [];
  await pollCommands({
    token: 'T',
    state,
    command: (text, chat) => (text.startsWith('/') ? `${chat}:${text}` : null),
    reply: async (chat, html) => replies.push({ chat, html }),
    allow: ['1'],
    fetch: tg.fetch,
    log: silent,
    maxRounds: 2,
  });
  assert.deepEqual(
    replies,
    [{ chat: 1, html: '1:/watch pump-fun' }],
    'the stale command is skipped',
  );
  assert.equal(state.get().watch.offset, 14);
  assert.deepEqual(tg.calls[0].body, { allowed_updates: ['message'], offset: -1, timeout: 0 });
  assert.equal(tg.calls[1].body.offset, 10, 'first real poll starts after the backlog');
  assert.equal(tg.calls[2].body.offset, 14, 'second poll starts after the last update');
});

test('pollCommands keeps a persisted offset and starts at 0 without a backlog', async () => {
  const state = createMemoryState({ watch: { offset: 5 } });
  const tg = fakeTelegram([{ ok: true, result: [] }]);
  const run = (st, f) =>
    pollCommands({
      token: 'T',
      state: st,
      command: () => null,
      reply: async () => {},
      fetch: f,
      log: silent,
      maxRounds: 1,
    });
  await run(state, tg.fetch);
  assert.equal(tg.calls[0].body.offset, 5, 'a persisted offset skips the drain');
  const fresh = createMemoryState();
  const tg2 = fakeTelegram([
    { ok: true, result: [] },
    { ok: true, result: [] },
  ]);
  await run(fresh, tg2.fetch);
  assert.equal(fresh.get().watch.offset, 0);
});

test('pollCommands logs a 409 (second poller) and keeps going', async () => {
  const state = createMemoryState();
  const logs = [];
  const tg = fakeTelegram([
    { ok: true, result: [] },
    { ok: false, description: 'Conflict: terminated by other getUpdates' },
  ]);
  const t0 = Date.now();
  await pollCommands({
    token: 'T',
    state,
    command: () => null,
    reply: async () => {},
    fetch: tg.fetch,
    log: (m) => logs.push(m),
    maxRounds: 1,
  });
  assert.ok(
    logs.some((l) => /409 .*another process/.test(l)),
    logs.join('|'),
  );
  assert.ok(Date.now() - t0 >= 4000, 'backs off before the next poll');
});
