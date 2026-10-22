// Fan-out of one alert to console + Telegram + Discord + generic webhook. All optional, all best-effort.

/** HTML-escapes a value for Telegram's HTML parse mode. */
export const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Renders an alert as plain text (console, Discord without markup). */
export function renderText(alert) {
  const links = alert.links.map((l) => `${l.text}: ${l.url}`);
  return [alert.title, ...alert.lines, ...links].join('\n');
}

/** Renders an alert as Telegram HTML. */
export function renderTelegram(alert) {
  const links = alert.links.map((l) => `<a href="${l.url}">${escapeHtml(l.text)}</a>`).join(' · ');
  return `<b>${escapeHtml(alert.title)}</b>\n${alert.lines.map(escapeHtml).join('\n')}\n${links}`;
}

/** Renders an alert as Discord markdown. */
export function renderDiscord(alert) {
  const links = alert.links.map((l) => `[${l.text}](<${l.url}>)`).join(' · ');
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

  async function post(url, body) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok)
        log(`[notify] ${new URL(url).host} ${res.status} ${(await res.text()).slice(0, 200)}`);
    } catch (err) {
      log(`[notify] ${err.message}`);
    }
  }

  return {
    /**
     * @param {{ title: string, lines: string[], links: {text: string, url: string}[], payload?: object }} alert
     */
    async send(alert) {
      log('\n' + renderText(alert));
      const jobs = [];
      if (telegramToken && telegramChat) {
        jobs.push(
          post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
            chat_id: telegramChat,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            text: renderTelegram(alert),
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
            ts: new Date().toISOString(),
          }),
        );
      }
      await Promise.all(jobs);
    },
  };
}
