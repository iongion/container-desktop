// Main-only provider-key store. API keys are encrypted at rest with Electron's safeStorage
// (OS keychain) and the plaintext is only ever decrypted in main when making a provider call —
// it is never returned to the renderer. Dependency-injected (safeStorage + fs) so the policy is
// unit-testable without a real keychain. See security model.

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(buf: Buffer): string;
  // Linux only — reports kwallet/gnome-libsecret/basic_text/etc.
  getSelectedStorageBackend?(): string;
}

export interface KeyStoreFsLike {
  read(): Promise<Record<string, string>>;
  write(data: Record<string, string>): Promise<void>;
}

export interface KeyStoreDeps {
  safeStorage: SafeStorageLike;
  fs: KeyStoreFsLike;
  platform?: string;
}

export interface EncryptionStatus {
  available: boolean;
  backend?: string;
  // True when keys would NOT be protected by a real OS secret store (unavailable, or Linux
  // basic_text fallback). The UI surfaces this and storing a cloud key requires explicit opt-in.
  degraded: boolean;
}

export interface AIKeyStore {
  getEncryptionStatus(): EncryptionStatus;
  hasKey(provider: string): Promise<boolean>;
  getKey(provider: string): Promise<string | undefined>;
  setKey(provider: string, plaintext: string, opts?: { allowDegraded?: boolean }): Promise<void>;
  clearKey(provider: string): Promise<void>;
}

export function createAIKeyStore(deps: KeyStoreDeps): AIKeyStore {
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

    async hasKey(provider: string) {
      const data = await deps.fs.read();
      return typeof data[provider] === "string" && data[provider].length > 0;
    },

    async getKey(provider: string) {
      const data = await deps.fs.read();
      const b64 = data[provider];
      if (!b64) {
        return undefined;
      }
      return deps.safeStorage.decryptString(Buffer.from(b64, "base64"));
    },

    async setKey(provider: string, plaintext: string, opts?: { allowDegraded?: boolean }) {
      if (getEncryptionStatus().degraded && !opts?.allowDegraded) {
        throw new Error(
          "AI key storage is degraded (keys would not be OS-encrypted). Explicit opt-in is required to store a cloud key.",
        );
      }
      const cipher = deps.safeStorage.encryptString(plaintext);
      const data = await deps.fs.read();
      data[provider] = Buffer.from(cipher).toString("base64");
      await deps.fs.write(data);
    },

    async clearKey(provider: string) {
      const data = await deps.fs.read();
      if (provider in data) {
        delete data[provider];
        await deps.fs.write(data);
      }
    },
  };
}
