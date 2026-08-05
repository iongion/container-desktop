import { describe, expect, it } from "vitest";

import { loginCredentialVerdict, providerLoginOffer } from "@/ai-system/core/piAuth";
import { piProvider, piProviders } from "@/pi-bridge/piProviderCatalogue";

const NOW = 1_760_000_000_000;

describe("providerLoginOffer", () => {
  it("offers pi's own label for a provider whose sign-in produces a key", () => {
    expect(providerLoginOffer("openrouter")).toEqual({ providerId: "openrouter", label: "Sign in with OpenRouter" });
  });

  it("offers a provider whose token expires, now that the credential can be rotated", () => {
    // pi ships an Anthropic OAuth flow, and it returns an access token with a refresh token beside it. What the app
    // does with that pair — exchange it in the same one-shot container the sign-in ran in — is what makes it an offer.
    expect(piProvider("anthropic")?.oauth).toBe(true);
    // pi declares no selector label for this flow, so the offer wears pi's name for the auth method itself.
    expect(providerLoginOffer("anthropic")).toEqual({
      providerId: "anthropic",
      label: piProvider("anthropic")?.oauthName,
    });
  });

  it("declines a provider pi has no flow for at all", () => {
    expect(providerLoginOffer("deepseek")).toBeUndefined();
    expect(providerLoginOffer("lmstudio")).toBeUndefined();
  });

  // Every flow pi ships is offered, and each wears pi's OWN words: the selector label where a flow declares one,
  // otherwise pi's name for the auth method. Nothing here is a list this app maintains.
  it("offers every provider pi carries a flow for, under pi's own words", () => {
    const withFlows = piProviders().filter((provider) => provider.oauth);
    expect(withFlows.length).toBeGreaterThan(1);
    for (const provider of withFlows) {
      const offer = providerLoginOffer(provider.id);
      expect(offer, provider.id).toBeDefined();
      expect(offer?.label, provider.id).toBe(provider.oauthLabel ?? provider.oauthName);
    }
  });
});

describe("loginCredentialVerdict", () => {
  it("stores what OpenRouter's flow returns as a plain key: permanent, nothing to exchange", () => {
    expect(
      loginCredentialVerdict({ access: "sk-or-v1-abc", refresh: "", expires: Number.MAX_SAFE_INTEGER }, NOW),
    ).toEqual({ storable: true, credential: { kind: "key", secret: "sk-or-v1-abc" } });
  });

  it("stores an expiring credential WITH its refresh token, which is what makes it rotatable", () => {
    const verdict = loginCredentialVerdict({ access: "at", refresh: "rt", expires: NOW + 3_600_000 }, NOW);
    expect(verdict).toEqual({
      storable: true,
      credential: { kind: "oauth", credential: { access: "at", refresh: "rt", expires: NOW + 3_600_000 } },
    });
  });

  // The one shape still refused: it dies and nothing can bring it back, so a session started on it would fail
  // mid-turn for a reason the user could do nothing about.
  it("refuses a credential that expires with no refresh token beside it", () => {
    const verdict = loginCredentialVerdict({ access: "at", refresh: "", expires: NOW + 86_400_000 }, NOW);
    expect(verdict.storable).toBe(false);
  });

  it("refuses an empty secret rather than storing a blank credential", () => {
    const verdict = loginCredentialVerdict({ access: "", refresh: "", expires: Number.MAX_SAFE_INTEGER }, NOW);
    expect(verdict.storable).toBe(false);
  });

  it("refuses a credential already expired on arrival", () => {
    const verdict = loginCredentialVerdict({ access: "at", refresh: "rt", expires: NOW - 1 }, NOW);
    expect(verdict.storable).toBe(false);
  });
});
