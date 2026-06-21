import { describe, expect, it } from "vitest";

import { redactPayload, redactText } from "./redact";

describe("redactText", () => {
  it("redacts Authorization bearer tokens", () => {
    expect(redactText("Authorization: Bearer sk-ant-abc123XYZ")).toBe("Authorization: Bearer [REDACTED]");
  });

  it("redacts known provider key prefixes (anthropic/openai/github)", () => {
    expect(redactText("key=sk-ant-api03-AAAABBBBCCCCDDDD")).not.toContain("AAAABBBB");
    expect(redactText("token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")).toContain("[REDACTED]");
    expect(redactText("openai sk-proj-ABCDEFGHIJKLMNOPqrstuv")).toContain("[REDACTED]");
  });

  it("redacts the value of secret-looking env assignments but keeps the name", () => {
    expect(redactText("ANTHROPIC_API_KEY=sk-ant-secret-value")).toBe("ANTHROPIC_API_KEY=[REDACTED]");
    expect(redactText("REGISTRY_PASSWORD=hunter2")).toBe("REGISTRY_PASSWORD=[REDACTED]");
  });

  it("redacts credentials embedded in URLs", () => {
    expect(redactText("https://admin:hunter2@registry.example.com/v2")).toBe(
      "https://admin:[REDACTED]@registry.example.com/v2",
    );
  });

  it("redacts JWT-shaped tokens", () => {
    expect(redactText("session eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT")).toBe("session [REDACTED]");
  });

  it("leaves ordinary diagnostic text untouched (no over-redaction)", () => {
    const text = "podman ps -a && echo monkey=banana";
    expect(redactText(text)).toBe(text);
  });

  it("redacts the registry auth blob in a docker/podman config (read as raw JSON text)", () => {
    const cfg = '{"auths":{"registry.io":{"auth":"dXNlcjpwYXNzd29yZA=="}}}';
    const out = redactText(cfg);
    expect(out).not.toContain("dXNlcjpwYXNzd29yZA==");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts JSON string values under secret-looking keys (inspect/config output)", () => {
    expect(redactText('"password": "hunter2"')).toContain("[REDACTED]");
    expect(redactText('"password": "hunter2"')).not.toContain("hunter2");
    expect(redactText('"apiKey":"abcd1234efgh"')).not.toContain("abcd1234efgh");
    expect(redactText('"identitytoken": "eyabc.def"')).toContain("[REDACTED]");
  });

  it("does NOT over-redact a benign 'author' field", () => {
    expect(redactText('"author": "Jane Doe"')).toBe('"author": "Jane Doe"');
  });

  it("redacts a Stripe secret-key prefix", () => {
    expect(redactText("STRIPE=sk_live_abcdEFGH1234ijklMNOP")).not.toContain("abcdEFGH1234");
  });
});

describe("redactPayload", () => {
  it("redacts values under secret-looking keys regardless of case", () => {
    const out = redactPayload({ apiKey: "sk-ant-123", Authorization: "Bearer x", model: "claude-x" });
    expect(out.apiKey).toBe("[REDACTED]");
    expect(out.Authorization).toBe("[REDACTED]");
    expect(out.model).toBe("claude-x");
  });

  it("recurses into nested objects and arrays", () => {
    const out = redactPayload({
      headers: { authorization: "Bearer z" },
      notes: ["my token ghp_AAAAAAAAAAAAAAAAAAAAAA"],
    });
    expect(out.headers.authorization).toBe("[REDACTED]");
    expect(out.notes[0]).toContain("[REDACTED]");
  });

  it("preserves non-string scalars and overall structure", () => {
    const out = redactPayload({ port: 8080, enabled: true, model: "m" });
    expect(out).toEqual({ port: 8080, enabled: true, model: "m" });
  });

  it("does not mutate the input", () => {
    const input = { password: "p", nested: { token: "t" } };
    const out = redactPayload(input);
    expect(input.password).toBe("p");
    expect(input.nested.token).toBe("t");
    expect(out.password).toBe("[REDACTED]");
  });
});
