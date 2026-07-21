// Electron Keychain (IKeychain) — the OS-secret-store capability for the AI broker. Provider keys are encrypted
// at rest with Electron safeStorage (OS keychain) and only ever decrypted in main when making a provider call;
// plaintext is never returned to the renderer. Dependency-injected (safeStorage + fs) so the policy is
// unit-testable without a real keychain. The encrypted-at-rest storage is a 0600 credentials file
// (credentialsFs.ts) — secrets never go through the FS port, which has no mode semantics.

import type { EncryptionStatus, IKeychain } from "@/host-contract/capabilities";

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(buf: Buffer): string;
  // Linux only — reports kwallet/gnome-libsecret/basic_text/etc.
  getSelectedStorageBackend?(): string;
}

export interface KeychainFsLike {
  read(): Promise<Record<string, string>>;
  write(data: Record<string, string>): Promise<void>;
}

export interface KeychainDeps {
  safeStorage: SafeStorageLike;
  fs: KeychainFsLike;
  platform?: string;
}

export function createNodeKeychain(deps: KeychainDeps): IKeychain {
  let mutationChain = Promise.resolve();

  const mutate = (change: (data: Record<string, string>) => boolean): Promise<void> => {
    const run = async () => {
      const data = await deps.fs.read();
      if (change(data)) await deps.fs.write(data);
    };
    const pending = mutationChain.then(run, run);
    mutationChain = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };

  function getEncryptionStatus(): EncryptionStatus {
    const available = deps.safeStorage.isEncryptionAvailable();
    let backend: string | undefined;
    if (deps.platform === "linux" && typeof deps.safeStorage.getSelectedStorageBackend === "function") {
      backend = deps.safeStorage.getSelectedStorageBackend();
    }
    const degraded = !available || backend === "basic_text";
    return { available, backend, degraded };
  }

  return {
    getEncryptionStatus,

    async hasKey(key: string) {
      const data = await deps.fs.read();
      return typeof data[key] === "string" && data[key].length > 0;
    },

    async getKey(key: string) {
      const data = await deps.fs.read();
      const b64 = data[key];
      if (!b64) {
        return undefined;
      }
      return deps.safeStorage.decryptString(Buffer.from(b64, "base64"));
    },

    async setKey(key: string, plaintext: string, opts?: { allowDegraded?: boolean }) {
      if (getEncryptionStatus().degraded && !opts?.allowDegraded) {
        throw new Error(
          "AI key storage is degraded (keys would not be OS-encrypted). Explicit opt-in is required to store a cloud key.",
        );
      }
      const cipher = deps.safeStorage.encryptString(plaintext);
      const encoded = Buffer.from(cipher).toString("base64");
      await mutate((data) => {
        data[key] = encoded;
        return true;
      });
    },

    async clearKey(key: string) {
      await mutate((data) => {
        if (!(key in data)) return false;
        delete data[key];
        return true;
      });
    },
  };
}
