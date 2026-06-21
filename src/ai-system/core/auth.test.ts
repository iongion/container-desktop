import { describe, expect, it } from "vitest";

import { buildAuthHeaders, schemeNeedsSecret } from "./auth";
import type { AIAuthSettings } from "./types";

describe("buildAuthHeaders", () => {
  it("returns no headers for the 'none' scheme", () => {
    expect(buildAuthHeaders({ scheme: "none" }, "ignored")).toEqual({});
  });

  it("returns no headers for 'bearer' (bearer is applied via the native apiKey arg, not a header)", () => {
    // Bearer tokens ride the AI-SDK provider's apiKey (Anthropic → x-api-key, OpenAI → Authorization:
    // Bearer) so buildAuthHeaders deliberately emits nothing — a hand-built Authorization here would
    // 401 Anthropic.
    expect(buildAuthHeaders({ scheme: "bearer" }, "sk-secret")).toEqual({});
  });

  it("builds a Basic Authorization header from username + secret", () => {
    const auth: AIAuthSettings = { scheme: "basic", username: "user" };
    expect(buildAuthHeaders(auth, "pass")).toEqual({ Authorization: `Basic ${btoa("user:pass")}` });
  });

  it("treats a missing basic username as empty (encodes ':secret')", () => {
    expect(buildAuthHeaders({ scheme: "basic" }, "pass")).toEqual({ Authorization: `Basic ${btoa(":pass")}` });
  });

  it("omits the Basic header when no secret is provided", () => {
    expect(buildAuthHeaders({ scheme: "basic", username: "user" }, undefined)).toEqual({});
  });

  it("builds a custom header from headerName + secret", () => {
    const auth: AIAuthSettings = { scheme: "header", headerName: "X-API-Key" };
    expect(buildAuthHeaders(auth, "abc123")).toEqual({ "X-API-Key": "abc123" });
  });

  it("omits the custom header when the header name is missing", () => {
    expect(buildAuthHeaders({ scheme: "header" }, "abc123")).toEqual({});
  });

  it("omits the custom header when no secret is provided", () => {
    expect(buildAuthHeaders({ scheme: "header", headerName: "X-API-Key" }, undefined)).toEqual({});
  });
});

describe("schemeNeedsSecret", () => {
  it("is false only for the 'none' scheme", () => {
    expect(schemeNeedsSecret("none")).toBe(false);
  });

  it("is true for bearer, basic and header (each carries a secret)", () => {
    expect(schemeNeedsSecret("bearer")).toBe(true);
    expect(schemeNeedsSecret("basic")).toBe(true);
    expect(schemeNeedsSecret("header")).toBe(true);
  });
});
