// Fan-out of one alert to console + Telegram + Discord + generic webhook. All optional, all best-effort.
// An alert is { title, lines, links, buttons?, payload? }; buttons become a Telegram inline keyboard.
import { sleep } from '../lib/rpc.mjs';
import { escapeHtml } from '../lib/text.mjs';

export { escapeHtml };

const allLinks = (alert) => [...(alert.links || []), ...(alert.buttons || [])];

/** Renders an alert as plain text (console, webhook logs). */
export function renderText(alert) {
  const links = allLinks(alert).map((l) => `${l.text}: ${l.url}`);
  return [alert.title, ...alert.lines, ...links].join('\n');
}

/** Renders an alert as Telegram HTML (buttons go to the keyboard, not the text). */
export function renderTelegram(alert) {
  const links = (alert.links || [])
    .map((l) => `<a href="${l.url}">${escapeHtml(l.text)}</a>`)
    .join(' · ');
  return `<b>${escapeHtml(alert.title)}</b>\n${alert.lines.map(escapeHtml).join('\n')}\n${links}`;
}

/** Telegram inline keyboard for alert.buttons (rows of three), or undefined. */
export function telegramKeyboard(alert, perRow = 3) {
  const buttons = (alert.buttons || []).map((b) => ({ text: b.text, url: b.url }));
  if (!buttons.length) return undefined;
  const rows = [];
  for (let i = 0; i < buttons.length; i += perRow) rows.push(buttons.slice(i, i + perRow));
  return { inline_keyboard: rows };
}

/** Renders an alert as Discord markdown. */
export function renderDiscord(alert) {
  const links = allLinks(alert)
    .map((l) => `[${l.text}](<${l.url}>)`)
    .join(' · ');
  return `**${alert.title}**\n${alert.lines.join('\n')}\n${links}`;
}

/**
 * @param {object} [opts]  tokens default to env TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID, DISCORD_WEBHOOK, WEBHOOK_URL
 * @param {Function} [opts.fetch]  injectable for tests
 */
export function makeNotifier(opts = {}) {
  const {
    telegramToken = process.env.TELEGRAM_BOT_TOKEN,
    telegramChat = process.env.TELEGRAM_CHAT_ID,
    discordWebhook = process.env.DISCORD_WEBHOOK,
    webhook = process.env.WEBHOOK_URL,
    log = console.log,
    fetch: fetchImpl = globalThis.fetch,
  } = opts;

  /**
   * POSTs JSON; one retry after Telegram's retry_after on 429. Never throws.
   * @returns {Promise<{ ok: boolean, status: number, text: string }>}  status 0 = network error
   */
  async function post(url, body, retry = true) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return { ok: true, status: res.status, text: '' };
      const text = await res.text();
      if (res.status === 429 && retry) {
        const wait = Number(/"retry_after":\s*(\d+)/.exec(text)?.[1] || 3);
        await sleep(Math.min(wait, 30) * 1000);
        return post(url, body, false);
      }
      log(`[notify] ${new URL(url).host} ${res.status} ${text.slice(0, 200)}`);
      return { ok: false, status: res.status, text };
    } catch (err) {
      log(`[notify] ${err.message}`);
      return { ok: false, status: 0, text: err.message };
    }
  }

  const telegramUrl = () => `https://api.telegram.org/bot${telegramToken}/sendMessage`;

  /** Sends HTML text to one Telegram chat; resolves to the post() result (ok: false without a token). */
  async function telegramText(chat, html, extra = {}) {
    if (!telegramToken) return { ok: false, status: 0, text: 'no TELEGRAM_BOT_TOKEN' };
    return post(telegramUrl(), {
      chat_id: chat,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      text: html,
      ...extra,
    });
  }

  return {
    telegramText,
    /** Sends one alert (with keyboard) to one Telegram chat. */
    telegram: (chat, alert) =>
      telegramText(chat, renderTelegram(alert), { reply_markup: telegramKeyboard(alert) }),
    /**
     * Sends one alert to every configured sink.
     * @param {{ title: string, lines: string[], links: {text: string, url: string}[],
     *   buttons?: {text: string, url: string}[], payload?: object }} alert
     */
    async send(alert) {
      log('\n' + renderText(alert));
      const jobs = [];
      if (telegramToken && telegramChat) {
        jobs.push(
          telegramText(telegramChat, renderTelegram(alert), {
            reply_markup: telegramKeyboard(alert),
          }),
        );
      }
      if (discordWebhook) jobs.push(post(discordWebhook, { content: renderDiscord(alert) }));
      if (webhook) {
        jobs.push(
          post(webhook, {
            ...alert.payload,
            title: alert.title,
            lines: alert.lines,
            links: alert.links,
            buttons: alert.buttons,
            ts: new Date().toISOString(),
          }),
        );
      }
      await Promise.all(jobs);
    },
  };
}
