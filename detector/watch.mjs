// Watchlist: forward every launch of a *registered* launchpad to whoever asked for it, with buy buttons.
// The threshold alerts ("unknown launchpad") stay as they are; this is the second feed on top of them.
//   per chat   Telegram users pick launchpads with /watch, /unwatch, /watching (state.watch.chats)
//   broadcast  `--watch pump-fun,bags` or `--watch all` sends to every configured sink (console, Discord, …)
// Pure helpers + fan-out; the Telegram command loop is in telegram.mjs.
import { buyLinks, byId, forChain } from '../index.mjs';

/** Buy buttons under a launch card, in order (ids from registry/trade-links.json). */
export const DEFAULT_BUTTONS = [
  'trojan',
  'based',
  'gmgn-telegram',
  'bonkbot',
  'axiom',
  'dexscreener',
];

export const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Per-chat watch lists, persisted inside the detector state file (`state.watch.chats`).
 * A list may hold launchpad ids or the word `all`.
 */
export function createWatchlist(store) {
  store.chats ??= {};
  const key = (chat) => String(chat);
  return {
    add(chat, id) {
      const list = (store.chats[key(chat)] ??= []);
      if (list.includes(id)) return false;
      list.push(id);
      return true;
    },
    remove(chat, id) {
      const list = store.chats[key(chat)] || [];
      const i = list.indexOf(id);
      if (i < 0) return false;
      list.splice(i, 1);
      if (!list.length) delete store.chats[key(chat)];
      return true;
    },
    clear(chat) {
      const n = (store.chats[key(chat)] || []).length;
      delete store.chats[key(chat)];
      return n;
    },
    list: (chat) => [...(store.chats[key(chat)] || [])],
    /** chat ids that watch this launchpad, or everything. */
    watchers: (id) =>
      Object.entries(store.chats)
        .filter(([, list]) => list.includes(id) || list.includes('all'))
        .map(([chat]) => chat),
    size: () => Object.keys(store.chats).length,
  };
}

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Launchpad by id, name or alias (case/punctuation-insensitive); null when nothing matches exactly. */
export function resolveLaunchpad(query, launchpads) {
  const q = norm(query);
  if (!q) return null;
  return (
    launchpads.find((l) => l.id === String(query).trim().toLowerCase()) ||
    launchpads.find(
      (l) => norm(l.name) === q || norm(l.id) === q || (l.aliases || []).some((a) => norm(a) === q),
    ) ||
    null
  );
}

/** Launchpads whose id or name contains the query (for "did you mean"). */
export const suggestLaunchpads = (query, launchpads) => {
  const q = norm(query);
  return q ? launchpads.filter((l) => norm(l.id).includes(q) || norm(l.name).includes(q)) : [];
};

/** `/watch@bot pump.fun` → { cmd: 'watch', arg: 'pump.fun' }; null for ordinary text. */
export function parseCommand(text) {
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(String(text || '').trim());
  return m ? { cmd: m[1].toLowerCase(), arg: (m[2] || '').trim() } : null;
}

const show = (l) => `${escapeHtml(l.name)} <code>${l.id}</code>`;

function helpText(chain, launchpads) {
  return [
    `<b>launchpad-registry watch bot · ${escapeHtml(chain.name)}</b>`,
    `Pick launchpads and every new token they launch lands here, with buy buttons.`,
    '',
    `/launchpads — the ${launchpads.length} registered launchpads on ${escapeHtml(chain.name)}`,
    '/watch &lt;id or name&gt; — follow one (e.g. /watch pump.fun), /watch all for everything',
    '/unwatch &lt;id&gt; — stop, /unwatch all clears the list',
    '/watching — your list',
    '',
    'Listing is not endorsement. Verify before you trade.',
  ].join('\n');
}

/**
 * Answers one chat command. Returns HTML for Telegram, or null when the text is not a command
 * this bot owns (so a shared group chat is not spammed).
 * @param {{ text: string, chat: string|number, watchlist: object, launchpads: object[], chain: object }} p
 */
export function handleCommand({ text, chat, watchlist, launchpads, chain }) {
  const c = parseCommand(text);
  if (!c) return null;
  const notFound = (arg) => {
    const hints = suggestLaunchpads(arg, launchpads).slice(0, 5);
    return (
      `Unknown launchpad "${escapeHtml(arg)}".` +
      (hints.length ? ` Did you mean: ${hints.map(show).join(', ')}?` : ' See /launchpads.')
    );
  };
  switch (c.cmd) {
    case 'start':
    case 'help':
      return helpText(chain, launchpads);
    case 'launchpads':
    case 'list':
      return (
        `<b>Registered launchpads on ${escapeHtml(chain.name)}</b> (use the id with /watch)\n` +
        launchpads
          .map((l) => `• ${show(l)}${l.status === 'active' ? '' : ` (${l.status})`}`)
          .join('\n')
      );
    case 'watch': {
      if (!c.arg) return 'Usage: /watch &lt;id or name&gt; (see /launchpads), or /watch all.';
      if (c.arg.toLowerCase() === 'all') {
        watchlist.add(chat, 'all');
        return `✅ Watching every registered launchpad on ${escapeHtml(chain.name)}. /unwatch all to stop.`;
      }
      const l = resolveLaunchpad(c.arg, launchpads);
      if (!l) return notFound(c.arg);
      return watchlist.add(chat, l.id)
        ? `✅ Watching ${show(l)}: every new token lands here. /unwatch ${l.id} to stop.`
        : `Already watching ${show(l)}.`;
    }
    case 'unwatch': {
      if (!c.arg) return 'Usage: /unwatch &lt;id&gt; or /unwatch all. Your list: /watching';
      if (c.arg.toLowerCase() === 'all') {
        const n = watchlist.clear(chat);
        return n
          ? `Removed ${n} launchpad${n > 1 ? 's' : ''}. Nothing is watched now.`
          : 'Your list was already empty.';
      }
      const l = resolveLaunchpad(c.arg, launchpads);
      if (!l) return notFound(c.arg);
      return watchlist.remove(chat, l.id)
        ? `Removed ${show(l)}.`
        : `${show(l)} was not on your list. Your list: /watching`;
    }
    case 'watching': {
      const ids = watchlist.list(chat);
      if (!ids.length)
        return 'Your list is empty. Add one with /watch &lt;id&gt; (ids: /launchpads).';
      const names = ids.map((id) =>
        id === 'all' ? '<b>all</b> registered launchpads' : show(byId(id) || { id, name: id }),
      );
      return `<b>Watching</b>\n${names.map((n) => `• ${n}`).join('\n')}\n/unwatch &lt;id&gt; to remove one.`;
    }
    default:
      return null;
  }
}

