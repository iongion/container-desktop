import { describe, expect, it } from "vitest";

import { describeError } from "@/ai-system/core/errors";

describe("describeError", () => {
  it("returns a plain Error's message", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("digs the real reason out of a `fetch failed` cause chain", () => {
    const error = new TypeError("fetch failed");
    (error as { cause?: unknown }).cause = new Error("connect ECONNREFUSED 127.0.0.1:1234");
    expect(describeError(error)).toBe("fetch failed: connect ECONNREFUSED 127.0.0.1:1234");
  });

  it("prefers the provider body message over a generic wrapper (AI-SDK APICallError shape)", () => {
    const error = Object.assign(new Error("Provider returned an error response"), {
      statusCode: 429,
      responseBody: JSON.stringify({
        error: { message: "Upstream error from Nvidia: ResourceExhausted: Worker local total request limit reached" },
      }),
    });
    expect(describeError(error)).toBe(
      "Upstream error from Nvidia: ResourceExhausted: Worker local total request limit reached",
    );
  });

  it("reads a nested error.message off a non-Error object", () => {
    expect(describeError({ error: { message: "invalid model ID" } })).toBe("invalid model ID");
  });

  it("preserves a provider response body nested inside a result envelope", () => {
    const providerError = Object.assign(new Error("Provider returned an error response"), {
      responseBody: JSON.stringify({ error: { message: "invalid/does-not-exist is not a valid model ID" } }),
    });
    expect(describeError({ success: false, error: providerError })).toBe(
      "invalid/does-not-exist is not a valid model ID",
    );
  });

  it("uses a raw non-JSON response body rather than nothing", () => {
    const error = Object.assign(new Error("Bad status"), { responseBody: "  Service Unavailable  " });
    expect(describeError(error)).toBe("Service Unavailable");
  });

  it("never returns [object Object] for a message-less object", () => {
    const result = describeError({ code: "ETIMEDOUT", retries: 3 });
    expect(result).not.toBe("[object Object]");
    expect(result).toContain("ETIMEDOUT");
  });

  it("passes a plain string through and falls back cleanly on empty/null", () => {
    expect(describeError("rate limited")).toBe("rate limited");
    expect(describeError(null)).toBe("Unknown error");
    expect(describeError("   ")).toBe("Unknown error");
  });
});
