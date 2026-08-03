import { describe, expect, it } from "vitest";

import {
  buildDownstreamHeaders,
  buildUpstreamRequest,
  type GatewayConfig,
  isAuthorized,
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

  it("rejects a wrong or missing token", () => {
    expect(isAuthorized({ headers: { authorization: "Bearer nope" } }, config)).toBe(false);
    expect(isAuthorized({ headers: {} }, config)).toBe(false);
  });

  it("never accepts the upstream key as a client token", () => {
    expect(isAuthorized({ headers: { authorization: "Bearer sk-real-secret" } }, config)).toBe(false);
  });
});
