// Cross-platform RFC-4122 v4 UUID generator — a drop-in for the global `crypto.randomUUID()`, which is newer
// and still missing in some desktop webviews. Uses the Web Crypto `getRandomValues` primitive instead: present
// in every browser, every desktop webview (WebKitGTK / Edge WebView2) and Node ≥15 via the global `crypto`.
// Not `Math.random()` — that is not a CSPRNG. Pure JS, zero deps, no node builtins (the global `crypto` here is
// the Web Crypto API, not `node:crypto`). Same effect as the `uuid` package's v4: 122 bits of cryptographic
// entropy.

// Precomputed byte→hex pairs ("00".."ff") so formatting is a table lookup, not per-nibble math.
const BYTE_TO_HEX: string[] = [];
for (let byte = 0; byte < 256; byte += 1) {
  BYTE_TO_HEX.push((byte + 0x100).toString(16).slice(1));
}

// Generate an RFC-4122 version-4 UUID using cryptographically strong randomness.
export function randomUUID(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Set the version (4) and variant (10xx) bits per RFC 4122 §4.4.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = BYTE_TO_HEX;
  return (
    `${h[bytes[0]]}${h[bytes[1]]}${h[bytes[2]]}${h[bytes[3]]}-${h[bytes[4]]}${h[bytes[5]]}-` +
    `${h[bytes[6]]}${h[bytes[7]]}-${h[bytes[8]]}${h[bytes[9]]}-` +
    `${h[bytes[10]]}${h[bytes[11]]}${h[bytes[12]]}${h[bytes[13]]}${h[bytes[14]]}${h[bytes[15]]}`
  );
}
