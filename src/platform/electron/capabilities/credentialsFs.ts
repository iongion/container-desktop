// Electron 0600 credentials file backing the Keychain (keychain.ts). Holds per-provider safeStorage ciphertext
// (base64) — never plaintext — in ai-credentials.json under userData, mode 0600. This is the keychain's own
// encrypted-at-rest storage; secrets never go through the FS port (which has no mode semantics).
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { KeychainFsLike } from "./keychain";

export function createCredentialsFs(filePath: string): KeychainFsLike {
  return {
    async read() {
      try {
        const parsed = JSON.parse(await readFile(filePath, "utf8"));
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        // Missing or unreadable file → no stored credentials yet.
        return {};
      }
    },
    async write(data: Record<string, string>) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
      // `mode` only applies when writeFile CREATES the file; harden any pre-existing loose file too.
      await chmod(filePath, 0o600);
    },
  };
}
