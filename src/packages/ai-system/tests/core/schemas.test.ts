import { describe, expect, it } from "vitest";
import { AI_CHANNELS, type AIInvokeChannel } from "@/ai-system/core/channels";
import {
  executionTarget,
  validateAIInvokeRequest,
  validateAIInvokeResponse,
  validateAIPushPayload,
} from "@/ai-system/core/schemas";

const readyProjectContext = {
  state: "ready" as const,
  workspaceId: "a".repeat(64),
  workspaceRoot: "/workspace",
  rulesEnabled: false,
  rules: [],
  memory: [],
  pack: {
    workspaceId: "a".repeat(64),
    workspaceRoot: "/workspace",
    capturedAt: 1,
    fingerprint: "b".repeat(64),
    sections: [],
    budgetBytes: 48 * 1024,
    usedBytes: 0,
    omittedSources: 0,
    truncated: false,
    initialTaint: false,
  },
};

describe("executionTarget", () => {
  // A target is a CONTAINER, and the connection is how it is reached — so there are two kinds, not four. "This
  // machine" and "the engine's own host" are not targets: they name a transport, which the connection already is.
  it("accepts the two container kinds", () => {
    expect(executionTarget.safeParse({ kind: "container", connectionId: "c1", containerId: "abc" }).success).toBe(true);
    expect(executionTarget.safeParse({ kind: "sandbox", connectionId: "c1", image: "alpine:3" }).success).toBe(true);
  });

  it("refuses a target that is not a container, and one missing its id", () => {
    expect(executionTarget.safeParse({ kind: "host" }).success).toBe(false);
    expect(executionTarget.safeParse({ kind: "remote", connectionId: "c1" }).success).toBe(false);
    expect(executionTarget.safeParse({ kind: "container", connectionId: "c1" }).success).toBe(false);
    expect(executionTarget.safeParse({ kind: "sandbox", connectionId: "c1" }).success).toBe(false);
    expect(executionTarget.safeParse({ kind: "bogus" }).success).toBe(false);
    expect(
      executionTarget.safeParse({ kind: "container", connectionId: "c1", containerId: "abc", extra: true }).success,
    ).toBe(false);
  });
});

