import { describe, expect, it } from "vitest";

import {
  authSchemesFor,
  compareProviderEntries,
  getProviderEntry,
  isAggregatorProvider,
  isLoopbackProviderHost,
  isRemoteProviderEndpoint,
  PROVIDER_CATALOG,
  type ProviderCatalogEntry,
  parseAggregatedModelId,
  resolveProvider,
} from "./providers";
import { DEFAULT_AI_SETTINGS, normalizeAISettings } from "./settings";

describe("resolveProvider", () => {
  it("resolves the local llama.cpp provider to its loopback base URL, keyless", () => {
    const p = resolveProvider(DEFAULT_AI_SETTINGS, "llamacpp");
    expect(p.kind).toBe("local");
    expect(p.baseURL).toBe("http://127.0.0.1:8080/v1");
    expect(p.isCloud).toBe(false);
    expect(p.requiresKey).toBe(false);
    expect(p.discovery).toBe("single");
  });

  it("resolves LM Studio to its loopback base URL", () => {
    expect(resolveProvider(DEFAULT_AI_SETTINGS, "lmstudio").baseURL).toBe("http://127.0.0.1:1234/v1");
  });

  it("resolves cloud providers as key-requiring with a default base URL", () => {
    const anthropic = resolveProvider(DEFAULT_AI_SETTINGS, "anthropic");
    expect(anthropic.kind).toBe("anthropic");
    expect(anthropic.isCloud).toBe(true);
    expect(anthropic.requiresKey).toBe(true);
    expect(anthropic.baseURL).toContain("api.anthropic.com");
    expect(anthropic.discovery).toBe("anthropic");

    const openai = resolveProvider(DEFAULT_AI_SETTINGS, "openai");
    expect(openai.isCloud).toBe(true);
    expect(openai.requiresKey).toBe(true);
    expect(openai.baseURL).toContain("api.openai.com");
    expect(openai.discovery).toBe("openai-compatible");
  });

  it("resolves DeepSeek, GLM, MiniMax and OpenRouter as key-requiring OpenAI-compatible clouds", () => {
    const expected: Array<[string, string]> = [
      ["deepseek", "api.deepseek.com"],
      ["glm", "open.bigmodel.cn"],
      ["minimax", "api.minimax.chat"],
      ["openrouter", "openrouter.ai"],
    ];
    for (const [id, host] of expected) {
      const p = resolveProvider(DEFAULT_AI_SETTINGS, id);
      expect(p.kind).toBe("openai-compatible");
      expect(p.isCloud).toBe(true);
      expect(p.requiresKey).toBe(true);
      expect(p.baseURL).toContain(host);
    }
  });

  it("falls back to the configured default provider when none is given", () => {
    expect(resolveProvider(DEFAULT_AI_SETTINGS).id).toBe("lmstudio");
  });

  it("honors a user-overridden model and base URL", () => {
    const settings = normalizeAISettings({
      providers: { llamacpp: { model: "qwen2.5", baseURL: "http://127.0.0.1:9000/v1" } } as any,
    });
    const p = resolveProvider(settings, "llamacpp");
    expect(p.model).toBe("qwen2.5");
    expect(p.baseURL).toBe("http://127.0.0.1:9000/v1");
  });

  it("throws for a provider id that is not configured", () => {
    expect(() => resolveProvider(DEFAULT_AI_SETTINGS, "nope")).toThrow(/unknown ai provider/i);
  });

  it("uses manual discovery for a configured provider that is not in the catalog", () => {
    const settings = normalizeAISettings({
      providers: { custom: { model: "custom-model", baseURL: "http://127.0.0.1:9999/v1" } } as any,
    });
    expect(resolveProvider(settings, "custom")).toMatchObject({
      id: "custom",
      discovery: "manual",
      model: "custom-model",
    });
  });
});

