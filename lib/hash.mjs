// Launch-signature helpers: Anchor discriminators and EVM event topics.
import { sha256 } from '@noble/hashes/sha256';
import { keccak_256 } from '@noble/hashes/sha3';

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const utf8 = (s) => new TextEncoder().encode(s);

/** First 8 bytes of sha256("global:<name>"), as hex: the Anchor instruction discriminator. */
export const anchorDiscriminator = (name) => hex(sha256(utf8(`global:${name}`)).slice(0, 8));

/**
 * Canonical form of a Solidity event signature: no parameter names, no `indexed`, no spaces.
 * "Transfer(address indexed from, address indexed to, uint256 value)" → "Transfer(address,address,uint256)"
 */
export function canonicalSignature(signature) {
  return signature
    .replace(/\s+indexed\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .replace(/\(\s+/, '(')
    .replace(/\s+\)/, ')')
    .replace(/ \w+(?=,|\))/g, '');
}

/** keccak256 of the canonical signature, 0x-prefixed: the event's topic0. */
export const topic0 = (signature) => '0x' + hex(keccak_256(utf8(canonicalSignature(signature))));

export { hex };
