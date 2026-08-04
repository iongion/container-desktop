// Wails Keychain (IKeychain) — the webview-realm OS-secret-store capability, reached through the GENERIC Go
// `keychain_*` commands (src-wails/keychain.go). The IKeychain consumer here is the AI provider-key store, so
// the port argument is a provider id; it maps to the keychain's generic `account`. Mirrors its Tauri peer
// policy (storing a key while degraded needs explicit opt-in), but needs no local credentials file: the keyring
// keeps one entry per key.
//
// getEncryptionStatus() is SYNCHRONOUS, yet reaching the OS vault is an async `invoke`. So the factory probes
// the status ONCE at construction (async) and the returned keychain closes over that cached value — vault
// availability doesn't change within a session.

import type { EncryptionStatus, IKeychain } from "@/host-contract/capabilities";

import type { WailsInvoke } from "./invoke";

export async function createWailsKeychain(invoke: WailsInvoke): Promise<IKeychain> {
  // One-time probe so getEncryptionStatus() can stay synchronous per the port contract.
  const status = await invoke<EncryptionStatus>("keychain_status");

  return {
    getEncryptionStatus: () => status,

    hasKey: (provider) => invoke<boolean>("keychain_has", { account: provider }),

    async getKey() {
      // The provider key never enters this realm: Go resolves it where it is needed — the native provider
      // transport, and the gateway env file it writes 0600 — and the backing command is no longer registered.
      // Tauri has always refused this; a web view that could read a cloud key on one shell and not the other was
      // one shell's security model, not the app's.
      throw new Error("AI: reading the provider key is not available in the web view");
    },

    async setKey(provider, plaintext, opts) {
      // Both shells hold the same policy: refuse to store a cloud key when the OS vault
      // is unavailable unless the user explicitly opted into degraded storage.
      const allowDegraded = !!opts?.allowDegraded;
      if (status.degraded && !allowDegraded) {
        throw new Error(
          "AI key storage is degraded (keys would not be OS-encrypted). Explicit opt-in is required to store a cloud key.",
        );
      }
      // When opted in and the OS vault is unreachable, the Go side persists to a 0600 file fallback (
      // basic_text parity); on a healthy keychain this flag is inert and the secret goes to the OS vault.
      await invoke("keychain_set", { account: provider, secret: plaintext, allowDegraded });
    },

    clearKey: (provider) => invoke<void>("keychain_clear", { account: provider }),

    // Go substitutes the secret while writing and answers only the path, so a container's env file can carry a
    // credential the caller never handled.
    writeSecretFile: (provider, fileName, contents) =>
      invoke<string>("keychain_write_secret_file", { account: provider, fileName, contents }),

    // The same protected directory, no secret to substitute: the agent container's own env file. One guard then
    // covers both, instead of a second directory the web view could read the bridge token out of.
    writeAgentEnvFile: (fileName, contents) => invoke<string>("keychain_write_agent_file", { fileName, contents }),
  };
}
