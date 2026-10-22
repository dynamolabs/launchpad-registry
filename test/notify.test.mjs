import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeNotifier,
  renderTelegram,
  renderDiscord,
  renderText,
  escapeHtml,
} from '../detector/notify.mjs';

const alert = {
  title: 'Unregistered <launchpad>',
  lines: ['a & b', 'c'],
  links: [{ text: 'explorer', url: 'https://x/1' }],
  payload: { chain: 'evm-1', address: '0x1' },
};

test('renderers escape HTML for Telegram and leave other formats alone', () => {
  assert.equal(escapeHtml('<a&b>'), '&lt;a&amp;b&gt;');
  assert.equal(
    renderTelegram(alert),
    '<b>Unregistered &lt;launchpad&gt;</b>\na &amp; b\nc\n<a href="https://x/1">explorer</a>',
  );
  assert.equal(
    renderDiscord(alert),
    '**Unregistered <launchpad>**\na & b\nc\n[explorer](<https://x/1>)',
  );
  assert.equal(renderText(alert), 'Unregistered <launchpad>\na & b\nc\nexplorer: https://x/1');
});

test('send fans out to every configured sink and swallows failures', async () => {
  const posts = [];
  const fetch = async (url, init) => {
    posts.push({ url, body: JSON.parse(init.body) });
    if (url.includes('discord')) return new Response('nope', { status: 400 });
    if (url.includes('down')) throw new Error('ECONNREFUSED');
    return new Response('{}', { status: 200 });
  };
  const logs = [];
  const notifier = makeNotifier({
    telegramToken: 'T',
    telegramChat: '42',
    discordWebhook: 'https://discord/x',
    webhook: 'https://down/hook',
    fetch,
    log: (m) => logs.push(m),
  });
  await notifier.send(alert);
  assert.equal(posts.length, 3);
  const tg = posts.find((p) => p.url.includes('api.telegram.org'));
  assert.equal(tg.body.chat_id, '42');
  assert.equal(tg.body.parse_mode, 'HTML');
  const hook = posts.find((p) => p.url.includes('down'));
  assert.equal(hook.body.address, '0x1');
  assert.ok(hook.body.ts);
  assert.ok(logs.some((l) => /discord.* 400/.test(l)));
  assert.ok(logs.some((l) => /ECONNREFUSED/.test(l)));
});

test('send with nothing configured only logs', async () => {
  const logs = [];
  const notifier = makeNotifier({
    telegramToken: '',
    telegramChat: '',
    discordWebhook: '',
    webhook: '',
    fetch: () => {
      throw new Error('must not fetch');
    },
    log: (m) => logs.push(m),
  });
  await notifier.send(alert);
  assert.equal(logs.length, 1);
});
