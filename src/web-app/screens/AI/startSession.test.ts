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
  // The default the drawer opens with: the agent keeps its own container's view of the workspace and reaches nowhere
  // else until the user says so.
  executionKind: "off",
  executionRef: "",
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

describe("the workspace execution target", () => {
  const context = { settings: settings(), appVersion: "6.1.0", keyPresent: false };

  it("carries no target by default, so the toolset is not offered", () => {
    expect(resolveCodingAgentStart(form(), context).options?.executionTarget).toBeUndefined();
  });

  // A target is a container, and nothing else. Reaching one is the connection's job — local, in a machine VM or
  // across SSH — so the form never offers "this machine" or "the engine's host" as targets of their own.
  it("offers containers only, each reached through the session's connection", () => {
    expect(
      resolveCodingAgentStart(form({ executionKind: "container", executionRef: "web-1" }), context).options
        ?.executionTarget?.kind,
    ).toBe("container");
    expect(
      resolveCodingAgentStart(form({ executionKind: "sandbox", executionRef: "alpine:3" }), context).options
        ?.executionTarget?.kind,
    ).toBe("sandbox");
  });

  it("acts through the connection the session runs on, for a container and for a sandbox", () => {
    expect(
      resolveCodingAgentStart(form({ executionKind: "container", executionRef: "web-1" }), context).options
        ?.executionTarget,
    ).toEqual({ kind: "container", connectionId: "podman-default", containerId: "web-1" });
    expect(
      resolveCodingAgentStart(form({ executionKind: "sandbox", executionRef: "alpine:3" }), context).options
        ?.executionTarget,
    ).toEqual({ kind: "sandbox", connectionId: "podman-default", image: "alpine:3" });
  });

  // Neither a container to run in nor an image to build one from has a default worth inventing, so the form says so
  // rather than starting a session whose every workspace call would fail.
  it("refuses a container or a sandbox with nothing named", () => {
    for (const executionKind of ["container", "sandbox"] as const) {
      const resolved = resolveCodingAgentStart(form({ executionKind, executionRef: "  " }), context);
      expect(resolved.problems).toContain("no-execution-ref");
      expect(resolved.options).toBeUndefined();
    }
  });
});
