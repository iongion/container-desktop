import { describe, expect, it } from "vitest";

import { resolveProviderProxyRequest } from "@/ai-system/core/providerProxyOps";

const OPENAI = "https://api.openai.com/v1";

function url(path: string, base = OPENAI, method = "POST") {
  const verdict = resolveProviderProxyRequest({ method, path }, base);
  if (!verdict.ok) throw new Error(`expected a url, got: ${verdict.reason}`);
  return verdict.url;
}

function refusal(path: string, base = OPENAI, method = "POST") {
  const verdict = resolveProviderProxyRequest({ method, path }, base);
  if (verdict.ok) throw new Error(`expected a refusal, got: ${verdict.url}`);
  return verdict.reason;
}

describe("resolveProviderProxyRequest", () => {
  // pi's openai-completions client posts onto a base carrying `/v1`, so the request arrives with that prefix — and the
  // upstream's own base contributes its own. Joining both would ask for `/v1/v1/chat/completions`.
  it("strips the one /v1 the proxy's own base contributed", () => {
    expect(url("/v1/chat/completions")).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("strips it for the Anthropic shape too, whose client adds the prefix itself", () => {
    expect(url("/v1/messages", "https://api.anthropic.com/v1")).toBe("https://api.anthropic.com/v1/messages");
  });

  it("tolerates an upstream base with a trailing slash", () => {
    expect(url("/v1/models", "https://openrouter.ai/api/v1/", "GET")).toBe("https://openrouter.ai/api/v1/models");
  });

  it("keeps the query a listing pages with", () => {
    expect(url("/v1/models?after=abc", OPENAI, "GET")).toBe("https://api.openai.com/v1/models?after=abc");
  });

  // A base with no version segment of its own — a local server — must not have one invented for it.
  it("joins onto a base that carries no version segment", () => {
    expect(url("/v1/chat/completions", "http://127.0.0.1:1234")).toBe("http://127.0.0.1:1234/chat/completions");
  });

  it("strips only ONE /v1, so a model actually called v1 still resolves", () => {
    expect(url("/v1/v1/messages")).toBe("https://api.openai.com/v1/v1/messages");
  });

  // Everything below is the confinement. The agent container is the untrusted world and the path is the one thing it
  // chooses, so the app decides what it can ever resolve to — structurally, never by normalizing something plausible.
  it("refuses a path that names another host", () => {
    expect(refusal("//evil.example/steal")).toMatch(/path/i);
    expect(refusal("https://evil.example/steal")).toMatch(/path/i);
  });

  it("refuses a path that is not a path at all", () => {
    expect(refusal("chat/completions")).toMatch(/path/i);
    expect(refusal("")).toMatch(/path/i);
  });

  // The upstream is pinned, so a traversal cannot leave the origin — but it CAN leave the provider's own base path,
  // which on an aggregator is the difference between one tenant's API and the whole host.
  it("refuses a traversal that would climb out of the upstream's base path", () => {
    expect(refusal("/v1/../../admin", "https://openrouter.ai/api/v1")).toMatch(/outside/i);
  });

  it("refuses an encoded traversal, which decodes to the same thing", () => {
    expect(refusal("/v1/%2e%2e/%2e%2e/admin", "https://openrouter.ai/api/v1")).toMatch(/outside/i);
  });

  // pi asks for a completion and a model list, and nothing else. A container that is not this app's code — plugin
  // code is what runs there — has no business reaching the provider with any other verb.
  it("refuses a method inference never uses", () => {
    for (const method of ["DELETE", "PUT", "PATCH", "OPTIONS", "TRACE"]) {
      expect(refusal("/v1/models", OPENAI, method)).toMatch(/method/i);
    }
  });

  it("allows the three verbs it does use", () => {
    for (const method of ["GET", "HEAD", "POST"]) {
      expect(resolveProviderProxyRequest({ method, path: "/v1/models" }, OPENAI).ok).toBe(true);
    }
  });

  it("refuses an upstream base that is not a usable endpoint", () => {
    expect(refusal("/v1/models", "not a url")).toMatch(/endpoint/i);
    expect(refusal("/v1/models", "file:///etc/passwd")).toMatch(/endpoint/i);
    expect(refusal("/v1/models", "https://user:pass@api.openai.com/v1")).toMatch(/endpoint/i);
  });
});
