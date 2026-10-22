// Solana engine. Two sources, both HTTP-only (no gRPC):
//   blocks   (default) polls every confirmed block with getBlock and scans all transactions for an
//            initializeMint(2) with decimals > 0. Catches Token-2022 metadata-extension launches
//            (pump.fun and its clones) that never touch Metaplex. ~3 MB per block on jsonParsed.
//   metadata polls the Token Metadata program's signatures: cheap, but blind to Token-2022-only mints.
// Either way every non-system outer program of a launch tx is counted by the tracker.
import { makeRpc, sleep } from '../lib/rpc.mjs';
import { base58Decode } from '../lib/text.mjs';
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

/** Distinct program ids invoked via CPI (inner instructions) minus the ignore set. */
export function innerPrograms(tx, ignore = BASE_IGNORE) {
  const ignored = new Set(ignore);
  const ids = (tx.meta?.innerInstructions || []).flatMap((i) =>
    i.instructions.map((x) => x.programId),
  );
  return [...new Set(ids)].filter((p) => !ignored.has(p));
}

/** First signer (fee payer) of a jsonParsed transaction. */
export const feePayer = (tx) => tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey;

/** Every account the transaction touches (static keys + addresses loaded from lookup tables). */
export const accountKeys = (tx) => [
  ...tx.transaction.message.accountKeys.map((k) => k.pubkey),
  ...(tx.meta?.loadedAddresses?.writable || []),
  ...(tx.meta?.loadedAddresses?.readonly || []),
];

/** Borsh string (u32 LE length + utf8) at `offset`; null when the buffer is too short. */
function borshString(bytes, offset) {
  if (offset + 4 > bytes.length) return null;
  const len =
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24);
  if (len < 0 || len > 256 || offset + 4 + len > bytes.length) return null;
  const text = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 4 + len));
  return { value: text.replace(/\0+$/, '').trim(), next: offset + 4 + len };
}

/**
 * Name and symbol of a Metaplex `CreateMetadataAccount` (v1 0, v2 17, v3 33) instruction's data:
 * the (DataV2) struct starts with name and symbol right after the one-byte discriminator.
 */
export function metaplexMetadata(data) {
  const bytes = base58Decode(data);
  if (!bytes || ![0, 17, 33].includes(bytes[0])) return null;
  const name = borshString(bytes, 1);
  const symbol = name && borshString(bytes, name.next);
  return name && symbol ? { name: name.value, symbol: symbol.value } : null;
}

/** Trims name/symbol and drops the empty ones (launches with blank metadata are common). */
const clean = ({ name, symbol }) => {
  const out = {};
  if (name?.trim()) out.name = name.trim();
  if (symbol?.trim()) out.symbol = symbol.trim();
  return out;
};

/**
 * Name and symbol of the launched token, or {}: from a Token-2022 `initializeTokenMetadata`
 * (pump.fun and clones, jsonParsed by the RPC) or a Metaplex create-metadata instruction
 * (LaunchLab, letsbonk, Meteora DBC…; decoded from its raw data).
 */
export function tokenMetadata(tx) {
  const ixs = allInstructions(tx);
  const parsed = ixs.find((i) => i.parsed?.type === 'initializeTokenMetadata')?.parsed?.info;
  if (parsed) return clean({ name: parsed.name, symbol: parsed.symbol });
  for (const ix of ixs) {
    if (ix.programId !== METADATA_PROGRAM || !ix.data) continue;
    const meta = metaplexMetadata(ix.data);
    if (meta) return clean(meta);
  }
  return {};
}

/**
 * Fungible-mint births inside one jsonParsed block.
 * @returns {{ signature: string, mint: string, decimals: number, programs: string[],
 *   innerPrograms: string[], accounts: string[], payer: string, name?: string, symbol?: string }[]}
 */