/**
 * Registered launchpads that own any of these addresses (launch roles only: shared DEX programs are
 * role `other` and never credited). A frontend built on another entry (`builtOn`) wins over its base,
 * so a Bags launch is reported as Bags, not as Meteora DBC.
 */
export function launchpadIdsOf(registry, dir, addresses) {
  const ids = new Set();
  for (const address of addresses || []) {
    for (const owner of registry.lookup?.(dir, address) || []) {
      if (owner.role !== 'other') ids.add(owner.id);
    }
  }
  const bases = new Set([...ids].map((id) => byId(id)?.builtOn).filter(Boolean));
  return [...ids].filter((id) => !bases.has(id));
}

/** The card for one launch on a registered launchpad. */
export function buildLaunchAlert({ chain, launchpad, token, ref, apps = DEFAULT_BUTTONS }) {
  const explorer = chain.explorer?.replace(/\/$/, '');
  const solana = chain.family === 'solana';
  const label = token.symbol
    ? `${token.symbol}${token.name && token.name !== token.symbol ? ` (${token.name})` : ''}`
    : 'new token';
  const links = [
    explorer && { text: 'explorer', url: `${explorer}/token/${token.address}` },
    chain.dexscreenerId && {
      text: 'dexscreener',
      url: `https://dexscreener.com/${chain.dexscreenerId}/${token.address}`,
    },
    launchpad.website && { text: launchpad.name, url: launchpad.website },
  ].filter(Boolean);
  const links2 = new Map(
    buyLinks({ chain: chain.dir, token: token.address, ref }).map((l) => [l.id, l]),
  );
  const buttons = apps
    .map((id) => links2.get(id))
    .filter(Boolean)
    .map((l) => ({ text: l.name, url: l.url }));
  return {
    title: `🆕 ${launchpad.name}: ${label}`,
    lines: [
      `${solana ? 'mint' : 'token'}: ${token.address}`,
      token.creator && `creator: ${token.creator}`,
      `launchpad: ${launchpad.id} · ${chain.name}`,
    ].filter(Boolean),
    links,
    buttons,
    payload: { chain: chain.dir, kind: 'launch', launchpad: launchpad.id, token },
  };
}

const splitList = (value) =>
  (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Builds the launch fan-out for one chain.
 * @param {object} p
 * @param {object} p.chain        entry from registry/chains.json
 * @param {object} p.state        detector/state.mjs (watch lists live under state.watch)
 * @param {object} p.notify       detector/notify.mjs
 * @param {string[]} [p.broadcast]  launchpad ids (or 'all') sent to every configured sink
 * @param {string} [p.ref]        referral code for the buy buttons (env TRADE_REF)
 * @param {string[]} [p.apps]     button ids (env BUY_BUTTONS, comma list)
 * @param {object[]} [p.launchpads]  registry entries of this chain
 * @returns {{ watchlist, onLaunch, command }}
 */
export function createWatch({
  chain,
  state,
  notify,
  log = console.log,
  broadcast = [],
  ref = process.env.TRADE_REF,
  apps = splitList(process.env.BUY_BUTTONS),
  launchpads = forChain(chain.dir),
}) {
  const s = state.get();
  s.watch ??= {};
  const watchlist = createWatchlist(s.watch);
  const entries = new Map(launchpads.map((l) => [l.id, l]));
  const everything = broadcast.includes('all');
  if (!apps.length) apps = DEFAULT_BUTTONS;

  /**
   * One launch, credited to one or more registered launchpads.
   * @param {{ ids: string[], token: { address: string, symbol?: string, name?: string, creator?: string } }} launch
   */
  async function onLaunch({ ids, token }) {
    if (!state.markSeen(`launch:${token.address}`)) return;
    const targets = new Map(); // chat → alert (one card per chat even when two launchpads match)
    for (const id of new Set(ids)) {
      const launchpad = entries.get(id);
      if (!launchpad) continue;
      const alert = buildLaunchAlert({ chain, launchpad, token, ref, apps });
      if (everything || broadcast.includes(id)) await notify.send(alert);
      for (const chat of watchlist.watchers(id)) if (!targets.has(chat)) targets.set(chat, alert);
    }
    for (const [chat, alert] of targets) {
      try {
        await notify.telegram(chat, alert);
      } catch (err) {
        log(`[watch] chat ${chat}: ${err.message}`);
      }
    }
    state.touch();
  }

  return {
    watchlist,
    onLaunch,
    /** Telegram command → HTML reply or null. */
    command: (text, chat) => {
      const reply = handleCommand({ text, chat, watchlist, launchpads, chain });
      if (reply) state.touch();
      return reply;
    },
  };
}
