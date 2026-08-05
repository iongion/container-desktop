import { describe, expect, it } from "vitest";

import {
  credentialNeedsRefresh,
  decodeProviderCredential,
  encodeProviderCredential,
  upstreamSecretOf,
} from "./providerCredential";

const OAUTH = { access: "access-1", refresh: "refresh-1", expires: 1_800_000_000_000 };

describe("the stored provider credential", () => {
  it("keeps a plain API key exactly as it was, so nothing already in the vault changes meaning", () => {
    expect(encodeProviderCredential({ kind: "key", secret: "sk-or-v1-abc" })).toBe("sk-or-v1-abc");
    expect(decodeProviderCredential("sk-or-v1-abc")).toEqual({ kind: "key", secret: "sk-or-v1-abc" });
  });

  it("round-trips a refreshable credential", () => {
    const encoded = encodeProviderCredential({ kind: "oauth", credential: OAUTH });
    expect(decodeProviderCredential(encoded)).toEqual({ kind: "oauth", credential: OAUTH });
  });

  it("encodes on ONE line, because an env file value cannot carry a newline", () => {
    expect(encodeProviderCredential({ kind: "oauth", credential: OAUTH })).not.toMatch(/[\r\n]/);
  });

  it("reads a key that merely looks like JSON as a key, not as a broken credential", () => {
    for (const value of ['{"not":"ours"}', "{}", "[]", "{oops", '{"cd":"oauth"}']) {
      expect(decodeProviderCredential(value)).toEqual({ kind: "key", secret: value });
    }
  });

  it("has nothing stored for an empty vault entry", () => {
    expect(decodeProviderCredential(undefined)).toBeUndefined();
    expect(decodeProviderCredential("")).toBeUndefined();
  });

  it("signs upstream requests with the access token, never the refresh token", () => {
    expect(upstreamSecretOf({ kind: "oauth", credential: OAUTH })).toBe("access-1");
    expect(upstreamSecretOf({ kind: "key", secret: "sk-1" })).toBe("sk-1");
  });
});

describe("credentialNeedsRefresh", () => {
  const now = 1_000_000;

  it("never refreshes a plain key — there is nothing to exchange", () => {
    expect(credentialNeedsRefresh({ kind: "key", secret: "sk-1" }, now)).toBe(false);
  });

  it("refreshes before the token dies, not after, so a turn never starts on a token about to lapse", () => {
    const nearly = { kind: "oauth", credential: { ...OAUTH, expires: now + 60_000 } } as const;
    expect(credentialNeedsRefresh(nearly, now)).toBe(true);
  });

  it("leaves a credential with plenty of life alone", () => {
    const fresh = { kind: "oauth", credential: { ...OAUTH, expires: now + 3_600_000 } } as const;
    expect(credentialNeedsRefresh(fresh, now)).toBe(false);
  });

  it("cannot refresh what carries no refresh token, however expired it is", () => {
    const spent = { kind: "oauth", credential: { access: "a", refresh: "", expires: now - 1 } } as const;
    expect(credentialNeedsRefresh(spent, now)).toBe(false);
  });
});
