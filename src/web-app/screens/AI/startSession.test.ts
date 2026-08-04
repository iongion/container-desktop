import { describe, expect, it } from "vitest";

import { DEFAULT_AI_SETTINGS } from "@/ai-system/core/settings";
import type { AISettings } from "@/ai-system/core/types";

import { type CodingAgentStartForm, resolveCodingAgentStart } from "./startSession";

const settings = (patch?: Partial<AISettings>): AISettings => ({ ...DEFAULT_AI_SETTINGS, ...patch });

const form = (patch?: Partial<CodingAgentStartForm>): CodingAgentStartForm => ({
  connectionId: "podman-default",
  workspacePath: "/home/you/code/my-app",
  providerId: "lmstudio",
  model: "qwen3-coder-30b",
  egress: true,
  ...patch,
});

describe("resolveCodingAgentStart", () => {
  it("resolves a keyless local provider into start options", () => {
    const result = resolveCodingAgentStart(form(), { settings: settings(), appVersion: "6.0.0", keyPresent: false });
    expect(result.problems).toEqual([]);
    expect(result.options).toEqual({
      connectionId: "podman-default",
      workspacePath: "/home/you/code/my-app",
      modelId: "qwen3-coder-30b",
      providerId: "lmstudio",
      providerKind: "local",
      upstreamAuth: { scheme: "none" },
      upstreamBaseUrl: "http://127.0.0.1:1234/v1",
      appVersion: "6.0.0",
      egress: true,
    });
  });

  // The gateway signs Anthropic with x-api-key and pi speaks /v1/messages to it, so both shapes have to travel
  // with the provider rather than being assumed OpenAI-shaped downstream.
  it("carries the provider's wire shape and credential shape", () => {
    const result = resolveCodingAgentStart(form({ providerId: "anthropic", model: "claude-sonnet-4-5" }), {
      settings: settings(),
      appVersion: "6.0.0",
      keyPresent: true,
    });
    expect(result.options?.providerKind).toBe("anthropic");
    expect(result.options?.upstreamAuth).toEqual({ scheme: "bearer" });
  });

  it("carries the egress choice through", () => {
    const result = resolveCodingAgentStart(form({ egress: false }), {
      settings: settings(),
      appVersion: "6.0.0",
      keyPresent: false,
    });
    expect(result.options?.egress).toBe(false);
  });

  // The workspace is the only thing the agent can read or write, so an empty one is not a start.
  it("refuses a blank workspace path", () => {
    const result = resolveCodingAgentStart(form({ workspacePath: "   " }), {
      settings: settings(),
      appVersion: "6.0.0",
      keyPresent: false,
    });
    expect(result.problems).toEqual(["no-workspace"]);
    expect(result.options).toBeUndefined();
  });

  it("refuses a missing connection", () => {
    const result = resolveCodingAgentStart(form({ connectionId: "" }), {
      settings: settings(),
      appVersion: "6.0.0",
      keyPresent: false,
    });
    expect(result.problems).toEqual(["no-connection"]);
  });

  // The picker leaves the model empty until discovery answers; the provider's saved model is the fallback.
  it("falls back to the provider's saved model", () => {
    const result = resolveCodingAgentStart(form({ model: "" }), {
      settings: settings({ providers: { lmstudio: { model: "saved-model" } } }),
      appVersion: "6.0.0",
      keyPresent: false,
    });
    expect(result.problems).toEqual([]);
    expect(result.options?.modelId).toBe("saved-model");
  });

  it("refuses when neither the form nor the provider names a model", () => {
    const result = resolveCodingAgentStart(form({ model: "" }), {
      settings: settings({ providers: { lmstudio: { model: "" } } }),
      appVersion: "6.0.0",
      keyPresent: false,
    });
    expect(result.problems).toEqual(["no-model"]);
  });

  it("refuses a provider that requires a key when none is stored", () => {
    const result = resolveCodingAgentStart(form({ providerId: "openrouter", model: "qwen/qwen3-coder:free" }), {
      settings: settings(),
      appVersion: "6.0.0",
      keyPresent: false,
    });
    expect(result.problems).toEqual(["missing-key"]);
    expect(result.options).toBeUndefined();
  });

  it("resolves a cloud provider once its key is stored", () => {
    const result = resolveCodingAgentStart(form({ providerId: "openrouter", model: "qwen/qwen3-coder:free" }), {
      settings: settings(),
      appVersion: "6.0.0",
      keyPresent: true,
    });
    expect(result.problems).toEqual([]);
    expect(result.options?.upstreamBaseUrl).toBe("https://openrouter.ai/api/v1");
    expect(result.options?.providerId).toBe("openrouter");
  });

  // A provider id that is not configured at all cannot yield an endpoint, and resolveProvider throws on it.
  it("reports an unconfigured provider instead of throwing", () => {
    const result = resolveCodingAgentStart(form({ providerId: "not-a-provider" }), {
      settings: settings(),
      appVersion: "6.0.0",
      keyPresent: false,
    });
    expect(result.problems).toEqual(["no-provider"]);
  });

  it("reports a configured provider with no endpoint", () => {
    const result = resolveCodingAgentStart(form({ providerId: "custom" }), {
      settings: settings({ providers: { custom: { model: "m" } } }),
      appVersion: "6.0.0",
      keyPresent: false,
    });
    expect(result.problems).toEqual(["no-endpoint"]);
  });

  // Every problem is reported at once: fixing them one round-trip at a time is the worse form.
  it("reports every problem together", () => {
    const result = resolveCodingAgentStart(form({ connectionId: "", workspacePath: "", providerId: "openrouter" }), {
      settings: settings(),
      appVersion: "6.0.0",
      keyPresent: false,
    });
    expect(result.problems).toEqual(["no-connection", "no-workspace", "missing-key"]);
  });
});
