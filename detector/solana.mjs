// Solana engine: new Metaplex metadata accounts → outer program ids of that tx → count per program per window → alert on unknown.
// RPC-only (HTTP polling of getSignaturesForAddress on the Token Metadata program); no gRPC needed. Token-2022 mints that skip Metaplex are not covered yet.
const METADATA = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
const BASE_IGNORE = ['11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'ComputeBudget111111111111111111111111111111', 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo', METADATA, 'AddressLookupTab1e1111111111111111111111111', 'BPFLoaderUpgradeab1e11111111111111111111111'];
export async function runSolana({ chain, rpcUrl, registry, notify, state, cfg, log }) {
  const dir = chain.dir;
  const rpc = async (method, params) => { const r = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const j = await r.json(); if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error).slice(0, 200)}`); return j.result; };
  const s = state.get(); s.entrypoints ??= {}; s.seen ??= {};
  const ignore = new Set([...BASE_IGNORE, ...(cfg.ignore || [])]);
  let maxVer = 1;
  const getTx = async sig => { try { return await rpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: maxVer, commitment: 'confirmed' }]); } catch (e) { if (/-32015|version/i.test(e.message) && maxVer !== 0) { maxVer = 0; return getTx(sig); } throw e; } };
  log(`[solana] polling ${METADATA} every ${cfg.pollMs} ms, window ${cfg.windowMin} min, min ${cfg.minTokens}`);
  let until = s.cursor || null;
  for (;;) {
    try {
      const sigs = await rpc('getSignaturesForAddress', [METADATA, { limit: cfg.batch, commitment: 'confirmed' }]);
      const fresh = []; for (const x of sigs) { if (x.signature === until) break; if (!x.err) fresh.push(x.signature); }
      if (sigs[0]) { until = sigs[0].signature; s.cursor = until; state.touch(); }
      for (const sig of fresh.reverse()) {
        if (s.seen[sig]) continue; s.seen[sig] = 1; state.touch();
        const tx = await getTx(sig); if (!tx?.meta || tx.meta.err) continue;
        const msg = tx.transaction.message;
        // a fungible token birth = initializeMint(2) with decimals > 0 somewhere in the tx (outer or CPI); decimals 0 = NFT, skipped
        const parsedAll = [...msg.instructions, ...(tx.meta.innerInstructions || []).flatMap(i => i.instructions)];
        const mintIx = parsedAll.find(i => i.parsed && /^initializeMint2?$/.test(i.parsed.type));
        if (!mintIx || !(mintIx.parsed.info.decimals > 0)) continue;
        const mint = mintIx.parsed.info.mint;
        const outer = [...new Set(msg.instructions.map(i => i.programId).filter(p => !ignore.has(p)))];
        const signer = msg.accountKeys.find(k => k.signer)?.pubkey;
        for (const pid of outer) {
          const now = Date.now(), e = s.entrypoints[`prog:${pid}`] ??= { kind: 'program', first: now, tokens: [], alerted: false };
          e.tokens.push({ a: mint || sig, t: now, c: signer }); e.tokens = e.tokens.filter(x => now - x.t < cfg.windowMin * 60e3); state.touch();
          if (e.alerted || e.tokens.length < cfg.minTokens || registry.known(dir, pid)) continue;
          e.alerted = true; state.touch();
          await notify.send({
            title: '🚨 Unregistered launchpad program on Solana',
            lines: [`program: ${pid}`, `${e.tokens.length} new tokens in ${cfg.windowMin} min, first ${new Date(e.first).toISOString().slice(0, 16)}Z`, `latest payer: ${signer}`, 'sample mints:', e.tokens.slice(-5).map(x => x.a).join('\n')],
            links: [{ text: 'solscan', url: `https://solscan.io/account/${pid}` }, mint ? { text: 'dexscreener', url: `https://dexscreener.com/solana/${mint}` } : null, { text: 'add to registry', url: `${cfg.repoUrl}/issues/new?template=new-launchpad.md&title=${encodeURIComponent(`[solana] ${pid}`)}` }].filter(Boolean),
            payload: { chain: dir, kind: 'program', address: pid, count: e.tokens.length, tokens: e.tokens },
          });
        }
      }
    } catch (e) { log(`[solana] ${e.message}`); await sleep(cfg.pollMs * 2); }
    await sleep(cfg.pollMs);
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
