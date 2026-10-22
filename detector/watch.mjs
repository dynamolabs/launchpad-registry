// Watchlist: forward every launch of a *registered* launchpad to whoever asked for it, with buy buttons.
// The threshold alerts ("unknown launchpad") stay as they are; this is the second feed on top of them.
//   per chat   Telegram users pick launchpads with /watch, /unwatch, /watching (state.watch.chats)
//   broadcast  `--watch pump-fun,bags` or `--watch all` sends to every configured sink (console, Discord, …)
// Pure helpers + fan-out; the Telegram command loop is in telegram.mjs.
import { buyLinks, byId, forChain } from '../index.mjs';
import { escapeHtml, splitList } from '../lib/text.mjs';

/** Buy buttons under a launch card, in order (ids from registry/trade-links.json). */
export const DEFAULT_BUTTONS = [
  'trojan',
  'based',
  'gmgn-telegram',
  'bonkbot',
  'axiom',
  'dexscreener',
];

/** Roles that credit a launch when the address is merely an *account* of the tx (not a program). */
export const CONFIG_ROLES = ['partner-config', 'platform-config'];

/** Queued Telegram sends beyond this are dropped oldest-first (a stalled bot must not eat memory). */
export const MAX_QUEUE = 5000;
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

const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * Launchpad by id, name, alias or website domain (case/punctuation-insensitive: "pump.fun",
 * "PumpFun", "pangea.trade" all work); null when nothing matches exactly.
 */
