import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWatchlist,
  resolveLaunchpad,
  parseCommand,
  handleCommand,
  launchpadIdsOf,
  buildLaunchAlert,
  createWatch,
  DEFAULT_BUTTONS,
} from '../detector/watch.mjs';
import { forChain, byId } from '../index.mjs';
import { createMemoryState } from './helpers.mjs';

const chain = {
  dir: 'solana',
  family: 'solana',
  name: 'Solana',
  explorer: 'https://solscan.io',
  dexscreenerId: 'solana',
};
const launchpads = forChain('solana');
const MINT = 'CDamKWeSQ5CS8s6tm5aDdw9fC3tpwEHAgNGrCCWppump';

test('watchlist adds, removes, lists and finds watchers (including "all")', () => {
  const store = {};
  const w = createWatchlist(store);
  assert.equal(w.add(1, 'pump-fun'), true);
  assert.equal(w.add(1, 'pump-fun'), false, 'no duplicates');
  assert.equal(w.add('2', 'all'), true);
  assert.deepEqual(w.list(1), ['pump-fun']);
  assert.deepEqual(w.watchers('pump-fun').sort(), ['1', '2']);
  assert.deepEqual(w.watchers('bags'), ['2'], 'all matches every launchpad');
  assert.equal(w.remove(1, 'bags'), false);
  assert.equal(w.remove(1, 'pump-fun'), true);
  assert.deepEqual(w.list(1), [], 'empty chats are dropped');
  assert.equal(w.size(), 1);
  assert.equal(w.clear('2'), 1);
  assert.deepEqual(store.chats, {});
});

test('resolveLaunchpad matches id, name and aliases loosely but not substrings', () => {
  assert.equal(resolveLaunchpad('pump-fun', launchpads).id, 'pump-fun');
  assert.equal(resolveLaunchpad('Pump.fun', launchpads).id, 'pump-fun');
  assert.equal(resolveLaunchpad('PUMPFUN', launchpads).id, 'pump-fun');
  assert.equal(resolveLaunchpad('Raydium LaunchLab', launchpads).id, 'raydium-launchlab');
  assert.equal(resolveLaunchpad('fun', launchpads), null);
  assert.equal(resolveLaunchpad('', launchpads), null);
});

test('parseCommand strips the bot suffix and keeps the argument', () => {
  assert.deepEqual(parseCommand('/watch@registry_bot pump.fun'), { cmd: 'watch', arg: 'pump.fun' });
  assert.deepEqual(parseCommand('/WATCHING'), { cmd: 'watching', arg: '' });
  assert.equal(parseCommand('hello'), null);
});

test('handleCommand drives the watchlist and answers in Telegram HTML', () => {
  const watchlist = createWatchlist({});
  const run = (text) => handleCommand({ text, chat: 7, watchlist, launchpads, chain });
  assert.match(run('/start'), /launchpads on Solana/);
  assert.match(run('/launchpads'), /<code>pump-fun<\/code>/);
  assert.match(run('/watch'), /Usage/);
  assert.match(run('/watch pump.fun'), /✅ Watching pump\.fun <code>pump-fun<\/code>/);
  assert.match(run('/watch pump-fun'), /Already watching/);
  assert.match(run('/watch pump'), /Did you mean: pump\.fun <code>pump-fun<\/code>\?/);
  assert.match(run('/watch zzz'), /Unknown launchpad "zzz"\. See \/launchpads/);
  assert.match(run('/watching'), /pump-fun/);
  assert.match(run('/unwatch bags'), /was not on your list/);
  assert.match(run('/unwatch pump-fun'), /Removed pump\.fun/);
  assert.match(run('/watching'), /empty/);
  assert.match(run('/watch all'), /every registered launchpad/);
  assert.deepEqual(watchlist.list(7), ['all']);
  assert.match(run('/unwatch all'), /Removed 1 launchpad\./);
  assert.equal(run('/settings'), null, 'foreign commands are ignored');
  assert.equal(run('just text'), null);
  assert.match(run('/watch <b>'), /&lt;b&gt;/, 'user input is escaped');
});

test('launchpadIdsOf credits launch roles only and prefers a frontend over its base', () => {
  const registry = {
    lookup: (_dir, a) =>
      ({
        PUMP: [{ id: 'pump-fun', role: 'program' }],
        DBC: [{ id: 'meteora-dbc', role: 'program' }],
        BAGSCFG: [{ id: 'bags', role: 'partner-config' }],
        RAY: [{ id: 'pump-fun', role: 'other' }],
      })[a] || [],
  };
  assert.deepEqual(launchpadIdsOf(registry, 'solana', ['PUMP', 'RAY', 'X']), ['pump-fun']);
  assert.deepEqual(launchpadIdsOf(registry, 'solana', ['RAY']), []);
  assert.equal(byId('bags').builtOn, 'meteora-dbc', 'fixture assumption');
  assert.deepEqual(launchpadIdsOf(registry, 'solana', ['DBC', 'BAGSCFG']), ['bags']);
  assert.deepEqual(
    launchpadIdsOf({ known: () => true }, 'solana', ['DBC']),
    [],
    'no lookup → none',
  );
});

