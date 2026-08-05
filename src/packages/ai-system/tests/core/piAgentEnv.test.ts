import { describe, expect, it } from "vitest";

import { composeGatewayEnv, gatewayBaseUrl, upstreamModelApi } from "@/ai-system/core/piAgentEnv";

describe("upstreamModelApi", () => {
  it("speaks Anthropic's own wire shape to an Anthropic upstream", () => {
    // The gateway is a byte proxy: a request that leaves pi as OpenAI completions cannot reach /v1/messages,
    // so the shape has to be decided here rather than assumed.
    expect(upstreamModelApi("anthropic")).toBe("anthropic-messages");
  });

  it("speaks OpenAI completions to everything else", () => {
    expect(upstreamModelApi("openai")).toBe("openai-completions");
    expect(upstreamModelApi("openai-compatible")).toBe("openai-completions");
    expect(upstreamModelApi("local")).toBe("openai-completions");
  });
});

describe("gatewayBaseUrl", () => {
  // pi's openai-completions client posts /chat/completions onto a base that already carries the version
  // segment; its anthropic-messages client goes through the Anthropic SDK, which posts /v1/messages onto the
  // origin. Both therefore arrive at the gateway as /v1/… — the one prefix buildUpstreamRequest strips.
  it("carries the version segment for the OpenAI shape", () => {
    expect(gatewayBaseUrl("http://cd-gateway-1:8788", "openai-completions")).toBe("http://cd-gateway-1:8788/v1");
  });

  it("hands the Anthropic shape the origin, because its client adds /v1 itself", () => {
    expect(gatewayBaseUrl("http://cd-gateway-1:8788", "anthropic-messages")).toBe("http://cd-gateway-1:8788");
  });
});

describe("composeGatewayEnv", () => {
  const base = {
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "sk-real-secret",
    bridgeToken: "tok",
    gatewayPort: 8788,
  };

  it("carries the upstream's credential shape, not just its key", () => {
    const contents = composeGatewayEnv({
      ...base,
      providerKind: "anthropic",
      auth: { scheme: "bearer" },
    });
    expect(contents).toContain("CD_UPSTREAM_KIND=anthropic");
    expect(contents).toContain("CD_UPSTREAM_AUTH_SCHEME=bearer");
    expect(contents).toContain("CD_UPSTREAM_API_KEY=sk-real-secret");
    expect(contents).toContain("CD_UPSTREAM_BASE_URL=https://openrouter.ai/api/v1");
    expect(contents).toContain("CD_BRIDGE_TOKEN=tok");
    expect(contents).toContain("CD_GATEWAY_PORT=8788");
  });

  it("names the custom header and the basic username when the scheme uses them", () => {
    expect(
      composeGatewayEnv({
        ...base,
        providerKind: "openai-compatible",
        auth: { scheme: "header", headerName: "X-Key" },
      }),
    ).toContain("CD_UPSTREAM_AUTH_HEADER_NAME=X-Key");
    expect(
      composeGatewayEnv({ ...base, providerKind: "openai-compatible", auth: { scheme: "basic", username: "me" } }),
    ).toContain("CD_UPSTREAM_AUTH_USERNAME=me");
  });

  it("omits the header name and username the scheme does not use", () => {
    const contents = composeGatewayEnv({ ...base, providerKind: "local", auth: { scheme: "none" } });
    expect(contents).not.toContain("CD_UPSTREAM_AUTH_HEADER_NAME");
    expect(contents).not.toContain("CD_UPSTREAM_AUTH_USERNAME");
    expect(contents).toContain("CD_UPSTREAM_AUTH_SCHEME=none");
  });

  // A keyless local server is a first-class case: the line stays, empty, so the gateway reads it as "no key".
  it("keeps an empty key line for a keyless local server", () => {
    const contents = composeGatewayEnv({ ...base, apiKey: "", providerKind: "local", auth: { scheme: "none" } });
    expect(contents).toContain("CD_UPSTREAM_API_KEY=\n");
  });

  it("never puts a newline-injected second value in the file", () => {
    // An env file is line-oriented, so a value carrying a newline would define whatever follows it.
    expect(() =>
      composeGatewayEnv({
        ...base,
        apiKey: "sk\nCD_BRIDGE_TOKEN=stolen",
        providerKind: "local",
        auth: { scheme: "bearer" },
      }),
    ).toThrow(/newline/i);
  });
});
