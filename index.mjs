// launchpad-registry: programmatic access to the built dataset in dist/.
import { readFileSync } from 'node:fs';

const load = (name) => JSON.parse(readFileSync(new URL(`./dist/${name}`, import.meta.url), 'utf8'));
const data = load('launchpads.json');

/** All launchpad entries (shape: schema/launchpad.schema.json). */
export const launchpads = data.launchpads;

/** Chains that have a registry directory (registry/chains.json). */
export const chains = load('chains.json');

/** Trading bots and terminals that alert bots link to (shape: schema/trade-link.schema.json). */
export const tradeLinks = load('trade-links.json').links;

/**
 * Buy-button URLs for one token: every trade link that supports `chain` and whose template can be
 * filled from the inputs. Apps that need a referral code are skipped unless `ref` is given (or they
 * have a `tokenNoRef` variant); Photon needs `pool`. Returns [{ id, name, kind, url, verified }].
 */
function chainDirOf(ref) {
  if (!ref || typeof ref !== 'object') return ref;
  const c = chains.find((x) => x.family === ref.family && String(x.id) === String(ref.id));
  return c && c.dir;
}

export function buyLinks({ chain, token, ref, pool } = {}) {
  const dir = typeof chain === 'string' ? chain : chainDirOf(chain);
  const c = chains.find((x) => x.dir === dir);
  if (!c || !token) return [];
  const vars = { token, ref, pool, dexscreenerId: c.dexscreenerId };
  const fill = (tpl) => {
    let missing = false;
    const url = tpl.replace(/\{(token|ref|pool|dexscreenerId)\}/g, (_, k) => {
      if (vars[k] == null || vars[k] === '') missing = true;
      return String(vars[k] ?? '');
    });
    return missing ? null : url;
  };
  const out = [];
  for (const app of tradeLinks) {
    if (!app.chains.includes(dir) || !app.links.token) continue;
    const url = fill(app.links.token) || (app.links.tokenNoRef && fill(app.links.tokenNoRef));
    if (url) out.push({ id: app.id, name: app.name, kind: app.kind, url, verified: app.verified });
  }
  return out;
}

/** Dataset version, build date and per-chain counts. */
export const meta = {
  version: data.version,
  generated: data.generated,
  count: data.count,
  chains: data.chains,
};

const dirOf = (family, id) =>
  chains.find((c) => c.family === family && String(c.id) === String(id))?.dir;

const dirOfRef = (chain) => (typeof chain === 'string' ? chain : dirOf(chain.family, chain.id));

const normalize = (family, address) =>
  family === 'evm' ? String(address).toLowerCase() : String(address);

// reverse index "dir:address" → [{ launchpad, role, label }]
const index = new Map();
for (const launchpad of launchpads) {
  const dir = dirOf(launchpad.chain.family, launchpad.chain.id);
  for (const contract of launchpad.contracts) {
    const key = `${dir}:${normalize(launchpad.chain.family, contract.address)}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ launchpad, role: contract.role, label: contract.label });
  }
}

/** Entry by id, or undefined. */
export const byId = (id) => launchpads.find((l) => l.id === id);

/**
 * Entries on one chain.
 * @param {string | { family: string, id: string | number }} chain  registry dir ("evm-4663") or { family, id }
 */
export function forChain(chain) {
  const dir = dirOfRef(chain);
  return launchpads.filter((l) => dirOf(l.chain.family, l.chain.id) === dir);
}

/**
 * Reverse lookup: which launchpad(s) own this address on this chain. EVM addresses are case-insensitive.
 * @returns {{ launchpad: object, role: string, label?: string }[]}  [] when unknown
 */
export function lookup(chain, address) {
  const dir = dirOfRef(chain);
  const family = chains.find((c) => c.dir === dir)?.family;
  return index.get(`${dir}:${normalize(family, address)}`) ?? [];
}

/** true when the address belongs to any registered launchpad on that chain. */
export const isKnown = (chain, address) => lookup(chain, address).length > 0;

/** Entries currently launching tokens. */
export const active = () => launchpads.filter((l) => l.status === 'active');

/** Branded frontends built on a multi-tenant program, e.g. frontendsOf('raydium-launchlab'). */
export const frontendsOf = (id) => launchpads.filter((l) => l.builtOn === id);

export default {
  launchpads,
  chains,
  meta,
  byId,
  forChain,
  lookup,
  isKnown,
  active,
  frontendsOf,
  tradeLinks,
  buyLinks,
};
