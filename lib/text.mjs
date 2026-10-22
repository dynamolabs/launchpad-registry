// Small text helpers shared by the detector modules.

/** HTML-escapes a value for Telegram's HTML parse mode. */
export const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "a, b,,c" → ['a', 'b', 'c'] */
export const splitList = (value) =>
  (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58 (Bitcoin alphabet) → bytes; null on an invalid character. */
export function base58Decode(s) {
  const bytes = [];
  for (const ch of String(s)) {
    let carry = B58.indexOf(ch);
    if (carry < 0) return null;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of String(s)) {
    if (ch !== '1') break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}
