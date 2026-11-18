// OS secret store port (the Tauri keyring). A privileged, realm-local capability: it is never re-aliased onto
// window.* / global.d.ts. One impl lives in platform/tauri/capabilities/keychain.ts.
//
// The store owns its own encrypted-at-rest storage — for the degraded-vault fallback that is a 0600 credentials
// file; the FS port is not used for secrets (it has no mode semantics). `getEncryptionStatus` is synchronous so a
// settings UI can read it without awaiting the vault.
export interface EncryptionStatus {
  available: boolean;
  backend?: string;
  // True when a stored secret would NOT be protected by a real OS secret store (unavailable, or the Linux
  // basic_text fallback). Consumers surface this and gate degraded writes behind explicit opt-in.
  degraded: boolean;
}

export interface IKeychain {
  getEncryptionStatus(): EncryptionStatus;
  hasKey(key: string): Promise<boolean>;
  getKey(key: string): Promise<string | undefined>;
  setKey(key: string, plaintext: string, opts?: { allowDegraded?: boolean }): Promise<void>;
  clearKey(key: string): Promise<void>;
}
