import { describe, expect, it, vi } from "vitest";

import type { TauriInvoke } from "./invoke";
import { createTauriKeychain } from "./keychain";

const AVAILABLE = { available: true, degraded: false };
const DEGRADED = { available: false, degraded: true };

// A fake `invoke` over the generic keychain_* command surface; override individual commands per test. The generic
// <T> signature can't be inferred from a plain vi.fn — cast at the boundary while keeping the mock for asserts.
function fakeInvoke(overrides: Record<string, (args: any) => unknown> = {}) {
  const map: Record<string, (args: any) => unknown> = {
    keychain_status: () => AVAILABLE,
    keychain_has: () => false,
    keychain_get: () => null,
    keychain_set: () => undefined,
    keychain_clear: () => undefined,
    ...overrides,
  };
  return vi.fn(async (command: string, args?: any) => map[command](args));
}

const asInvoke = (mock: ReturnType<typeof fakeInvoke>) => mock as unknown as TauriInvoke;

describe("createTauriKeychain", () => {
  it("serves getEncryptionStatus() synchronously from a one-time probe", async () => {
    const invoke = fakeInvoke();
    const store = await createTauriKeychain(asInvoke(invoke));
    expect(invoke.mock.calls[0][0]).toBe("keychain_status");
    const callsAfterConstruct = invoke.mock.calls.length;
    expect(store.getEncryptionStatus()).toEqual(AVAILABLE);
    expect(store.getEncryptionStatus()).toEqual(AVAILABLE);
    // the sync accessor must not re-invoke the backend
    expect(invoke.mock.calls.length).toBe(callsAfterConstruct);
  });

  it("forwards has/get/set/clear to the keychain_* commands, mapping the provider id to the generic account", async () => {
    const invoke = fakeInvoke({
      keychain_has: ({ account }) => account === "openai",
      keychain_get: ({ account }) => (account === "openai" ? "sk-live" : null),
    });
    const store = await createTauriKeychain(asInvoke(invoke));
    expect(await store.hasKey("openai")).toBe(true);
    expect(await store.getKey("openai")).toBe("sk-live");
    await store.setKey("openai", "sk-new");
    expect(invoke).toHaveBeenCalledWith("keychain_set", { account: "openai", secret: "sk-new", allowDegraded: false });
    await store.clearKey("openai");
    expect(invoke).toHaveBeenCalledWith("keychain_clear", { account: "openai" });
  });

  it("maps a missing key (null) to undefined", async () => {
    const store = await createTauriKeychain(asInvoke(fakeInvoke()));
    expect(await store.getKey("anthropic")).toBeUndefined();
  });

  it("refuses to store while degraded without opt-in, but proceeds with allowDegraded", async () => {
    const invoke = fakeInvoke({ keychain_status: () => DEGRADED });
    const store = await createTauriKeychain(asInvoke(invoke));
    expect(store.getEncryptionStatus().degraded).toBe(true);
    await expect(store.setKey("openai", "sk")).rejects.toThrow(/degraded/i);
    await store.setKey("openai", "sk", { allowDegraded: true });
    expect(invoke).toHaveBeenCalledWith("keychain_set", { account: "openai", secret: "sk", allowDegraded: true });
  });
});
