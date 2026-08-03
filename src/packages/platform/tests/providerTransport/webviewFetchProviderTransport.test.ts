import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const providerTransport = { request: vi.fn(), dispose: vi.fn() };
  return {
    createSharedAISystem: vi.fn(async () => ({ id: "broker" })),
    createFetchProviderTransport: vi.fn(() => providerTransport),
    createTauriKeychain: vi.fn(async () => ({ id: "tauri-keychain" })),
    createWailsKeychain: vi.fn(async () => ({ id: "wails-keychain" })),
    providerTransport,
  };
});

vi.mock("@/ai-system/host/createAISystem", () => ({ createAISystem: mocks.createSharedAISystem }));
vi.mock("@/platform/providerTransport/fetchProviderTransport", () => ({
  createFetchProviderTransport: mocks.createFetchProviderTransport,
}));
vi.mock("@/platform/tauri/capabilities/keychain", () => ({ createTauriKeychain: mocks.createTauriKeychain }));
vi.mock("@/platform/wails/capabilities/keychain", () => ({ createWailsKeychain: mocks.createWailsKeychain }));

import { createAISystem as createTauriAISystem } from "@/platform/tauri/aiSystem";
import { createAISystem as createWailsAISystem } from "@/platform/wails/aiSystem";

function deps() {
  return {
    invoke: vi.fn(),
    fs: {},
    path: {},
    userDataDir: "/tmp/app-data",
    getAISettings: vi.fn(async () => ({})),
    onInvoke: vi.fn(),
    send: vi.fn(),
    senderId: vi.fn(() => 1),
    isAllowedSender: vi.fn(() => true),
  } as never;
}

describe("trusted-webview provider fetch composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["Tauri", createTauriAISystem, mocks.createTauriKeychain],
    ["Wails", createWailsAISystem, mocks.createWailsKeychain],
  ])("uses %s keychain with the webview's own fetch", async (_name, createAISystem, createKeychain) => {
    await createAISystem(deps());

    const keychain = await createKeychain.mock.results[0].value;
    expect(mocks.createFetchProviderTransport).toHaveBeenCalledWith({
      keychain,
      fetchImpl: globalThis.fetch,
      anthropicDirectBrowserAccess: true,
    });
    expect(mocks.createSharedAISystem).toHaveBeenCalledWith(
      expect.objectContaining({ keychain }),
      expect.objectContaining({ providerTransport: expect.anything() }),
    );
  });

  it("hands Wails the webview transport, but wraps Tauri's so a keyed request can go native", async () => {
    await createWailsAISystem(deps());
    expect(mocks.createSharedAISystem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ providerTransport: mocks.providerTransport }),
    );

    vi.clearAllMocks();
    await createTauriAISystem(deps());
    const call = mocks.createSharedAISystem.mock.calls[0] as unknown as [unknown, { providerTransport: unknown }];
    const options = call[1];
    // Tauri still builds the webview transport for keyless providers, but the AI system receives the router that
    // sends anything needing a key to Rust instead.
    expect(options.providerTransport).not.toBe(mocks.providerTransport);
  });
});
