import { describe, expect, it, vi } from "vitest";

import type { EncryptionStatus } from "@/host-contract/capabilities";
import { createWailsKeychain } from "@/platform/wails/capabilities/keychain";

const HEALTHY: EncryptionStatus = { available: true, backend: "keyring", degraded: false };

function fakeInvoke(handlers: Record<string, (payload: never) => unknown> = {}) {
  return vi.fn(async (command: string, payload?: never) => {
    if (command === "keychain_status") return HEALTHY;
    return handlers[command]?.(payload as never);
  });
}

describe("createWailsKeychain", () => {
  // The web view must not be able to read a provider key on EITHER shell. Tauri has always refused it; this shell
  // used to answer with the secret, which made the credential boundary a property of which backend you happened to
  // be running rather than of the app.
  it("refuses to read a key back into the web view, and never asks the backend for one", async () => {
    const invoke = fakeInvoke();
    const store = await createWailsKeychain(invoke as never);
    await expect(store.getKey("anthropic")).rejects.toThrow(/not available in the web view/);
    expect(invoke).not.toHaveBeenCalledWith("keychain_get", expect.anything());
  });

  it("still forwards has/set/clear, and answers the encryption status from one probe", async () => {
    const invoke = fakeInvoke({ keychain_has: ({ account }: { account: string }) => account === "openai" });
    const store = await createWailsKeychain(invoke as never);
    expect(store.getEncryptionStatus()).toEqual(HEALTHY);
    expect(await store.hasKey("openai")).toBe(true);
    await store.setKey("openai", "sk-new");
    expect(invoke).toHaveBeenCalledWith("keychain_set", { account: "openai", secret: "sk-new", allowDegraded: false });
    await store.clearKey("openai");
    expect(invoke).toHaveBeenCalledWith("keychain_clear", { account: "openai" });
  });
});