test('buildLaunchAlert carries explorer/dexscreener links and buy buttons with the referral', () => {
  const token = { address: MINT, symbol: 'KIM', name: 'Kimchi', creator: 'Payer' };
  const alert = buildLaunchAlert({ chain, launchpad: byId('pump-fun'), token, ref: 'me' });
  assert.equal(alert.title, '🆕 pump.fun: KIM (Kimchi)');
  assert.equal(alert.links[0].url, `https://solscan.io/token/${MINT}`);
  assert.equal(alert.links[1].url, `https://dexscreener.com/solana/${MINT}`);
  assert.ok(alert.lines.some((l) => l === `mint: ${MINT}`));
  const ids = alert.buttons.map((b) => b.text);
  assert.deepEqual(ids, ['Trojan', 'Based', 'GMGN (Telegram)', 'BONKbot', 'Axiom', 'DEX Screener']);
  assert.equal(alert.buttons[0].url, `https://t.me/solana_trojanbot?start=r-me-${MINT}`);
  assert.equal(alert.payload.kind, 'launch');

  const noRef = buildLaunchAlert({ chain, launchpad: byId('pump-fun'), token: { address: MINT } });
  assert.equal(noRef.title, '🆕 pump.fun: new token');
  assert.ok(!noRef.buttons.some((b) => b.text === 'Trojan'), 'apps that need a ref are dropped');
  assert.ok(
    noRef.buttons.some((b) => b.text === 'Based'),
    'tokenNoRef fallback is used',
  );

  const custom = buildLaunchAlert({
    chain,
    launchpad: byId('pump-fun'),
    token: { address: MINT },
    apps: ['dexscreener', 'nope'],
  });
  assert.deepEqual(
    custom.buttons.map((b) => b.text),
    ['DEX Screener'],
  );
  assert.equal(DEFAULT_BUTTONS.length, 6);
});

function collect() {
  const sent = [];
  const chats = [];
  return {
    sent,
    chats,
    notify: {
      send: async (alert) => sent.push(alert),
      telegram: async (chat, alert) => chats.push({ chat, alert }),
    },
  };
}

test('createWatch routes a launch to the chats watching it, once per chat, and to broadcast sinks', async () => {
  const state = createMemoryState();
  const { sent, chats, notify } = collect();
  const watch = createWatch({ chain, state, notify, broadcast: ['bags'], ref: 'me', apps: [] });
  watch.command('/watch pump.fun', 'A');
  watch.command('/watch all', 'B');
  watch.command('/watch bags', 'C');
  watch.command('/watch meteora-dbc', 'C');

  await watch.onLaunch({ ids: ['pump-fun'], token: { address: 'M1', symbol: 'ONE' } });
  assert.deepEqual(
    chats.map((c) => c.chat),
    ['A', 'B'],
  );
  assert.equal(sent.length, 0, 'pump-fun is not in the broadcast list');
  assert.equal(chats[0].alert.buttons.length, DEFAULT_BUTTONS.length, 'empty apps → defaults');

  await watch.onLaunch({ ids: ['bags', 'meteora-dbc'], token: { address: 'M2' } });
  assert.equal(sent.length, 1, 'broadcast for bags');
  const second = chats.slice(2);
  assert.deepEqual(
    second.map((c) => c.chat).sort(),
    ['B', 'C'],
    'C watches both ids but gets one card',
  );
  assert.equal(second.find((c) => c.chat === 'C').alert.payload.launchpad, 'bags');

  await watch.onLaunch({ ids: ['pump-fun'], token: { address: 'M1' } });
  assert.equal(chats.length, 4, 'a token is reported once');

  await watch.onLaunch({ ids: ['not-registered'], token: { address: 'M3' } });
  assert.equal(chats.length, 4);
  assert.deepEqual(state.get().watch.chats.C, ['bags', 'meteora-dbc'], 'persisted in state');
});

test('createWatch keeps sending to other chats when one Telegram send throws', async () => {
  const state = createMemoryState();
  const logs = [];
  const got = [];
  const notify = {
    send: async () => {},
    telegram: async (chat) => {
      if (chat === 'bad') throw new Error('blocked');
      got.push(chat);
    },
  };
  const watch = createWatch({ chain, state, notify, log: (m) => logs.push(m), apps: [] });
  watch.command('/watch all', 'bad');
  watch.command('/watch all', 'good');
  await watch.onLaunch({ ids: ['pump-fun'], token: { address: 'M' } });
  assert.deepEqual(got, ['good']);
  assert.ok(logs.some((l) => /blocked/.test(l)));
});
