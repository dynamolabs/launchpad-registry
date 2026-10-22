// node examples/consumer.mjs [path-or-url-to-launchpads.json]
// Prints the active launchpads per chain and shows a reverse address lookup.
const src = process.argv[2] || new URL('../dist/launchpads.json', import.meta.url);
const data = src.startsWith?.('http')
  ? await (await fetch(src)).json()
  : JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(src, 'utf8')));
const byChain = {};
for (const l of data.launchpads) (byChain[`${l.chain.family}:${l.chain.id}`] ??= []).push(l);
for (const [chain, list] of Object.entries(byChain)) {
  console.log(`\n${chain}`);
  for (const l of list)
    console.log(
      `  ${l.status.padEnd(8)} ${l.id.padEnd(22)} ${l.model.padEnd(14)} ${l.contracts[0].address}${l.builtOn ? `  (on ${l.builtOn})` : ''}`,
    );
}
const idx = new Map();
for (const l of data.launchpads)
  for (const c of l.contracts)
    idx.set(
      `${l.chain.family}:${l.chain.id}:${l.chain.family === 'evm' ? c.address.toLowerCase() : c.address}`,
      { id: l.id, role: c.role },
    );
console.log(
  '\nlookup LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj →',
  idx.get('solana:mainnet-beta:LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj'),
);
