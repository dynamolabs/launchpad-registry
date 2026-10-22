// Solana engine: polls the Token Metadata program's signatures, keeps transactions that initialise a
// fungible mint (decimals > 0), and counts every non-system outer program of those transactions.
// HTTP RPC only, no gRPC. Token-2022 mints that skip Metaplex are not covered yet.
import { makeRpc, sleep } from '../lib/rpc.mjs';
import { createTracker, migrateLegacyKeys } from './tracker.mjs';

export const METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

/** Programs that appear in every token transaction and are never a launchpad. */
export const BASE_IGNORE = [
  '11111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'ComputeBudget111111111111111111111111111111',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
  'AddressLookupTab1e1111111111111111111111111',
  'BPFLoaderUpgradeab1e11111111111111111111111',
  METADATA_PROGRAM,
];

/** Outer + inner instructions of a jsonParsed transaction, flattened. */
export const allInstructions = (tx) => [
  ...tx.transaction.message.instructions,
  ...(tx.meta?.innerInstructions || []).flatMap((i) => i.instructions),
];

/**
 * The fungible mint initialised in this transaction (initializeMint / initializeMint2 with decimals > 0),
 * or null. decimals 0 means NFT and is skipped.
 * @returns {null | { mint: string, decimals: number }}
 */
export function findFungibleMint(tx) {
  if (!tx?.meta || tx.meta.err) return null;
  const ix = allInstructions(tx).find(
    (i) => i.parsed && /^initializeMint2?$/.test(i.parsed.type) && i.parsed.info?.decimals > 0,
  );
  return ix ? { mint: ix.parsed.info.mint, decimals: ix.parsed.info.decimals } : null;
}

/** Distinct outer program ids of a transaction minus the ignore set. */
export function outerPrograms(tx, ignore = BASE_IGNORE) {
  const ignored = new Set(ignore);
  return [...new Set(tx.transaction.message.instructions.map((i) => i.programId))].filter(
    (p) => !ignored.has(p),
  );
}

/** First signer (fee payer) of a jsonParsed transaction. */
export const feePayer = (tx) => tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey;

/** Builds the alert for one unknown program. */
export function buildAlert({ chain, hit, cfg }) {
  const latest = hit.tokens.at(-1);
  const issueTitle = encodeURIComponent(`[solana] ${hit.address}`);
  return {
    title: '🚨 Unregistered launchpad program on Solana',
    lines: [
      `program: ${hit.address}`,
      `${hit.count} new tokens in ${cfg.windowMin} min, first ${new Date(hit.first).toISOString().slice(0, 16)}Z`,
      `latest payer: ${latest.c}`,
      'sample mints:',
      ...hit.tokens.slice(-5).map((x) => x.a),
    ],
    links: [
      { text: 'solscan', url: `https://solscan.io/account/${hit.address}` },
      { text: 'dexscreener', url: `https://dexscreener.com/solana/${latest.a}` },
      {
        text: 'add to registry',
        url: `${cfg.repoUrl}/issues/new?template=new-launchpad.md&title=${issueTitle}`,
      },
    ],
    payload: {
      chain: chain.dir,
      kind: 'program',
      address: hit.address,
      count: hit.count,
      tokens: hit.tokens,
    },
  };
}

/**
 * Runs the Solana engine until the process exits. Same context shape as runEvm.
 * cfg: { windowMin, minTokens, pollMs, batch, ignore, repoUrl }
 */
export async function runSolana({
  chain,
  rpcUrl,
  registry,
  notify,
  state,
  cfg,
  log,
  rpc,
  maxRounds = Infinity,
}) {
  rpc ??= makeRpc(rpcUrl, { minIntervalMs: cfg.rpcIntervalMs ?? 120 });
  const s = state.get();
  s.entrypoints ??= {};
  if (migrateLegacyKeys(s.entrypoints) > 0) state.touch();
  const tracker = createTracker({
    state: s.entrypoints,
    windowMin: cfg.windowMin,
    minTokens: cfg.minTokens,
    isKnown: (address) => registry.known(chain.dir, address),
  });
  const ignore = [...BASE_IGNORE, ...(cfg.ignore || [])];

  // some RPCs reject maxSupportedTransactionVersion 1 (-32015); fall back to 0 once and remember
  let maxVersion = 1;
  async function getTransaction(signature) {
    const params = [
      signature,
      {
        encoding: 'jsonParsed',
        maxSupportedTransactionVersion: maxVersion,
        commitment: 'confirmed',
      },
    ];
    try {
      return await rpc('getTransaction', params);
    } catch (err) {
      if (maxVersion !== 0 && /-32015|version/i.test(err.message)) {
        maxVersion = 0;
        return getTransaction(signature);
      }
      throw err;
    }
  }

  /**
   * Marks the signature seen and moves the cursor only after it was fully processed,
   * so a failure is retried on the next poll instead of being lost.
   */
  async function processSignature(signature) {
    if (!s.seen[signature]) {
      const tx = await getTransaction(signature);
      const minted = findFungibleMint(tx);
      if (minted) {
        const token = { address: minted.mint, creator: feePayer(tx) };
        for (const programId of outerPrograms(tx, ignore)) {
          const hit = tracker.record('program', programId, token);
          if (hit) await notify.send(buildAlert({ chain, hit, cfg }));
        }
      }
      state.markSeen(signature);
    }
    newest = signature;
    s.cursor = signature;
    state.touch();
  }

  log(
    `[solana] polling ${METADATA_PROGRAM} every ${cfg.pollMs} ms, window ${cfg.windowMin} min, min ${cfg.minTokens}`,
  );
  let newest = s.cursor || null;

  for (let round = 0; round < maxRounds; round++) {
    try {
      const sigs = await rpc('getSignaturesForAddress', [
        METADATA_PROGRAM,
        { limit: cfg.batch, commitment: 'confirmed' },
      ]);
      const fresh = [];
      for (const x of sigs) {
        if (x.signature === newest) break;
        if (!x.err) fresh.push(x.signature);
      }
      for (const signature of fresh.reverse()) await processSignature(signature);
      if (sigs[0] && sigs[0].signature !== newest) {
        // every fresh signature processed (errored ones were skipped): cursor jumps to the batch head
        newest = sigs[0].signature;
        s.cursor = newest;
        state.touch();
      }
      if (round % 50 === 49 && tracker.prune() > 0) state.touch();
    } catch (err) {
      log(`[solana] ${err.message}`);
      await sleep(cfg.pollMs * 2);
    }
    await sleep(cfg.pollMs);
  }
}
