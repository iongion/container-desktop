import { describe, expect, it } from "vitest";

import type { AIKeyStore } from "@/ai-system/core/ports";
import { collectDevApiKeysFromEnv, withDevApiKeys } from "./devKeys";

function memKeyStore(): AIKeyStore {
  const m = new Map<string, string>();
  return {
    getEncryptionStatus: () => ({ available: true, degraded: false }),
    hasKey: async (p: string) => m.has(p),
    getKey: async (p: string) => m.get(p),
    setKey: async (p: string, v: string) => {
      m.set(p, v);
    },
    clearKey: async (p: string) => {
      m.delete(p);
    },
  };
}

describe("collectDevApiKeysFromEnv", () => {
  it("collects <ID>_API_KEY per provider, ignoring absent/blank values", () => {
    const env = {
      OPENROUTER_API_KEY: "sk-or",
      ANTHROPIC_API_KEY: "   ",
      OPENAI_API_KEY: "sk-oa",
    };
    expect(collectDevApiKeysFromEnv(["openrouter", "anthropic", "openai", "glm"], env)).toEqual({
      openrouter: "sk-or",
      openai: "sk-oa",
    });
  });

  it("uppercases the provider id for the env var name", () => {
    expect(collectDevApiKeysFromEnv(["lmstudio"], { LMSTUDIO_API_KEY: "x" })).toEqual({ lmstudio: "x" });
  });
});

describe("withDevApiKeys", () => {
  it("falls back to the env key only when nothing is stored", async () => {
    const ks = withDevApiKeys(memKeyStore(), { openrouter: "sk-or" });
    expect(await ks.hasKey("openrouter")).toBe(true);
    expect(await ks.getKey("openrouter")).toBe("sk-or");
    // A provider with no env fallback and nothing stored stays empty.
    expect(await ks.hasKey("anthropic")).toBe(false);
    expect(await ks.getKey("anthropic")).toBeUndefined();
  });

  it("lets a real stored key win over the env fallback", async () => {
    const inner = memKeyStore();
    await inner.setKey("openrouter", "stored-key");
    const ks = withDevApiKeys(inner, { openrouter: "sk-or" });
    expect(await ks.getKey("openrouter")).toBe("stored-key");
  });
});
