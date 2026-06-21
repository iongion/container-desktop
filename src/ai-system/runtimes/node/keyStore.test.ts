import { describe, expect, it } from "vitest";

import { createAIKeyStore, type KeyStoreFsLike, type SafeStorageLike } from "./keyStore";

// A reversible fake of Electron's safeStorage — "encrypts" by tagging the string, so the
// round-trip is observable without a real OS keychain.
function fakeSafeStorage(opts?: { available?: boolean; backend?: string }): SafeStorageLike {
  return {
    isEncryptionAvailable: () => opts?.available ?? true,
    encryptString: (plain: string) => Buffer.from(`enc:${plain}`, "utf8"),
    decryptString: (buf: Buffer) => buf.toString("utf8").replace(/^enc:/, ""),
    getSelectedStorageBackend: () => opts?.backend ?? "kwallet",
  };
}

function memFs(): KeyStoreFsLike & { dump: () => Record<string, string> } {
  let store: Record<string, string> = {};
  return {
    read: async () => ({ ...store }),
    write: async (data) => {
      store = { ...data };
    },
    dump: () => store,
  };
}

describe("createAIKeyStore", () => {
  it("round-trips a key: set → has → get", async () => {
    const ks = createAIKeyStore({ safeStorage: fakeSafeStorage(), fs: memFs(), platform: "linux" });
    expect(await ks.hasKey("anthropic")).toBe(false);
    await ks.setKey("anthropic", "sk-ant-secret");
    expect(await ks.hasKey("anthropic")).toBe(true);
    expect(await ks.getKey("anthropic")).toBe("sk-ant-secret");
  });

  it("persists ciphertext, never plaintext", async () => {
    const fs = memFs();
    const ks = createAIKeyStore({ safeStorage: fakeSafeStorage(), fs, platform: "linux" });
    await ks.setKey("openai", "sk-plain");
    expect(JSON.stringify(fs.dump())).not.toContain("sk-plain");
  });

  it("clears a key", async () => {
    const ks = createAIKeyStore({ safeStorage: fakeSafeStorage(), fs: memFs(), platform: "linux" });
    await ks.setKey("openai", "sk-x");
    await ks.clearKey("openai");
    expect(await ks.hasKey("openai")).toBe(false);
    expect(await ks.getKey("openai")).toBeUndefined();
  });

  it("reports a healthy encryption backend", () => {
    const ks = createAIKeyStore({
      safeStorage: fakeSafeStorage({ backend: "kwallet" }),
      fs: memFs(),
      platform: "linux",
    });
    const status = ks.getEncryptionStatus();
    expect(status.available).toBe(true);
    expect(status.degraded).toBe(false);
  });

  it("flags degraded security when Linux falls back to basic_text", () => {
    const ks = createAIKeyStore({
      safeStorage: fakeSafeStorage({ backend: "basic_text" }),
      fs: memFs(),
      platform: "linux",
    });
    expect(ks.getEncryptionStatus().degraded).toBe(true);
  });

  it("flags degraded security when encryption is unavailable", () => {
    const ks = createAIKeyStore({ safeStorage: fakeSafeStorage({ available: false }), fs: memFs(), platform: "linux" });
    expect(ks.getEncryptionStatus().degraded).toBe(true);
  });

  it("refuses to store a key under degraded security unless explicitly allowed", async () => {
    const ks = createAIKeyStore({
      safeStorage: fakeSafeStorage({ backend: "basic_text" }),
      fs: memFs(),
      platform: "linux",
    });
    await expect(ks.setKey("anthropic", "sk-ant-x")).rejects.toThrow(/degraded/i);
    // With explicit opt-in it stores.
    await ks.setKey("anthropic", "sk-ant-x", { allowDegraded: true });
    expect(await ks.hasKey("anthropic")).toBe(true);
  });
});
