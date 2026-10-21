// EVM engine: every ERC-20 mint-from-zero → its tx.to entrypoint (or Uniswap V4 hook) → count per window → alert on unknown.
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', ZERO32 = '0x' + '0'.repeat(64);
const DEFAULT_IGNORE = ['0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789', '0x0000000071727de22e5e9d8baf0edac6f37da032', '0x4337084d9e255ff0702461cf8895ce9e3b5ff108', '0xca11bde05977b3631167028862be2a173976ca11', '0x4e59b44847b379578588920ca78fbf26c0b4956c', '0x914d7fec6aac8cd542e72bca78b30650d45643d7']; // ERC-4337 EntryPoint v0.6/0.7/0.8, Multicall3, CREATE2 deployers
const V4_INIT = '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
export async function runEvm({ chain, rpcUrl, registry, notify, state, cfg, log }) {
  const dir = chain.dir, explorer = chain.explorer?.replace(/\/$/, '');
  const rpc = async (method, params) => { const r = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const j = await r.json(); if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error).slice(0, 200)}`); return j.result; };
  const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']).catch(() => null);
  const decodeStr = h => { try { if (!h || h === '0x') return ''; const b = Buffer.from(h.slice(2), 'hex'); if (b.length === 32) return b.toString('utf8').replace(/\0+$/, ''); const off = Number(BigInt('0x' + b.subarray(0, 32).toString('hex'))), len = Number(BigInt('0x' + b.subarray(off, off + 32).toString('hex'))); return b.subarray(off + 32, off + 32 + len).toString('utf8'); } catch { return ''; } };
  const s = state.get(); s.entrypoints ??= {}; s.seen ??= {};
  const ignore = new Set([...DEFAULT_IGNORE, ...(cfg.ignore || []).map(a => a.toLowerCase())]);
  let head = Number(await rpc('eth_blockNumber')), cursor = s.cursor ?? head - 1;
  log(`[evm-${chain.id}] head ${head}, cursor ${cursor}, window ${cfg.windowMin} min, min ${cfg.minTokens} tokens, v4 ${cfg.v4PoolManager || '-'}`);
  const bump = async (key, kind, tok) => {
    if (ignore.has(key.split(':')[1])) return;
    const now = Date.now(), e = s.entrypoints[key] ??= { kind, first: now, tokens: [], alerted: false };
    e.tokens.push({ a: tok.address, s: tok.symbol, t: now, c: tok.creator }); e.tokens = e.tokens.filter(x => now - x.t < cfg.windowMin * 60e3); state.touch();
    const addr = key.split(':')[1];
    if (e.alerted || e.tokens.length < cfg.minTokens || registry.known(dir, addr)) return;
    e.alerted = true; state.touch();
    const samples = e.tokens.slice(-5).map(x => `${x.s || '?'} ${x.a}`).join('\n');
    await notify.send({
      title: `🚨 Unregistered launchpad on ${chain.name}`,
      lines: [`${kind === 'hook' ? 'Uniswap V4 hook' : 'entrypoint (tx.to)'}: ${addr}`, `${e.tokens.length} tokens in ${cfg.windowMin} min, first ${new Date(e.first).toISOString().slice(0, 16)}Z`, `latest creator: ${e.tokens.at(-1).c}`, 'sample tokens:', samples],
      links: [explorer ? { text: 'explorer', url: `${explorer}/address/${addr}` } : null, chain.dexscreenerId ? { text: 'dexscreener', url: `https://dexscreener.com/${chain.dexscreenerId}/${e.tokens.at(-1).a}` } : null, { text: 'add to registry', url: `${cfg.repoUrl}/issues/new?template=new-launchpad.md&title=${encodeURIComponent(`[${dir}] ${addr}`)}` }].filter(Boolean),
      payload: { chain: dir, kind, address: addr, count: e.tokens.length, tokens: e.tokens },
    });
  };
  for (;;) {
    try {
      head = Number(await rpc('eth_blockNumber'));
      if (head <= cursor) { await sleep(cfg.pollMs); continue; }
      const to = Math.min(head, cursor + cfg.chunk);
      const range = { fromBlock: '0x' + (cursor + 1).toString(16), toBlock: '0x' + to.toString(16) };
      const mints = await rpc('eth_getLogs', [{ ...range, topics: [TRANSFER, ZERO32] }]);
      const byTx = new Map();
      for (const l of mints) { if (l.topics.length !== 3) continue; const a = l.address.toLowerCase(); if (s.seen[a]) continue; s.seen[a] = 1; state.touch(); (byTx.get(l.transactionHash) ?? byTx.set(l.transactionHash, new Set()).get(l.transactionHash)).add(a); }
      for (const [h, toks] of byTx) {
        const tx = await rpc('eth_getTransactionByHash', [h]); if (!tx) continue;
        const prev = '0x' + (Number(tx.blockNumber) - 1).toString(16);
        for (const a of toks) {
          const before = await rpc('eth_getCode', [a, prev]).catch(() => null); if (before && before !== '0x') continue; // contract existed already → LP/receipt token, not a launch
          const dec = await call(a, '0x313ce567'); if (!dec || dec === '0x') continue; // not ERC-20 (NFTs etc.)
          const symbol = decodeStr(await call(a, '0x95d89b41')).slice(0, 24);
          const tok = { address: a, symbol, creator: tx.from.toLowerCase() };
          if (tx.to) await bump(`to:${tx.to.toLowerCase()}`, 'entrypoint', tok); else log(`[evm-${chain.id}] direct deploy ${symbol} ${a} by ${tx.from} (no entrypoint)`);
        }
      }
      if (cfg.v4PoolManager) {
        const inits = await rpc('eth_getLogs', [{ ...range, address: cfg.v4PoolManager, topics: [V4_INIT] }]);
        for (const l of inits) { const hook = '0x' + l.data.slice(2 + 64 * 2 + 24, 2 + 64 * 3); if (/^0x0{40}$/.test(hook)) continue;
          const cur = [l.topics[2], l.topics[3]].map(t => '0x' + t.slice(26)); const tokAddr = cur.find(c => !cfg.quoteTokens.includes(c)) || cur[1];
          const symbol = decodeStr(await call(tokAddr, '0x95d89b41')).slice(0, 24);
          const tx = await rpc('eth_getTransactionByHash', [l.transactionHash]);
          await bump(`hook:${hook}`, 'hook', { address: tokAddr, symbol, creator: tx?.from?.toLowerCase() || '?' }); }
      }
      cursor = to; s.cursor = cursor; state.touch();
      if (to < head) continue;
    } catch (e) { const rl = /429|rate|limit/i.test(e.message); log(`[evm-${chain.id}] ${e.message}${rl ? ' (backing off)' : ''}`); await sleep(cfg.pollMs * (rl ? 6 : 2)); }
    await sleep(cfg.pollMs);
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
