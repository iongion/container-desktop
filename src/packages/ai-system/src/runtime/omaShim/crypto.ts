// Browser-safe subset of `node:crypto` used by OMA for trace, task, and message identifiers.
import { randomUUID as webRandomUUID } from "@/utils/randomUUID";

export function randomUUID(): string {
  return webRandomUUID();
}

const BYTE_TO_HEX: string[] = [];
for (let byte = 0; byte < 256; byte += 1) {
  BYTE_TO_HEX.push((byte + 0x100).toString(16).slice(1));
}

export function randomBytes(size: number): { toString(encoding?: string): string } {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return {
    toString(encoding = "hex"): string {
      if (encoding !== "hex") {
        throw new Error(`omaShim/crypto.randomBytes: unsupported encoding "${encoding}" (only 'hex' is shimmed)`);
      }
      let out = "";
      for (const b of bytes) out += BYTE_TO_HEX[b];
      return out;
    },
  };
}

// Only OMA's file-backed stores (eval/observability file-store) use createHash, and those never run in the
// webview (in-memory stores only). Kept as a lazily-throwing export so the import binding resolves; if a webview
// path ever reaches it, this loud failure tells us to implement a real sync hash.
export function createHash(algorithm: string): never {
  throw new Error(
    `omaShim/crypto.createHash("${algorithm}") is not available in the webview build (file-backed stores are unused)`,
  );
}

export default { randomUUID, randomBytes, createHash };