describe("resolveProvider — connection auth & scheme-derived key requirement", () => {
  it("defaults a provider's auth to its catalog scheme and derives requiresKey from it", () => {
    const local = resolveProvider(DEFAULT_AI_SETTINGS, "lmstudio");
    expect(local.auth).toEqual({ scheme: "none" });
    expect(local.requiresKey).toBe(false);

    const cloud = resolveProvider(DEFAULT_AI_SETTINGS, "anthropic");
    expect(cloud.auth).toEqual({ scheme: "bearer" });
    expect(cloud.requiresKey).toBe(true);
  });

  it("treats a cloud provider set to scheme 'none' as keyless while retaining cloud metadata", () => {
    const settings = normalizeAISettings({ providers: { openrouter: { auth: { scheme: "none" } } } as any });
    const p = resolveProvider(settings, "openrouter");
    expect(p.requiresKey).toBe(false);
    expect(p.isCloud).toBe(true);
  });

  it("treats a local provider set to bearer as key-requiring (a hardened LM Studio)", () => {
    const settings = normalizeAISettings({ providers: { lmstudio: { auth: { scheme: "bearer" } } } as any });
    const p = resolveProvider(settings, "lmstudio");
    expect(p.requiresKey).toBe(true);
    expect(p.isCloud).toBe(false);
  });

  it("honors a user-overridden auth scheme over the catalog default", () => {
    const settings = normalizeAISettings({
      providers: { anthropic: { auth: { scheme: "basic", username: "u" } } } as any,
    });
    const p = resolveProvider(settings, "anthropic");
    expect(p.auth).toEqual({ scheme: "basic", username: "u" });
    expect(p.requiresKey).toBe(true);
  });
});

describe("PROVIDER_CATALOG — single source of provider metadata", () => {
  const byId = (id: string) => PROVIDER_CATALOG.find((e) => e.id === id) as ProviderCatalogEntry;

  it("lists LM Studio first (the default provider)", () => {
    expect(PROVIDER_CATALOG[0].id).toBe("lmstudio");
  });

  it("contains every provider in the canonical order, local before cloud", () => {
    expect(PROVIDER_CATALOG.map((e) => e.id)).toEqual([
      "lmstudio",
      "ollama",
      "llamacpp",
      "anthropic",
      "openai",
      "deepseek",
      "glm",
      "minimax",
      "openrouter",
    ]);
  });

  it("marks only OpenRouter as an aggregator", () => {
    expect(byId("openrouter").aggregator).toBe(true);
    expect(PROVIDER_CATALOG.filter((e) => e.aggregator).map((e) => e.id)).toEqual(["openrouter"]);
  });

  it("declares provider-specific discovery strategies", () => {
    expect(byId("llamacpp").discovery).toBe("single");
    expect(byId("lmstudio").discovery).toBe("openai-compatible");
    expect(byId("openrouter").discovery).toBe("openai-compatible");
    expect(byId("anthropic").discovery).toBe("anthropic");
  });

  it("declares each provider's auth capability — locals keyless/key-optional, clouds API-key only", () => {
    expect(byId("lmstudio")).toMatchObject({ cloud: false, kind: "local", authSchemes: ["none", "bearer"] });
    expect(byId("llamacpp")).toMatchObject({ cloud: false, kind: "local", authSchemes: ["none", "bearer"] });
    for (const id of ["anthropic", "openai", "deepseek", "glm", "minimax", "openrouter"]) {
      expect(byId(id)).toMatchObject({ cloud: true, authSchemes: ["bearer"] });
    }
  });

  it("assigns a default auth scheme — none to the local servers, bearer to the clouds", () => {
    expect(byId("lmstudio").defaultAuthScheme).toBe("none");
    expect(byId("llamacpp").defaultAuthScheme).toBe("none");
    for (const id of ["anthropic", "openai", "deepseek", "glm", "minimax", "openrouter"]) {
      expect(byId(id).defaultAuthScheme).toBe("bearer");
    }
  });

  it("carries the loopback / public default base URLs", () => {
    expect(byId("lmstudio").defaultBaseURL).toBe("http://127.0.0.1:1234/v1");
    expect(byId("llamacpp").defaultBaseURL).toBe("http://127.0.0.1:8080/v1");
    expect(byId("openrouter").defaultBaseURL).toBe("https://openrouter.ai/api/v1");
  });
});

