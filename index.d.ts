export type ChainFamily = 'solana' | 'evm';
export type Status = 'active' | 'inactive' | 'test' | 'unknown';
export type Model = 'bonding-curve' | 'direct-pool' | 'funding-round' | 'meta-launchpad' | 'other';
export type ContractRole =
  | 'program'
  | 'factory'
  | 'launcher'
  | 'hook'
  | 'curve'
  | 'router'
  | 'registry'
  | 'platform-config'
  | 'partner-config'
  | 'fee-collector'
  | 'deployer'
  | 'authority'
  | 'token'
  | 'other';

export interface Contract {
  address: string;
  role: ContractRole;
  label?: string;
  verified?: boolean;
  /** YYYY-MM-DD of the last on-chain check (scripts/verify-onchain.mjs --write) */
  checked?: string;
  notes?: string;
}

export interface Launch {
  kind: 'instruction' | 'event' | 'log' | 'calldata' | 'mint-only';
  name?: string;
  signature?: string;
  topic0?: string;
  selector?: string;
  discriminator?: string;
  tokenField?: string;
  creatorField?: string;
  notes?: string;
}

export interface TokenInfo {
  standard: 'spl' | 'token-2022' | 'erc20' | 'mixed';
  metadata?: string;
  metadataApi?: string;
  decimals?: number;
  addressPattern?: string;
}

export interface Graduation {
  target?: string;
  address?: string;
  threshold?: string;
  event?: string;
  notes?: string;
}

/** A real launch transaction proving the `launch` spec (scripts/fixtures.mjs). */
export interface Fixture {
  tx: string;
  token?: string;
  creator?: string;
  date?: string;
  note?: string;
}

export interface ExternalIds {
  codex?: string;
  solanatracker?: string;
  dexscreener?: string;
  gmgn?: string;
  jupiter?: string;
  dune?: string;
  defillama?: string;
  geckoterminal?: string;
}

export interface Launchpad {
  id: string;
  name: string;
  website?: string;
  socials?: { x?: string; telegram?: string; discord?: string; github?: string };
  chain: { family: ChainFamily; id: string | number };
  status: Status;
  firstSeen?: string;
  model: Model;
  /** id of the multi-tenant program this frontend runs on */
  builtOn?: string;
  contracts: Contract[];
  launch?: Launch;
  token: TokenInfo;
  graduation?: Graduation;
  quotes?: string[];
  tags?: string[];
  sources: string[];
  notes?: string;
  updated?: string;
  /** repo-relative path under icons/ */
  logo?: string;
  externalIds?: ExternalIds;
  /** YYYY-MM-DD of the last observed launch (weekly liveness job) */
  lastActivity?: string;
  fixtures?: Fixture[];
  /** repo-relative path of the IDL snapshot (Solana) */
  idl?: string;
  /** repo-relative path of the ABI fragment (EVM) */
  abi?: string;
}

export interface Chain {
  family: ChainFamily;
  id: string | number;
  name: string;
  dir: string;
  caip2?: string;
  nativeSymbol?: string;
  rpc?: string[];
  explorer?: string;
  dexscreenerId?: string;
  ignore?: string[];
  quoteTokens?: string[];
  maxLogRange?: number;
  notes?: string;
}

export interface Hit {
  launchpad: Launchpad;
  role: ContractRole;
  label?: string;
}

export type ChainRef = string | { family: ChainFamily; id: string | number };

export interface Meta {
  version: string;
  generated: string;
  count: number;
  chains: { family: ChainFamily; id: string | number; dir: string; name: string; count: number }[];
}

export const launchpads: Launchpad[];
export const chains: Chain[];
export const meta: Meta;
export function byId(id: string): Launchpad | undefined;
export function forChain(chain: ChainRef): Launchpad[];
export function lookup(chain: ChainRef, address: string): Hit[];
export function isKnown(chain: ChainRef, address: string): boolean;
export function active(): Launchpad[];
export function frontendsOf(id: string): Launchpad[];

declare const _default: {
  launchpads: Launchpad[];
  chains: Chain[];
  meta: Meta;
  byId: typeof byId;
  forChain: typeof forChain;
  lookup: typeof lookup;
  isKnown: typeof isKnown;
  active: typeof active;
  frontendsOf: typeof frontendsOf;
};
export default _default;
