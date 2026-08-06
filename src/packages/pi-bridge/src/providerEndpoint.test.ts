import { describe, expect, it } from "vitest";

import { PI_BRIDGE_PORT_IN_IMAGE } from "@/pi-bridge/image";
import { PI_PROVIDER_PROXY_PORT, parseUpstreamModelApi, providerProxyBaseUrl } from "@/pi-bridge/providerEndpoint";
import { PI_SESSION_STORAGE_CONTAINER_PORT } from "@/pi-bridge/sessionStorage";

// Three servers run inside one agent container, and two of them once shared a number: every session with the storage
// RPC died on EADDRINUSE, which reads as a container that failed to start rather than as a port collision. The numbers
// are declared in three modules because each is that module's own business, so this is where they are compared.
describe("the ports one agent container binds", () => {
  it("are all different", () => {
    const ports = [PI_BRIDGE_PORT_IN_IMAGE, PI_SESSION_STORAGE_CONTAINER_PORT, PI_PROVIDER_PROXY_PORT];
    expect(new Set(ports).size).toBe(ports.length);
  });
});

describe("parseUpstreamModelApi", () => {
  it("defaults to OpenAI completions, which every provider family but Anthropic speaks", () => {
    expect(parseUpstreamModelApi(undefined)).toBe("openai-completions");
    expect(parseUpstreamModelApi("")).toBe("openai-completions");
  });

  it("selects Anthropic's own wire shape when the app asked for it", () => {
    expect(parseUpstreamModelApi("anthropic-messages")).toBe("anthropic-messages");
  });

  // A typo would otherwise reach pi as an unknown api and fail deep inside its provider composer.
  it("refuses a shape this host cannot register", () => {
    expect(() => parseUpstreamModelApi("openai-responses")).toThrow(/CD_MODEL_API/);
  });
});

describe("providerProxyBaseUrl", () => {
  // pi's openai-completions client posts `/chat/completions` onto a base that already carries the version segment.
  it("carries the version segment for an OpenAI-shaped client", () => {
    expect(providerProxyBaseUrl("openai-completions")).toBe(`http://127.0.0.1:${PI_PROVIDER_PROXY_PORT}/v1`);
  });

  // The Anthropic SDK posts `/v1/messages` onto the origin, so a base carrying `/v1` would ask for `/v1/v1/messages`.
  it("is the bare origin for the Anthropic shape, which adds its own /v1", () => {
    expect(providerProxyBaseUrl("anthropic-messages")).toBe(`http://127.0.0.1:${PI_PROVIDER_PROXY_PORT}`);
  });

  // Both shapes have to arrive at the proxy as `/v1/…`, because that is the one prefix the app strips before joining
  // the upstream's own base. A base that lost it would send the upstream `/chat/completions` with no version at all.
  it("makes both shapes arrive under the one prefix the app strips", () => {
    expect(`${providerProxyBaseUrl("openai-completions")}/chat/completions`).toContain("/v1/chat/completions");
    expect(`${providerProxyBaseUrl("anthropic-messages")}/v1/messages`).toContain("/v1/messages");
  });

  // Loopback INSIDE the container, and never published: nothing outside that container can reach it, which is what
  // makes the bridge the only way inference leaves.
  it("is the container's own loopback", () => {
    expect(providerProxyBaseUrl("openai-completions")).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });
});