export function resolveLaunchpad(query, launchpads) {
  const raw = String(query || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const q = norm(raw);
  if (!q) return null;
  return (
    launchpads.find((l) => l.id === raw) ||
    launchpads.find(
      (l) => norm(l.name) === q || norm(l.id) === q || (l.aliases || []).some((a) => norm(a) === q),
    ) ||
    launchpads.find((l) => host(l.website) === raw.replace(/^www\./, '')) ||
    null
  );
}

/** Launchpads whose id, name or domain contains the query, or is contained in it (for "did you mean"). */
export const suggestLaunchpads = (query, launchpads) => {
  const q = norm(query);
  if (!q) return [];
  const near = (s) => s && (s.includes(q) || (s.length >= 4 && q.includes(s)));
  return launchpads.filter(
    (l) => near(norm(l.id)) || near(norm(l.name)) || near(norm(host(l.website).split('.')[0])),
  );
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
export function handleCommand({ text, chat, watchlist, launchpads, chain, repoUrl, onRequest }) {
  const c = parseCommand(text);
  if (!c) return null;
  const notFound = (arg) => {
    const hints = suggestLaunchpads(arg, launchpads).slice(0, 5);
    if (hints.length)
      return `Unknown launchpad "${escapeHtml(arg)}". Did you mean: ${hints.map(show).join(', ')}?`;
    onRequest?.(arg, chat);
    const issue = repoUrl
      ? `${repoUrl}/issues/new?template=new-launchpad.md&title=${encodeURIComponent(`[${chain.dir}] ${arg}`)}`
      : null;
    return (
      `"${escapeHtml(arg)}" is not in the registry yet (ids: /launchpads). ` +
      `The detector flags every program that launches tokens, so once it is added it can be watched here. ` +
      (issue ? `Ask for it: <a href="${issue}">add ${escapeHtml(arg)} to the registry</a>` : '')
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
 * Registered launchpad ids owning any of these addresses, restricted to `roles` when given;
 * role `other` (shared DEX programs) never credits.
 */
export function creditedIds(registry, dir, addresses, roles) {
  const ids = new Set();
  for (const address of addresses || []) {
    for (const owner of registry.lookup?.(dir, address) || []) {
      if (owner.role === 'other') continue;
      if (roles && !roles.includes(owner.role)) continue;
      ids.add(owner.id);
    }
  }
  return [...ids];
}

/** A frontend built on another entry (`builtOn`) wins over its base: a Bags launch is Bags, not Meteora DBC. */
export function preferFrontends(ids) {
  const set = new Set(ids);
  const bases = new Set([...set].map((id) => byId(id)?.builtOn).filter(Boolean));
  return [...set].filter((id) => !bases.has(id));
}

/**
 * Launchpads credited with a launch: any launch role for the programs / entrypoints / hooks of the tx,
 * partner / platform configs for its plain accounts (Bags, Jupiter Studio… on Meteora DBC).
 */
export const launchpadIdsOf = (registry, dir, { programs = [], accounts = [] }) =>
  preferFrontends([
    ...creditedIds(registry, dir, programs),
    ...creditedIds(registry, dir, accounts, CONFIG_ROLES),
  ]);

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

/**
 * Builds the launch fan-out for one chain. Sends are queued and drained by one worker, so a slow
 * Telegram never stalls the chain cursor; `idle()` resolves once the queue is empty.
 * @param {object} p
 * @param {object} p.chain        entry from registry/chains.json
 * @param {object} p.state        detector/state.mjs (watch lists live under state.watch)
 * @param {object} p.notify       detector/notify.mjs
 * @param {object} p.registry     detector/registry.mjs (lookup) — the live, refreshed address index
 * @param {string[]} [p.broadcast]  launchpad ids / names (or 'all') sent to every configured sink
 * @param {string} [p.ref]        referral code for the buy buttons (env TRADE_REF)
 * @param {string[]} [p.apps]     button ids (env BUY_BUTTONS, comma list)
 * @param {object[]} [p.launchpads]  registry entries of this chain (names, aliases, websites)
 * @returns {{ watchlist, broadcast, onLaunch, command, idle }}
 */
export function createWatch({
  chain,
  state,
  notify,
  registry,
  log = console.log,
  broadcast = [],
  ref = process.env.TRADE_REF,
  apps = splitList(process.env.BUY_BUTTONS),
  launchpads = forChain(chain.dir),
  repoUrl = 'https://github.com/dynamolabs/launchpad-registry',
}) {
  const s = state.get();
  s.watch ??= {};
  const watchlist = createWatchlist(s.watch);
  const entries = new Map(launchpads.map((l) => [l.id, l]));
  if (!apps.length) apps = DEFAULT_BUTTONS;

  // --watch names are resolved like /watch (id, name, alias); unknown ones are reported, not silently ignored
  const broadcastIds = [];
  for (const want of broadcast) {
    const l = want.toLowerCase() === 'all' ? { id: 'all' } : resolveLaunchpad(want, launchpads);
    if (l) broadcastIds.push(l.id);
    else log(`[watch] --watch ${want}: no such launchpad on ${chain.name} (see /launchpads)`);
  }
  const everything = broadcastIds.includes('all');

  // ---- send queue: one worker, dead chats are unsubscribed on 403 / "chat not found"
  const queue = [];
  let draining = Promise.resolve();
  let running = false;
  async function drain() {
    while (queue.length) {
      const job = queue.shift();
      try {
        if (job.chat == null) {
          await notify.send(job.alert);
          continue;
        }
        const res = await notify.telegram(job.chat, job.alert);
        if (
          res &&
          !res.ok &&
          (res.status === 403 || /chat not found|deactivated/i.test(res.text))
        ) {
          watchlist.clear(job.chat);
          state.touch();
          log(`[watch] chat ${job.chat} unsubscribed: ${res.status} ${res.text.slice(0, 80)}`);
        }
      } catch (err) {
        log(`[watch] chat ${job.chat ?? '-'}: ${err.message}`);
      }
    }
  }
  function enqueue(job) {
    queue.push(job);
    if (queue.length > MAX_QUEUE) {
      queue.splice(0, queue.length - MAX_QUEUE);
      log(`[watch] send queue full, dropped the oldest cards`);
    }
    if (!running) {
      running = true;
      draining = drain().finally(() => {
        running = false;
      });
    }
  }

  /**
   * One launch: the registered programs of its tx, every account of its tx, and the token.
   * Credits it, dedupes per token, and queues one card per sink / chat.
   * @param {object} launch
   * @param {string[]} launch.programs   registered program ids / entrypoints / hooks of the tx
   * @param {string[]} [launch.accounts]  every account of the tx (partner / platform configs live here)
   * @param {{ address: string, symbol?: string, name?: string, creator?: string }} launch.token
   */
  async function onLaunch({ programs, accounts = [], token }) {
    const ids = launchpadIdsOf(registry, chain.dir, { programs, accounts });
    if (!ids.length || !state.markSeen(`launch:${token.address}`)) return;
    // a launchpad merged upstream but not in this package yet still gets a card under its id
    const entry = (id) => entries.get(id) || { id, name: id };
    const cards = new Map(
      ids.map((id) => [id, buildLaunchAlert({ chain, launchpad: entry(id), token, ref, apps })]),
    );
    const broadcastId = everything ? ids[0] : ids.find((id) => broadcastIds.includes(id));
    if (broadcastId) enqueue({ alert: cards.get(broadcastId) });
    const targets = new Map(); // chat → first matching card
    for (const id of ids)
      for (const chat of watchlist.watchers(id))
        if (!targets.has(chat)) targets.set(chat, cards.get(id));
    for (const [chat, alert] of targets) enqueue({ chat, alert });
    state.touch();
  }

  return {
    watchlist,
    broadcast: broadcastIds,
    onLaunch,
    /** Resolves once every queued card has been sent. */
    idle: () => draining,
    /** Telegram command → HTML reply or null. */
    command: (text, chat) => {
      const reply = handleCommand({
        text,
        chat,
        watchlist,
        launchpads,
        chain,
        repoUrl,
        // unknown names are logged so maintainers see which launchpads people ask for
        onRequest: (name, from) => {
          s.watch.requests ??= {};
          s.watch.requests[name] = (s.watch.requests[name] || 0) + 1;
          log(`[watch] request for "${name}" from chat ${from} (${s.watch.requests[name]}×)`);
        },
      });
      if (reply) state.touch();
      return reply;
    },
  };
}
