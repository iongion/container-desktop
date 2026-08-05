import { describe, expect, it } from "vitest";

import {
  buildDownstreamHeaders,
  buildUpstreamRequest,
  GATEWAY_CREDENTIAL_PATH,
  type GatewayConfig,
  isAuthorized,
  parseUpstreamAuthScheme,
  upstreamCredentialHeaders,
} from "@/pi-agent-host/gateway";

const config: GatewayConfig = {
  upstreamBaseUrl: "https://openrouter.ai/api/v1",
  apiKey: "sk-real-secret",
  bridgeToken: "tok",
};

describe("buildUpstreamRequest", () => {
  it("joins the inbound path onto the upstream base url", () => {
    const built = buildUpstreamRequest({ path: "/v1/chat/completions", headers: {} }, config);
    expect(built.url).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("injects the real key upstream", () => {
    const built = buildUpstreamRequest({ path: "/v1/models", headers: {} }, config);
    expect(built.headers.authorization).toBe("Bearer sk-real-secret");
  });

  it("drops the caller's own authorization instead of forwarding it", () => {
    const built = buildUpstreamRequest(
      { path: "/v1/models", headers: { authorization: "Bearer tok", "x-api-key": "tok" } },
      config,
    );
    expect(built.headers.authorization).toBe("Bearer sk-real-secret");
    expect(built.headers["x-api-key"]).toBeUndefined();
  });

  it("drops hop-by-hop and host headers", () => {
    const built = buildUpstreamRequest(
      {
        path: "/v1/models",
        headers: { host: "gateway:8788", connection: "keep-alive", "content-type": "application/json" },
      },
      config,
    );
    expect(built.headers.host).toBeUndefined();
    expect(built.headers.connection).toBeUndefined();
    expect(built.headers["content-type"]).toBe("application/json");
  });

  it("tolerates a base url with a trailing slash", () => {
    const built = buildUpstreamRequest(
      { path: "/v1/models", headers: {} },
      { ...config, upstreamBaseUrl: "https://openrouter.ai/api/v1/" },
    );
    expect(built.url).toBe("https://openrouter.ai/api/v1/models");
  });
});

describe("buildDownstreamHeaders", () => {
  it("drops content-encoding, because fetch already decoded the body", () => {
    // Echoing gzip while writing plain bytes makes the client abort mid-response with "terminated".
    const headers = buildDownstreamHeaders({ "content-encoding": "gzip", "content-type": "application/json" });
    expect(headers["content-encoding"]).toBeUndefined();
    expect(headers["content-type"]).toBe("application/json");
  });

  it("drops length and chunking headers that describe the encoded bytes", () => {
    const headers = buildDownstreamHeaders({
      "content-length": "1234",
      "transfer-encoding": "chunked",
      connection: "keep-alive",
    });
    expect(headers).toEqual({});
  });

  it("keeps the streaming content type SSE responses rely on", () => {
    expect(buildDownstreamHeaders({ "content-type": "text/event-stream" })["content-type"]).toBe("text/event-stream");
  });
});

describe("isAuthorized", () => {
  it("accepts the bridge token", () => {
    expect(isAuthorized({ headers: { authorization: "Bearer tok" } }, config)).toBe(true);
  });

  // pi's anthropic-messages client signs x-api-key rather than authorization, so a check on the latter alone
  // would 401 every Anthropic turn before it ever reached the upstream.
  it("accepts the bridge token from x-api-key, which is where the Anthropic shape puts it", () => {
    expect(isAuthorized({ headers: { "x-api-key": "tok" } }, config)).toBe(true);
    expect(isAuthorized({ headers: { "x-api-key": "nope" } }, config)).toBe(false);
  });

  it("rejects a wrong or missing token", () => {
    expect(isAuthorized({ headers: { authorization: "Bearer nope" } }, config)).toBe(false);
    expect(isAuthorized({ headers: {} }, config)).toBe(false);
  });

  it("never accepts the upstream key as a client token", () => {
    expect(isAuthorized({ headers: { authorization: "Bearer sk-real-secret" } }, config)).toBe(false);
    expect(isAuthorized({ headers: { "x-api-key": "sk-real-secret" } }, config)).toBe(false);
  });
});

describe("upstreamCredentialHeaders", () => {
  it("signs a bearer token for an OpenAI-shaped upstream", () => {
    expect(upstreamCredentialHeaders(config)).toEqual({ authorization: "Bearer sk-real-secret" });
  });

  // Anthropic rejects a bearer token: it authenticates with x-api-key. This is the same split the app's own
  // provider transport makes, so one provider does not mean two different things.
  it("signs x-api-key for Anthropic", () => {
    expect(upstreamCredentialHeaders({ ...config, upstreamKind: "anthropic" })).toEqual({
      "x-api-key": "sk-real-secret",
    });
  });

  it("sends nothing at all for a keyless local server", () => {
    expect(upstreamCredentialHeaders({ ...config, authScheme: "none" })).toEqual({});
  });

  it("signs basic auth with the non-secret username and the stored secret", () => {
    expect(upstreamCredentialHeaders({ ...config, authScheme: "basic", authUsername: "me" })).toEqual({
      authorization: `Basic ${Buffer.from("me:sk-real-secret").toString("base64")}`,
    });
  });

  it("signs a custom header for an exotic gateway", () => {
    expect(upstreamCredentialHeaders({ ...config, authScheme: "header", authHeaderName: "X-Key" })).toEqual({
      "x-key": "sk-real-secret",
    });
  });

  it("refuses a custom header that belongs to the connection or the proxy", () => {
    expect(() => upstreamCredentialHeaders({ ...config, authScheme: "header", authHeaderName: "Host" })).toThrow(
      /invalid custom upstream auth header/,
    );
    expect(() => upstreamCredentialHeaders({ ...config, authScheme: "header" })).toThrow();
  });

  it("puts the anthropic credential on the request it builds", () => {
    const built = buildUpstreamRequest({ path: "/v1/messages", headers: {} }, { ...config, upstreamKind: "anthropic" });
    expect(built.headers["x-api-key"]).toBe("sk-real-secret");
    expect(built.headers.authorization).toBeUndefined();
  });

  // The Anthropic SDK posts /v1/messages onto the gateway ORIGIN, so the one /v1 the rewrite strips is the
  // client's — and the upstream base contributes its own.
  it("joins the Anthropic path onto the upstream base exactly once", () => {
    const built = buildUpstreamRequest(
      { path: "/v1/messages", headers: {} },
      { ...config, upstreamBaseUrl: "https://api.anthropic.com/v1", upstreamKind: "anthropic" },
    );
    expect(built.url).toBe("https://api.anthropic.com/v1/messages");
  });
});

describe("parseUpstreamAuthScheme", () => {
  it("defaults to bearer, which is what every OpenAI-shaped upstream wants", () => {
    expect(parseUpstreamAuthScheme(undefined)).toBe("bearer");
    expect(parseUpstreamAuthScheme("")).toBe("bearer");
  });

  it("accepts every scheme the app can configure", () => {
    expect(["none", "bearer", "basic", "header"].map(parseUpstreamAuthScheme)).toEqual([
      "none",
      "bearer",
      "basic",
      "header",
    ]);
  });

  // A typo would otherwise surface as an unexplained 401 on the first turn.
  it("refuses a scheme it does not know", () => {
    expect(() => parseUpstreamAuthScheme("oauth")).toThrow(/CD_UPSTREAM_AUTH_SCHEME/);
  });
});

describe("the stored credential envelope", () => {
  const config = (apiKey: string): GatewayConfig => ({
    upstreamBaseUrl: "https://api.anthropic.com",
    apiKey,
    bridgeToken: "bridge",
    upstreamKind: "anthropic",
    authScheme: "bearer",
  });

  // A sign-in that returns an expiring pair is stored whole, so the value reaching this container is an envelope. Only
  // the ACCESS token may sign a request — a refresh token sent upstream would be a credential leak AND a 401.
  it("signs with the access token, never the refresh token", () => {
    const envelope = JSON.stringify({
      cd: "cd-provider-credential",
      access: "at-live",
      refresh: "rt-secret",
      expires: 1_800_000_000_000,
    });
    expect(upstreamCredentialHeaders(config(envelope))).toEqual({ "x-api-key": "at-live" });
  });

  it("still signs a plain key exactly as it did before", () => {
    expect(upstreamCredentialHeaders(config("sk-plain"))).toEqual({ "x-api-key": "sk-plain" });
  });

  // A keyless local server writes an empty value, and demanding one here killed the container before it listened.
  it("signs nothing when no credential was written", () => {
    expect(upstreamCredentialHeaders(config(""))).toEqual({ "x-api-key": "" });
  });
});

describe("the credential-replacement route", () => {
  it("is the path the agent container posts a renewed credential to", () => {
    expect(GATEWAY_CREDENTIAL_PATH).toBe("/__cd/credential");
  });
});
