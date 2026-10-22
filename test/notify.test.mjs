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

import { telegramKeyboard } from '../detector/notify.mjs';

test('buttons become a Telegram inline keyboard and plain links elsewhere', async () => {
  const withButtons = {
    ...alert,
    buttons: [1, 2, 3, 4].map((i) => ({ text: `b${i}`, url: `https://b/${i}` })),
  };
  assert.deepEqual(
    telegramKeyboard(withButtons).inline_keyboard.map((r) => r.length),
    [3, 1],
  );
  assert.equal(telegramKeyboard(alert), undefined);
  assert.match(renderDiscord(withButtons), /\[b4\]\(<https:\/\/b\/4>\)/);
  assert.match(renderText(withButtons), /b4: https:\/\/b\/4/);
  assert.ok(!renderTelegram(withButtons).includes('b4'), 'keyboard, not text');

  const posts = [];
  const notifier = makeNotifier({
    telegramToken: 'T',
    telegramChat: '42',
    discordWebhook: '',
    webhook: '',
    fetch: async (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return new Response('{}', { status: 200 });
    },
    log: () => {},
  });
  await notifier.send(withButtons);
  assert.equal(posts[0].body.reply_markup.inline_keyboard[0][0].url, 'https://b/1');
  await notifier.telegram('99', withButtons);
  assert.equal(posts[1].body.chat_id, '99');
  assert.equal(posts[1].body.reply_markup.inline_keyboard.length, 2);
  await notifier.telegramText('7', '<b>hi</b>');
  assert.deepEqual(posts[2].body, {
    chat_id: '7',
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    text: '<b>hi</b>',
  });
});

test('post retries once after a Telegram 429 using retry_after', async () => {
  let calls = 0;
  const notifier = makeNotifier({
    telegramToken: 'T',
    telegramChat: '42',
    discordWebhook: '',
    webhook: '',
    fetch: async () =>
      ++calls === 1
        ? new Response('{"ok":false,"parameters":{"retry_after":0}}', { status: 429 })
        : new Response('{}', { status: 200 }),
    log: () => {},
  });
  await notifier.send(alert);
  assert.equal(calls, 2);
});
