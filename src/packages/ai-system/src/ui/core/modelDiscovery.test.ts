import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { normalizeAISettings } from "@/ai-system/core/settings";
import { modelDiscoveryQueryKey, modelDiscoveryQueryOptions, NO_KEY } from "./modelDiscovery";

describe("model discovery query contract", () => {
  it("keys the cache by the complete non-secret connection identity", () => {
    const base = normalizeAISettings({
      providers: {
        openai: {
          model: "gpt",
          baseURL: "https://gateway.example/v1/",
          auth: { scheme: "basic", username: "first" },
          credentialRevision: 1,
        },
      } as any,
    });
    const changedPath = structuredClone(base);
    changedPath.providers.openai.baseURL = "https://gateway.example/other";
    const changedUser = structuredClone(base);
    changedUser.providers.openai.auth = { scheme: "basic", username: "second" };
    const changedCredential = structuredClone(base);
    changedCredential.providers.openai.credentialRevision = 2;

    const key = modelDiscoveryQueryKey(base, "openai");
    expect(key).not.toEqual(modelDiscoveryQueryKey(changedPath, "openai"));
    expect(key).not.toEqual(modelDiscoveryQueryKey(changedUser, "openai"));
    expect(key).not.toEqual(modelDiscoveryQueryKey(changedCredential, "openai"));
    expect(JSON.stringify(key)).not.toContain("secret");
  });

  it("deduplicates concurrent consumers through one TanStack query", async () => {
    const ai = normalizeAISettings({ providers: { llamacpp: { model: "bound" } } as any });
    const listModels = vi.fn(async () => ({ models: [{ id: "bound" }] }));
    const client = {
      hasKey: vi.fn(async () => true),
      listModels,
      cancelModelList: vi.fn(async () => ({ ok: true as const })),
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = modelDiscoveryQueryOptions(ai, "llamacpp", client, () => "request-shared");

    await Promise.all([queryClient.fetchQuery(options), queryClient.fetchQuery(options)]);
    expect(listModels).toHaveBeenCalledOnce();
  });

  it("reports a missing required key without starting model discovery", async () => {
    const ai = normalizeAISettings({ providers: { openai: { model: "" } } as any });
    const client = {
      hasKey: vi.fn(async () => false),
      listModels: vi.fn(),
      cancelModelList: vi.fn(async () => ({ ok: true as const })),
    };

    await expect(
      modelDiscoveryQueryOptions(ai, "openai", client).queryFn({ signal: new AbortController().signal } as any),
    ).rejects.toMatchObject({
      message: NO_KEY,
    });
    expect(client.listModels).not.toHaveBeenCalled();
  });

  it("cancels the correlated host request when TanStack aborts the query", async () => {
    const ai = normalizeAISettings({ providers: { llamacpp: { model: "bound" } } as any });
    let release: (() => void) | undefined;
    const client = {
      hasKey: vi.fn(async () => true),
      listModels: vi.fn(
        () =>
          new Promise<{ models: Array<{ id: string }> }>((resolve) => {
            release = () => resolve({ models: [{ id: "bound" }] });
          }),
      ),
      cancelModelList: vi.fn(async () => ({ ok: true as const })),
    };
    const controller = new AbortController();
    const pending = modelDiscoveryQueryOptions(ai, "llamacpp", client, () => "request-cancel").queryFn({
      signal: controller.signal,
    } as any);
    await vi.waitFor(() => expect(client.listModels).toHaveBeenCalledOnce());
    controller.abort();
    await vi.waitFor(() => expect(client.cancelModelList).toHaveBeenCalledWith("request-cancel"));
    release?.();
    await pending;
  });
});
