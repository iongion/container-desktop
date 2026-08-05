import { describe, expect, it } from "vitest";

import { PROVIDER_CATALOG } from "@/ai-system/core/providers";
import type { AISettings } from "@/ai-system/core/types";
import { providerSources } from "@/ai-system/ui/core/providerSources";
import { piBrowsableProviders } from "@/pi-bridge/piProviderCatalogue";

const settings = (providers: Record<string, unknown> = {}): AISettings =>
  ({ defaultProvider: "lmstudio", providers }) as unknown as AISettings;

describe("providerSources", () => {
  it("keeps the app's own sources in their own groups", () => {
    const groups = providerSources(settings());

    expect(groups.local.map((source) => source.id)).toEqual(["lmstudio", "llamacpp"]);
    expect(groups.configured.every((source) => source.translate)).toBe(true);
    expect([...groups.local, ...groups.configured]).toHaveLength(PROVIDER_CATALOG.length);
  });

  // The app's entry wins for a provider both lists carry: it is the one that knows the endpoint and the auth
  // schemes. A duplicate row under "more" would offer to adopt something already configured.
  it("never repeats a source the app already ships", () => {
    const groups = providerSources(settings());
    const ours = new Set([...groups.local, ...groups.configured].map((source) => source.id));

    for (const source of groups.more) {
      expect(ours.has(source.id), `${source.id} is listed twice`).toBe(false);
    }
    // `glm` is our word for pi's `zai`, so pi's own row must not come back beside it.
    expect(groups.more.some((source) => source.id === "zai")).toBe(false);
  });

  it("offers the rest of what pi ships, with what pi publishes for each", () => {
    const groups = providerSources(settings());

    expect(groups.more.length).toBeGreaterThan(20);
    for (const source of groups.more) {
      expect(source.published, `${source.id} must say how many models pi has`).toBeGreaterThan(0);
      expect(source.configured).toBe(false);
      expect(source.translate, "pi's own provider name is not ours to translate").toBe(false);
    }
  });

  // A provider pi publishes nothing for would open an empty panel — `radius` is dynamic and empty until a gateway
  // answers, so it is not a row.
  it("leaves out a provider pi publishes nothing for", () => {
    const groups = providerSources(settings());

    expect(piBrowsableProviders().some((provider) => provider.id === "radius")).toBe(false);
    expect(groups.more.some((source) => source.id === "radius")).toBe(false);
  });

  it("marks what the app has a provider entry for", () => {
    const groups = providerSources(settings({ openrouter: { model: "x" } }));

    expect(groups.configured.find((source) => source.id === "openrouter")?.configured).toBe(true);
    expect(groups.configured.find((source) => source.id === "anthropic")?.configured).toBe(false);
  });

  // The count comes from pi through our own id, so `glm` reports what pi publishes under `zai`.
  it("counts an aliased provider through pi's id", () => {
    const glm = providerSources(settings()).configured.find((source) => source.id === "glm");
    const zai = piBrowsableProviders().find((provider) => provider.id === "zai");

    expect(glm?.published).toBe(zai?.models.length);
  });

  it("filters on what the row shows without reordering the groups", () => {
    const groups = providerSources(settings(), "mistral");

    expect(groups.local).toHaveLength(0);
    expect(groups.more.map((source) => source.label)).toEqual(["Mistral"]);
  });

  it("says which pi providers carry a login flow", () => {
    const groups = providerSources(settings());

    expect(groups.more.find((source) => source.id === "github-copilot")?.oauth).toBe(true);
    expect(groups.more.find((source) => source.id === "mistral")?.oauth).toBeUndefined();
  });
});
