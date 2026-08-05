import type { Model } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { describe, expect, it } from "vitest";

import { piModelBaseline, piModelBaselineFacts, piProviderIdFor, piProviderModelIds } from "@/pi-bridge/modelBaseline";
import { piBrowsableProviders, piProvider } from "@/pi-bridge/piProviderCatalogue";

// A pi catalogue entry, as its generated data really shapes one. Only the fields a baseline reads are meaningful
// here; the wire fields are present precisely so the tests can prove they never travel.
function catalogueModel(overrides: Partial<Model<"openai-completions">> = {}): Model<"openai-completions"> {
  return {
    id: "glm-4.7",
    name: "GLM 4.7",
    api: "openai-completions",
    provider: "zai",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 32000,
    ...overrides,
  } as Model<"openai-completions">;
}

describe("piModelBaselineFacts", () => {
  it("carries the window, the completion cap and the rates pi published", () => {
    const facts = piModelBaselineFacts(
      catalogueModel({
        contextWindow: 1000000,
        maxTokens: 128000,
        cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
      }),
    );

    expect(facts).toEqual({
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      pricing: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
    });
  });

  // The wire shape is the one thing a baseline must never contribute: pi's minimax entry is `anthropic-messages`
  // while our own minimax provider is OpenAI-shaped, so inheriting `api` would hand an Anthropic field to an
  // OpenAI upstream. The URL is the gateway's business and the compat is `piUpstreamCompat`'s.
  it("never contributes the wire shape", () => {
    const facts = piModelBaselineFacts(catalogueModel({ reasoning: true })) ?? {};

    for (const leaked of ["api", "baseUrl", "provider", "compat", "headers", "id", "name", "input"]) {
      expect(facts).not.toHaveProperty(leaked);
    }
  });

  // pi's own rule, reused rather than restated: a level mapped to null is withdrawn, so a model whose `off` is
  // withdrawn is one that always reasons — which is exactly what `mandatory` says.
  it("reads a withdrawn off as a model that always reasons", () => {
    const facts = piModelBaselineFacts(
      catalogueModel({ reasoning: true, thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" } }),
    );

    expect(facts?.reasoning).toEqual({
      levels: ["minimal", "low", "medium", "high", "xhigh", "max"],
      mandatory: true,
    });
  });

  // An unnamed level keeps pi's default availability, and `xhigh`/`max` are offered ONLY when the map names them.
  it("keeps pi's default set for a reasoner that maps nothing", () => {
    const facts = piModelBaselineFacts(catalogueModel({ reasoning: true }));

    expect(facts?.reasoning).toEqual({ levels: ["minimal", "low", "medium", "high"] });
  });

  it("says nothing about reasoning for a model pi does not call a reasoner", () => {
    expect(piModelBaselineFacts(catalogueModel({ reasoning: false }))?.reasoning).toBeUndefined();
  });

  // pi already defaults every rate to zero, so an all-zero cost is no fact at all — the same reading
  // `modelWindow`'s own `pricingOf` takes.
  it("treats an all-zero cost as no published price", () => {
    expect(piModelBaselineFacts(catalogueModel())?.pricing).toBeUndefined();
  });

  it("answers nothing at all for an entry that published no usable number", () => {
    expect(piModelBaselineFacts(catalogueModel({ contextWindow: 0, maxTokens: 0 }))).toBeUndefined();
  });
});

describe("piModelBaseline", () => {
  // Asserted across the WHOLE published catalogue rather than against pinned ids, so a pi data refresh cannot make
  // this a false failure — and over every provider pi ships, not a chosen few.
  it("answers for every model pi publishes", () => {
    for (const provider of piBrowsableProviders()) {
      // Aggregators are excluded by design — see the aggregator test below.
      if (provider.models.some((model) => model.id.includes("/"))) continue;
      for (const model of provider.models) {
        const facts = piModelBaseline(provider.id, model.id);
        expect(facts, `${provider.id}/${model.id} found no baseline`).toBeDefined();
        expect(facts, `${provider.id}/${model.id} is not the entry pi serves`).toEqual(piModelBaselineFacts(model));
      }
    }
  });

  // Ours is `glm` and pi's is `zai`; the ids under it are the same GLM models, which is what makes the alias a
  // reading of pi's data rather than a claim of our own.
  it("resolves our provider id onto pi's", () => {
    expect(piProviderIdFor("glm")).toBe("zai");
    expect(piProviderIdFor("anthropic")).toBe("anthropic");

    const glm = getBuiltinModels("zai")[0];

    expect(piModelBaseline("glm", glm.id)).toEqual(piModelBaselineFacts(glm));
    expect(piModelBaseline("glm", glm.id)?.contextWindow).toBe(glm.contextWindow);
  });

  it("has nothing for a model pi never published", () => {
    expect(piModelBaseline("deepseek", "deepseek-chat")).toBeUndefined();
  });

  // The two local servers pi does not carry: only a running server knows what it loaded.
  it.each(["lmstudio", "llamacpp"])("has no baseline for %s", (providerId) => {
    expect(piModelBaseline(providerId, "any-model")).toBeUndefined();
    expect(piProvider(providerId)).toBeUndefined();
  });
});

describe("piProviderModelIds", () => {
  // The list that makes a provider you have not keyed browsable instead of a dead end.
  it("lists what pi publishes for a provider it carries", () => {
    const ids = piProviderModelIds("anthropic");

    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual(getBuiltinModels("anthropic").map((model) => model.id));
    for (const id of ids) {
      expect(piModelBaseline("anthropic", id)).toBeDefined();
    }
  });

  // An aggregator's catalogue is still LISTED — browsing it offline is useful — but it never becomes a baseline:
  // its terms are per route, and its own listing publishes them live.
  it("lists an aggregator's models but gives them no baseline", () => {
    const ids = piProviderModelIds("openrouter");

    expect(ids.length).toBeGreaterThan(0);
    expect(piModelBaseline("openrouter", ids[0])).toBeUndefined();
  });

  it("has nothing to list for a provider pi does not carry", () => {
    expect(piProviderModelIds("lmstudio")).toEqual([]);
  });
});
