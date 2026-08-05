import { describe, expect, it } from "vitest";

import { loginCredentialVerdict, PROVIDER_LOGIN_KEEPS_A_KEY, providerLoginOffer } from "@/ai-system/core/piAuth";
import { piProvider } from "@/pi-bridge/piProviderCatalogue";

const NOW = 1_760_000_000_000;

describe("providerLoginOffer", () => {
  it("offers pi's own label for a provider whose sign-in produces a key", () => {
    expect(providerLoginOffer("openrouter")).toEqual({ providerId: "openrouter", label: "Sign in with OpenRouter" });
  });

  it("declines a provider pi carries a flow for but whose token expires", () => {
    // pi ships an Anthropic OAuth flow, and it returns an access token with a refresh token beside it.
    expect(piProvider("anthropic")?.oauth).toBe(true);
    expect(providerLoginOffer("anthropic")).toBeUndefined();
  });

  it("declines a provider pi has no flow for at all", () => {
    expect(providerLoginOffer("deepseek")).toBeUndefined();
    expect(providerLoginOffer("lmstudio")).toBeUndefined();
  });

  it("names only providers pi really carries a login flow for", () => {
    for (const providerId of PROVIDER_LOGIN_KEEPS_A_KEY) {
      expect(piProvider(providerId)?.oauth, providerId).toBe(true);
      expect(piProvider(providerId)?.oauthLabel, providerId).toBeTruthy();
    }
  });
});

describe("loginCredentialVerdict", () => {
  it("stores what OpenRouter's flow returns: a permanent key, no refresh token", () => {
    expect(
      loginCredentialVerdict({ access: "sk-or-v1-abc", refresh: "", expires: Number.MAX_SAFE_INTEGER }, NOW),
    ).toEqual({ storable: true, secret: "sk-or-v1-abc" });
  });

  it("refuses a credential that carries a refresh token, because nothing here can exchange one", () => {
    const verdict = loginCredentialVerdict({ access: "at", refresh: "rt", expires: NOW + 3_600_000 }, NOW);
    expect(verdict.storable).toBe(false);
  });

  it("refuses a credential that expires, even with no refresh token to hide behind", () => {
    const verdict = loginCredentialVerdict({ access: "at", refresh: "", expires: NOW + 86_400_000 }, NOW);
    expect(verdict.storable).toBe(false);
  });

  it("refuses an empty secret rather than storing a blank credential", () => {
    const verdict = loginCredentialVerdict({ access: "", refresh: "", expires: Number.MAX_SAFE_INTEGER }, NOW);
    expect(verdict.storable).toBe(false);
  });
});
