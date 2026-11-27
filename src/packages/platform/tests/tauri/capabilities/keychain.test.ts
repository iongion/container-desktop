import { describe, expect, it, vi } from "vitest";

import type { TauriInvoke } from "@/platform/tauri/capabilities/invoke";
import { createTauriKeychain } from "@/platform/tauri/capabilities/keychain";

const AVAILABLE = { available: true, degraded: false };
const DEGRADED = { available: false, degraded: true };

// A fake `invoke` over the generic keychain_* command surface; override individual commands per test. The generic
// <T> signature can't be inferred from a plain vi.fn — cast at the boundary while keeping the mock for asserts.
function fakeInvoke(overrides: Record<string, (args: any) => unknown> = {}) {
  const map: Record<string, (args: any) => unknown> = {
    keychain_status: () => AVAILABLE,
    keychain_has: () => false,
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

  it("forwards has/set/clear to the keychain_* commands, mapping the key to the generic account", async () => {
    const invoke = fakeInvoke({ keychain_has: ({ account }) => account === "service-token" });
    const store = await createTauriKeychain(asInvoke(invoke));
    expect(await store.hasKey("service-token")).toBe(true);
    await store.setKey("service-token", "s3cret-new");
    expect(invoke).toHaveBeenCalledWith("keychain_set", {
      account: "service-token",
      secret: "s3cret-new",
      allowDegraded: false,
    });
    await store.clearKey("service-token");
    expect(invoke).toHaveBeenCalledWith("keychain_clear", { account: "service-token" });
  });

  it("refuses to read a key back into the web view, and never asks the backend for one", async () => {
    const invoke = fakeInvoke();
    const store = await createTauriKeychain(asInvoke(invoke));
    await expect(store.getKey("service-token")).rejects.toThrow(/not available in the web view/);
    expect(invoke).not.toHaveBeenCalledWith("keychain_get", expect.anything());
  });

  it("refuses to store while degraded without opt-in, but proceeds with allowDegraded", async () => {
    const invoke = fakeInvoke({ keychain_status: () => DEGRADED });
    const store = await createTauriKeychain(asInvoke(invoke));
    expect(store.getEncryptionStatus().degraded).toBe(true);
    await expect(store.setKey("service-token", "s3cret")).rejects.toThrow(/degraded/i);
    await store.setKey("service-token", "s3cret", { allowDegraded: true });
    expect(invoke).toHaveBeenCalledWith("keychain_set", {
      account: "service-token",
      secret: "s3cret",
      allowDegraded: true,
    });
  });
});