describe("AI protocol boundary validation", () => {
  // The host places the file; the caller only names it. A name that could escape that directory is refused
  // at the boundary, not sanitized later.
  it("refuses a gateway env file name that is a path", () => {
    const valid = {
      provider: "openrouter",
      fileName: "8f21ac-gateway.env",
      baseUrl: "https://openrouter.ai/api/v1",
      bridgeToken: "tok",
      gatewayPort: 8788,
    };
    expect(() => validateAIInvokeRequest(AI_CHANNELS.agentGatewayEnv, valid)).not.toThrow();
    for (const fileName of ["../../evil.env", "/etc/passwd", "nested/dir.env", "no-extension"]) {
      expect(() => validateAIInvokeRequest(AI_CHANNELS.agentGatewayEnv, { ...valid, fileName })).toThrow();
    }
    expect(() => validateAIInvokeRequest(AI_CHANNELS.agentGatewayEnv, { ...valid, baseUrl: "not a url" })).toThrow();
  });

  it("has a validator for every invoke channel", () => {
    const samples: Record<AIInvokeChannel, unknown> = {
      [AI_CHANNELS.status]: undefined,
      [AI_CHANNELS.diagnostics]: {},
      [AI_CHANNELS.keyHas]: { provider: "openai" },
      [AI_CHANNELS.keySet]: { provider: "openai", key: "secret" },
      [AI_CHANNELS.keyClear]: { provider: "openai" },
      [AI_CHANNELS.authRefreshEnv]: {
        provider: "anthropic",
        fileName: "8f21ac-refresh.env",
        bridgeToken: "t",
        bridgePort: 8787,
      },
      [AI_CHANNELS.agentGatewayEnv]: {
        provider: "openrouter",
        fileName: "8f21ac-gateway.env",
        baseUrl: "https://openrouter.ai/api/v1",
        bridgeToken: "tok",
        gatewayPort: 8788,
      },
      [AI_CHANNELS.agentEnvFile]: { fileName: "8f21ac.env", contents: "CD_BRIDGE_TOKEN=tok\nCD_BRIDGE_PORT=8787" },
      [AI_CHANNELS.changesStatus]: undefined,
      [AI_CHANNELS.changesDiff]: undefined,
      [AI_CHANNELS.projectContextSnapshot]: undefined,
      [AI_CHANNELS.projectRulesSetEnabled]: { enabled: true },
      [AI_CHANNELS.projectRulesInitialize]: undefined,
      [AI_CHANNELS.projectMemoryAdd]: { content: "Prefer focused tests." },
      [AI_CHANNELS.projectMemoryRemove]: { id: "memory-1" },
      [AI_CHANNELS.projectMemoryClear]: undefined,
      [AI_CHANNELS.projectMemoryImport]: JSON.stringify({ version: 1, entries: [] }),
      [AI_CHANNELS.modelsList]: { providerId: "openai", requestId: "request-1" },
      [AI_CHANNELS.modelsCancel]: { requestId: "request-1" },
      [AI_CHANNELS.modelWindow]: { providerId: "lmstudio", model: "qwen3-4b-instruct-2507" },
      [AI_CHANNELS.engineOp]: { op: "listContainers", args: { connectionId: "podman-1" } },
      [AI_CHANNELS.workspaceOp]: {
        op: "readFile",
        args: { path: "src/main.ts" },
        target: { kind: "sandbox", connectionId: "podman-1", image: "docker.io/library/alpine:3" },
        runId: "pi-session-8f21ac",
      },
      [AI_CHANNELS.workspaceRelease]: { runId: "pi-session-8f21ac" },
      [AI_CHANNELS.webSearch]: { query: "podman rootless" },
      [AI_CHANNELS.permissionsList]: undefined,
      [AI_CHANNELS.permissionsAdd]: {
        list: "allowed",
        rule: {
          workspaceId: "/work",
          targetId: "podman-1",
          subject: { kind: "access-profile", id: "pi-coding-agent" },
          operation: { kind: "tool", id: "bash" },
          normalizedArgs: '{"command":"ls"}',
          contentTrustEpoch: "pi",
        },
      },
      [AI_CHANNELS.permissionsRemove]: { list: "allowed", key: "rule" },
      [AI_CHANNELS.skillsSnapshot]: undefined,
      [AI_CHANNELS.skillsReload]: undefined,
      [AI_CHANNELS.skillsSetProjectSource]: { enabled: true },
      [AI_CHANNELS.skillsSetProjectTrust]: {
        skillId: "skill:project:review",
        expectedFingerprint: "a".repeat(64),
        trusted: true,
      },
      [AI_CHANNELS.skillsInvoke]: {
        skillId: "skill:user:review",
        expectedFingerprint: "a".repeat(64),
        arguments: "src",
      },
    };

    for (const [channel, payload] of Object.entries(samples)) {
      expect(() => validateAIInvokeRequest(channel as AIInvokeChannel, payload)).not.toThrow();
    }
  });

  it("rejects malformed, oversized, and extra invoke fields", () => {
    expect(() => validateAIInvokeRequest(AI_CHANNELS.webSearch, { query: "", extra: true })).toThrow();
    expect(() => validateAIInvokeRequest(AI_CHANNELS.permissionsList, {})).toThrow();
  });

  it("validates every push channel before renderer reduction", () => {
    expect(
      validateAIPushPayload(AI_CHANNELS.skillsChanged, {
        revision: "1",
        user: { root: "/data/skills", status: "ok" },
        skills: [],
        diagnostics: [],
      }),
    ).toEqual({
      revision: "1",
      user: { root: "/data/skills", status: "ok" },
      skills: [],
      diagnostics: [],
    });
    expect(() => validateAIPushPayload(AI_CHANNELS.skillsChanged, { revision: "1" })).toThrow();
  });

  it("validates invoke responses before they enter renderer state", () => {
    const _session = {
      id: "session-1",
      title: "Session",
      createdAt: 1,
      updatedAt: 1,
      phase: "idle" as const,
      lastSeq: 0,
    };
    const samples: Record<AIInvokeChannel, unknown> = {
      [AI_CHANNELS.status]: {
        encryption: { available: true, degraded: false },
        webSearchAvailable: true,
      },
      [AI_CHANNELS.agentGatewayEnv]: { path: "/home/me/.local/share/container-desktop/agent/8f21ac-gateway.env" },
      [AI_CHANNELS.agentEnvFile]: { path: "/home/me/.config/container-desktop/agent/8f21ac.env" },
      [AI_CHANNELS.authRefreshEnv]: { path: "/home/me/.config/container-desktop/agent/8f21ac-refresh.env" },
      [AI_CHANNELS.diagnostics]: {
        capturedAt: 1,
        provider: {
          id: "llamacpp",
          kind: "local",
          model: "model-1",
          destination: "local",
          credential: "not-required",
          reachability: "reachable",
          modelCount: 1,
        },
        security: {
          encryption: { available: true, degraded: false },
          permissions: "ok",
          webSearch: "disabled",
        },
        capabilities: {
          sandbox: true,
          containerTools: true,
          workspaceTools: false,
          executionTargets: false,
        },
        extensions: {
          skills: { state: "ok", count: 2, diagnostics: 0 },
          mcp: { state: "unavailable" },
        },
        recentErrors: [],
      },
      [AI_CHANNELS.keyHas]: true,
      [AI_CHANNELS.keySet]: { ok: true },
      [AI_CHANNELS.keyClear]: { ok: true },
      [AI_CHANNELS.changesStatus]: {
        origin: { kind: "app" },
        workspaceRoot: "/workspace",
        state: "changes",
        entries: [{ path: "src/app.ts", index: "modified", worktree: "unchanged" }],
        fingerprint: "a".repeat(64),
        truncated: false,
      },
      [AI_CHANNELS.changesDiff]: {
        origin: { kind: "app" },
        workspaceRoot: "/workspace",
        state: "changes",
        staged: "diff --git a/src/app.ts b/src/app.ts",
        unstaged: "",
        untracked: [],
        truncated: false,
      },
      [AI_CHANNELS.projectContextSnapshot]: readyProjectContext,
      [AI_CHANNELS.projectRulesSetEnabled]: readyProjectContext,
      [AI_CHANNELS.projectRulesInitialize]: { result: "created", snapshot: readyProjectContext },
      [AI_CHANNELS.projectMemoryAdd]: readyProjectContext,
      [AI_CHANNELS.projectMemoryRemove]: readyProjectContext,
      [AI_CHANNELS.projectMemoryClear]: readyProjectContext,
      [AI_CHANNELS.projectMemoryImport]: readyProjectContext,
      [AI_CHANNELS.modelsList]: { models: [{ id: "model-1" }] },
      [AI_CHANNELS.modelsCancel]: { ok: true },
      // Both fields optional: a provider that publishes no window answers `{}`, which is rendered as "unknown".
      [AI_CHANNELS.modelWindow]: { contextWindow: 40960 },
      [AI_CHANNELS.engineOp]: { ok: true, value: [{ Id: "c1" }] },
      [AI_CHANNELS.workspaceOp]: { ok: true, value: "file contents" },
      [AI_CHANNELS.workspaceRelease]: { ok: true },
      [AI_CHANNELS.webSearch]: { text: "rootless means no daemon" },
      [AI_CHANNELS.permissionsList]: {
        version: "2.0.0",
        allowed: [],
        blocked: [],
        status: "ok",
        path: "/tmp/permissions.json",
      },
      [AI_CHANNELS.permissionsAdd]: {
        version: "2.0.0",
        allowed: [],
        blocked: [],
        status: "ok",
        path: "/tmp/permissions.json",
      },
      [AI_CHANNELS.permissionsRemove]: {
        version: "2.0.0",
        allowed: [],
        blocked: [],
        status: "ok",
        path: "/tmp/permissions.json",
      },
      [AI_CHANNELS.skillsSnapshot]: {
        revision: "1",
        user: { root: "/data/skills", status: "ok" },
        skills: [],
        diagnostics: [],
      },
      [AI_CHANNELS.skillsReload]: {
        revision: "1",
        user: { root: "/data/skills", status: "ok" },
        skills: [],
        diagnostics: [],
      },
      [AI_CHANNELS.skillsSetProjectSource]: {
        revision: "2",
        user: { root: "/data/skills", status: "ok" },
        skills: [],
        diagnostics: [],
      },
      [AI_CHANNELS.skillsSetProjectTrust]: {
        revision: "3",
        user: { root: "/data/skills", status: "ok" },
        skills: [],
        diagnostics: [],
      },
      [AI_CHANNELS.skillsInvoke]: {
        prompt: "the rendered skill body",
        displayContent: "/skill:user:review src",
        skill: {
          skillId: "skill:user:review",
          command: "/skill:user:review",
          source: "user",
          fingerprint: "a".repeat(64),
        },
        allowedTools: ["read"],
      },
    };

    for (const [channel, response] of Object.entries(samples)) {
      expect(() => validateAIInvokeResponse(channel as AIInvokeChannel, response)).not.toThrow();
    }
    expect(() => validateAIInvokeResponse(AI_CHANNELS.modelsList, { models: [{ id: "" }] })).toThrow();
    expect(() => validateAIInvokeResponse(AI_CHANNELS.webSearch, { text: "ok", unexpected: true })).toThrow();
  });
});
