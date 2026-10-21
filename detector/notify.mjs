// Fan-out of one alert to console + Telegram + Discord + generic webhook. All optional, all best-effort.
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function makeNotifier(opts = {}) {
  const { telegramToken = process.env.TELEGRAM_BOT_TOKEN, telegramChat = process.env.TELEGRAM_CHAT_ID, discordWebhook = process.env.DISCORD_WEBHOOK, webhook = process.env.WEBHOOK_URL, log = console.log } = opts;
  async function post(url, body, headers = { 'content-type': 'application/json' }) {
    try { const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }); if (!r.ok) log(`[notify] ${new URL(url).host} ${r.status} ${(await r.text()).slice(0, 200)}`); }
    catch (e) { log(`[notify] ${e.message}`); }
  }
  return {
    esc,
    /** alert = { title, lines[], links[{text,url}], payload } */
    async send(alert) {
      log(`\n${alert.title}\n${alert.lines.join('\n')}\n${alert.links.map(l => `${l.text}: ${l.url}`).join('\n')}`);
      const jobs = [];
      if (telegramToken && telegramChat) jobs.push(post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        chat_id: telegramChat, parse_mode: 'HTML', disable_web_page_preview: true,
        text: `<b>${esc(alert.title)}</b>\n${alert.lines.map(esc).join('\n')}\n${alert.links.map(l => `<a href="${l.url}">${esc(l.text)}</a>`).join(' · ')}` }));
      if (discordWebhook) jobs.push(post(discordWebhook, { content: `**${alert.title}**\n${alert.lines.join('\n')}\n${alert.links.map(l => `[${l.text}](<${l.url}>)`).join(' · ')}` }));
      if (webhook) jobs.push(post(webhook, { ...alert.payload, title: alert.title, lines: alert.lines, links: alert.links, ts: new Date().toISOString() }));
      await Promise.all(jobs);
    }
  };
}
