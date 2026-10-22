// Long-polls Telegram getUpdates and answers the watch commands (/watch, /unwatch, /watching, …).
// One poller per bot token: Telegram answers 409 to a second one.
import { sleep } from '../lib/rpc.mjs';

/**
 * @param {object} p
 * @param {string} p.token          bot token
 * @param {object} p.state          detector/state.mjs; the update offset is kept in state.watch.offset
 * @param {(text: string, chat: string|number) => string|null} p.command   from createWatch().command
 * @param {(chat: string|number, html: string) => Promise<void>} p.reply   from makeNotifier().telegramText
 * @param {string[]} [p.allow]      chat ids allowed to use commands; empty = everyone
 * @param {Function} [p.log]
 * @param {Function} [p.fetch]      injectable (tests)
 * @param {number} [p.timeoutS=25]  long-poll timeout
 * @param {number} [p.maxRounds]    stop after N polls (tests)
 */
export async function pollCommands({
  token,
  state,
  command,
  reply,
  allow = [],
  log = console.log,
  fetch: fetchImpl = globalThis.fetch,
  timeoutS = 25,
  maxRounds = Infinity,
}) {
  const s = state.get();
  s.watch ??= {};
  const allowed = new Set(allow.map(String));
  for (let round = 0; round < maxRounds; round++) {
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/getUpdates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          offset: s.watch.offset || 0,
          timeout: timeoutS,
          allowed_updates: ['message'],
        }),
        signal: AbortSignal.timeout((timeoutS + 10) * 1000),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.ok) {
        log(
          `[telegram] getUpdates ${res.status} ${json.description || ''}${
            res.status === 409 ? ' (another process polls this bot token)' : ''
          }`,
        );
        await sleep(5000);
        continue;
      }
      for (const update of json.result || []) {
        s.watch.offset = update.update_id + 1;
        state.touch();
        const text = update.message?.text;
        const chat = update.message?.chat?.id;
        if (!text || chat == null) continue;
        if (allowed.size && !allowed.has(String(chat))) continue;
        const answer = command(text, chat);
        if (answer) await reply(chat, answer);
      }
    } catch (err) {
      log(`[telegram] ${err.message}`);
      await sleep(5000);
    }
  }
}
