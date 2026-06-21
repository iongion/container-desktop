// Main-only JSON file backing for the AI key store. Holds per-provider safeStorage ciphertext
// (base64) — never plaintext — in ai-credentials.json under userData, mode 0600. See.
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { KeyStoreFsLike } from "./keyStore";

export function createCredentialsFs(filePath: string): KeyStoreFsLike {
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