describe("compareProviderEntries — weight then alphabetical", () => {
  const byId = (id: string) => PROVIDER_CATALOG.find((e) => e.id === id) as ProviderCatalogEntry;

  it("pins a lower-weight entry ahead regardless of label", () => {
    // OpenRouter is pinned first among clouds via a lower weight, even though "OpenRouter" > "Anthropic".
    expect(compareProviderEntries(byId("openrouter"), byId("anthropic"))).toBeLessThan(0);
    // LM Studio (the default) is pinned ahead of llama.cpp.
    expect(compareProviderEntries(byId("lmstudio"), byId("llamacpp"))).toBeLessThan(0);
  });

  it("breaks equal weights alphabetically by label", () => {
    expect(compareProviderEntries(byId("anthropic"), byId("deepseek"))).toBeLessThan(0);
    expect(compareProviderEntries(byId("openai"), byId("minimax"))).toBeGreaterThan(0);
  });

  it("sorts the cloud set OpenRouter-first then alphabetical", () => {
    const clouds = PROVIDER_CATALOG.filter((e) => e.cloud)
      .slice()
      .sort(compareProviderEntries)
      .map((e) => e.id);
    expect(clouds).toEqual(["openrouter", "anthropic", "deepseek", "glm", "minimax", "openai"]);
  });
});

describe("authSchemesFor — offerable auth schemes from each provider's declared capability", () => {
  it("offers local servers only none / bearer (keyless default or an optional API key) — never basic/header", () => {
    expect(authSchemesFor(getProviderEntry("lmstudio"))).toEqual(["none", "bearer"]);
    expect(authSchemesFor(getProviderEntry("llamacpp"))).toEqual(["none", "bearer"]);
  });

  it("offers cloud LLM APIs only bearer — never none/basic/header (they are API-key services)", () => {
    for (const id of ["anthropic", "openai", "deepseek", "glm", "minimax", "openrouter"]) {
      expect(authSchemesFor(getProviderEntry(id))).toEqual(["bearer"]);
    }
  });

  it("offers an unknown / user-added provider the full set (its capabilities are unknown)", () => {
    expect(authSchemesFor(undefined)).toEqual(["none", "bearer", "basic", "header"]);
  });
});

describe("isAggregatorProvider", () => {
  it("is true for OpenRouter and false for flat sources", () => {
    expect(isAggregatorProvider("openrouter")).toBe(true);
    expect(isAggregatorProvider("lmstudio")).toBe(false);
    expect(isAggregatorProvider("anthropic")).toBe(false);
    expect(isAggregatorProvider("unknown")).toBe(false);
  });
});

describe("provider endpoint locality", () => {
  it("recognizes loopback host forms", () => {
    for (const host of ["localhost", "127.0.0.1", "127.5.6.7", "::1", "[::1]", "::ffff:127.0.0.1"]) {
      expect(isLoopbackProviderHost(host)).toBe(true);
    }
    for (const host of ["192.168.1.10", "10.0.0.5", "api.openai.com", "0.0.0.0"]) {
      expect(isLoopbackProviderHost(host)).toBe(false);
    }
  });

  it("classifies configured provider URLs for the settings warning without acting as a permission", () => {
    expect(isRemoteProviderEndpoint("http://127.0.0.1:8080/v1")).toBe(false);
    expect(isRemoteProviderEndpoint("http://localhost:1234/v1")).toBe(false);
    expect(isRemoteProviderEndpoint("http://192.168.1.5:8080/v1")).toBe(true);
    expect(isRemoteProviderEndpoint("https://api.openai.com/v1")).toBe(true);
    expect(isRemoteProviderEndpoint("not a url")).toBe(true);
  });
});

describe("parseAggregatedModelId", () => {
  it("splits a vendor-prefixed id on the first slash", () => {
    expect(parseAggregatedModelId("anthropic/claude-3.5-sonnet")).toEqual({
      provider: "anthropic",
      model: "claude-3.5-sonnet",
    });
    expect(parseAggregatedModelId("openai/gpt-4o")).toEqual({ provider: "openai", model: "gpt-4o" });
  });

  it("keeps later slashes inside the model segment (vendor prefix is only the first segment)", () => {
    expect(parseAggregatedModelId("meta-llama/llama-3.1-70b-instruct")).toEqual({
      provider: "meta-llama",
      model: "llama-3.1-70b-instruct",
    });
    expect(parseAggregatedModelId("a/b/c")).toEqual({ provider: "a", model: "b/c" });
  });

  it("treats a flat id (no slash) as having no provider prefix", () => {
    expect(parseAggregatedModelId("qwen2.5-coder-7b")).toEqual({ provider: "", model: "qwen2.5-coder-7b" });
  });

  it("returns empty parts for an empty id", () => {
    expect(parseAggregatedModelId("")).toEqual({ provider: "", model: "" });
  });
});