export function scanBlock(block, ignore = BASE_IGNORE) {
  const out = [];
  for (const tx of block?.transactions || []) {
    const minted = findFungibleMint(tx);
    if (!minted) continue;
    out.push({
      signature: tx.transaction.signatures?.[0],
      mint: minted.mint,
      decimals: minted.decimals,
      programs: outerPrograms(tx, ignore),
      innerPrograms: innerPrograms(tx, ignore),
      accounts: accountKeys(tx),
      payer: feePayer(tx),
      ...tokenMetadata(tx),
    });
  }
  return out;
}

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
 * onLaunch (optional, from detector/watch.mjs) receives every launch that touches a registered program:
 * { programs: registered program ids in the tx, accounts: every account of the tx, token }.
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
  onLaunch,
  maxRounds = Infinity,
}) {
  rpc ??= makeRpc(rpcUrl, {
    minIntervalMs: cfg.rpcIntervalMs ?? 120,
    concurrency: cfg.source === 'metadata' ? 1 : cfg.concurrency || 3,
  });
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
   * Counts one birth. When any program in the tx (outer or CPI) is a registered launchpad, the birth
   * belongs to that launchpad: wrappers / bundlers that CPI into pump.fun are not launchpads themselves.
   */
  async function recordBirth({
    mint,
    payer,
    programs,
    innerPrograms: inner = [],
    accounts = [],
    name,
    symbol,
  }) {
    const token = { address: mint, creator: payer };
    // deduped: a launchpad can appear as the outer program and again as a CPI target in one tx
    const known = [...new Set([...programs, ...inner])].filter((p) => registry.known(chain.dir, p));
    for (const programId of known.length ? known : programs) {
      const hit = tracker.record('program', programId, token);
      if (hit) await notify.send(buildAlert({ chain, hit, cfg }));
    }
    // the watch feed credits the launch itself (partner / platform configs are plain accounts of the tx)
    if (onLaunch && known.length) {
      await onLaunch({ programs: known, accounts, token: { ...token, name, symbol } });
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
        await recordBirth({
          mint: minted.mint,
          payer: feePayer(tx),
          programs: outerPrograms(tx, ignore),
          innerPrograms: innerPrograms(tx, ignore),
          accounts: accountKeys(tx),
          ...tokenMetadata(tx),
        });
      }
      state.markSeen(signature);
    }
    s.cursor = signature;
    state.touch();
  }

  /** Source "metadata": new signatures on the Token Metadata program. */
  async function pollMetadata() {
    const sigs = await rpc('getSignaturesForAddress', [
      METADATA_PROGRAM,
      { limit: cfg.batch, commitment: 'confirmed' },
    ]);
    const fresh = [];
    for (const x of sigs) {
      if (x.signature === s.cursor) break;
      if (!x.err) fresh.push(x.signature);
    }
    for (const signature of fresh.reverse()) await processSignature(signature);
    if (sigs[0] && sigs[0].signature !== s.cursor) {
      // every fresh signature processed (errored ones were skipped): cursor jumps to the batch head
      s.cursor = sigs[0].signature;
      state.touch();
    }
  }

  // RPCs answer -32015 when they need a lower maxSupportedTransactionVersion; -32007/-32009 = slot skipped,
  // -32004 = block not yet available (retry later)
  async function getBlock(slot) {
    const params = () => [
      slot,
      {
        encoding: 'jsonParsed',
        transactionDetails: 'full',
        rewards: false,
        maxSupportedTransactionVersion: maxVersion,
        commitment: 'confirmed',
      },
    ];
    try {
      return { block: await rpc('getBlock', params()) };
    } catch (err) {
      if (maxVersion !== 0 && /-32015|version/i.test(err.message)) {
        maxVersion = 0;
        return getBlock(slot);
      }
      if (/-32007|-32009|skipped|missing/i.test(err.message)) return { skipped: true };
      if (/-32004|not available/i.test(err.message)) return { pending: true };
      throw err;
    }
  }

  /**
   * Source "blocks": every confirmed slot since the cursor, capped at cfg.maxLag slots behind the tip,
   * cfg.concurrency blocks fetched in parallel.
   */
  async function pollBlocks() {
    const head = Number(await rpc('getSlot', [{ commitment: 'confirmed' }]));
    if (s.slot == null) s.slot = head - 1;
    if (head - s.slot > cfg.maxLag) {
      log(
        `[solana] ${head - s.slot} slots behind, skipping to ${head - cfg.maxLag} (RPC too slow for every block)`,
      );
      s.slot = head - cfg.maxLag;
      state.touch();
    }
    // fetch up to cfg.concurrency blocks at once, but apply them strictly in slot order
    const width = Math.max(1, cfg.concurrency || 1);
    while (s.slot < head) {
      const slots = [];
      for (let slot = s.slot + 1; slot <= Math.min(head, s.slot + width); slot++) slots.push(slot);
      const results = await Promise.all(slots.map(getBlock));
      for (let i = 0; i < slots.length; i++) {
        const { block, skipped, pending } = results[i];
        if (pending) return; // confirmed tip not served yet; next round resumes here
        if (!skipped) {
          for (const birth of scanBlock(block, ignore)) await recordBirth(birth);
        }
        s.slot = slots[i];
        state.touch();
      }
    }
  }

  const source = cfg.source === 'metadata' ? 'metadata' : 'blocks';
  log(
    `[solana] source ${source}, poll ${cfg.pollMs} ms, window ${cfg.windowMin} min, min ${cfg.minTokens}${
      source === 'blocks' ? `, max lag ${cfg.maxLag} slots` : ''
    }`,
  );

  for (let round = 0; round < maxRounds; round++) {
    try {
      if (source === 'blocks') await pollBlocks();
      else await pollMetadata();
      if (round % 50 === 49 && tracker.prune() > 0) state.touch();
    } catch (err) {
      log(`[solana] ${err.message}`);
      await sleep(cfg.pollMs * 2);
    }
    await sleep(cfg.pollMs);
  }
}
