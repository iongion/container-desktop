// Tauri Keychain (IKeychain) — the webview-realm OS-secret-store capability, reached through the GENERIC Rust
// `keychain_*` commands (src-tauri/src/keychain.rs). The port's key maps to the keychain's `account`. Storing a key
// while degraded needs explicit opt-in; the keyring keeps one entry per key.
//
// getEncryptionStatus() is SYNCHRONOUS, yet reaching the OS vault is an async `invoke`. So the factory probes
// the status ONCE at construction (async) and the returned keychain closes over that cached value — vault
// availability doesn't change within a session.

import type { EncryptionStatus, IKeychain } from "@/host-contract/keychain";

import type { TauriInvoke } from "./invoke";

export async function createTauriKeychain(invoke: TauriInvoke): Promise<IKeychain> {
  // One-time probe so getEncryptionStatus() can stay synchronous per the port contract.
  const status = await invoke<EncryptionStatus>("keychain_status");

  return {
    getEncryptionStatus: () => status,

    hasKey: (account) => invoke<boolean>("keychain_has", { account }),

    async getKey() {
      // A stored secret is read natively and never handed to this realm. The backing command is not registered,
      // so there is nothing here to call.
      throw new Error("Keychain: reading a stored secret is not available in the web view");
    },

    async setKey(account, plaintext, opts) {
      // Refuse to store a secret when the OS vault is unavailable unless the user explicitly opted into degraded
      // storage.
      const allowDegraded = !!opts?.allowDegraded;
      if (status.degraded && !allowDegraded) {
        throw new Error(
          "Keychain storage is degraded (secrets would not be OS-encrypted). Explicit opt-in is required to store one.",
        );
      }
      // When opted in and the OS vault is unreachable, the Rust side persists to a 0600 file fallback (
      // basic_text parity); on a healthy keychain this flag is inert and the secret goes to the OS vault.
      await invoke("keychain_set", { account, secret: plaintext, allowDegraded });
    },

    clearKey: (account) => invoke<void>("keychain_clear", { account }),
  };
}
