// launchpad-registry — programmatic access to dist/ data.
import { readFileSync } from 'node:fs';
const load = f => JSON.parse(readFileSync(new URL(`./dist/${f}`, import.meta.url), 'utf8'));
const data = load('launchpads.json');
/** All launchpad entries (see schema/launchpad.schema.json). */
export const launchpads = data.launchpads;
/** Chains with a registry directory (registry/chains.json). */
export const chains = load('chains.json');
/** Build date + per-chain counts. */
export const meta = { generated: data.generated, count: data.count, chains: data.chains };
const dirOf = (family, id) => chains.find(c => c.family === family && String(c.id) === String(id))?.dir;
const norm = (family, a) => (family === 'evm' ? String(a).toLowerCase() : String(a));
const index = new Map();
for (const l of launchpads) for (const c of l.contracts) {
  const k = `${dirOf(l.chain.family, l.chain.id)}:${norm(l.chain.family, c.address)}`;
  if (!index.has(k)) index.set(k, []);
  index.get(k).push({ launchpad: l, role: c.role, label: c.label });
}
/** Entry by id, or undefined. */
export const byId = id => launchpads.find(l => l.id === id);
/** Entries on one chain. `chain` = { family, id } or a registry dir like "evm-4663". */
export const forChain = chain => { const dir = typeof chain === 'string' ? chain : dirOf(chain.family, chain.id); return launchpads.filter(l => dirOf(l.chain.family, l.chain.id) === dir); };
/** Reverse lookup: which launchpad(s) own this address on this chain. Returns [] when unknown. */
export const lookup = (chain, address) => { const dir = typeof chain === 'string' ? chain : dirOf(chain.family, chain.id); const fam = chains.find(c => c.dir === dir)?.family; return index.get(`${dir}:${norm(fam, address)}`) ?? []; };
/** true when the address belongs to any registered launchpad on that chain. */
export const isKnown = (chain, address) => lookup(chain, address).length > 0;
/** Entries currently launching tokens. */
export const active = () => launchpads.filter(l => l.status === 'active');
/** Frontends built on a given program id (e.g. frontendsOf('raydium-launchlab')). */
export const frontendsOf = id => launchpads.filter(l => l.builtOn === id);
export default { launchpads, chains, meta, byId, forChain, lookup, isKnown, active, frontendsOf };
