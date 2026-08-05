import { describe, expect, it } from "vitest";

import { decidePiToolCall, isPiToolGated, piApprovalSummary, piPermissionContext } from "@/ai-system/core/piApprovals";

describe("isPiToolGated", () => {
  it("leaves pi's read-only tools ungated", () => {
    for (const tool of ["read", "grep", "find", "ls"]) expect(isPiToolGated(tool)).toBe(false);
  });

  it("gates the mutating tools", () => {
    for (const tool of ["bash", "write", "edit"]) expect(isPiToolGated(tool)).toBe(true);
  });

  it("gates a tool it has never heard of", () => {
    expect(isPiToolGated("deploy_to_prod")).toBe(true);
  });

  // Its gate is the user's own switch in Settings → AI, which is off until they turn it on, and the broker refuses
  // the call while it is off. A card in front of every query would only ask again what that switch already answered.
  it("leaves web search to the setting that governs it, not a card per query", () => {
    expect(isPiToolGated("webSearch")).toBe(false);
  });

  // The container toolset arrives over the bridge as ordinary tool calls, so without this the gate would put an
  // approval card in front of every `listContainers` — and none in front of `removeContainer`, since the pi
  // built-in list knows neither name.
  it("leaves the container reads ungated", () => {
    for (const tool of [
      "listConnections",
      "listContainers",
      "inspectContainer",
      "getContainerLogs",
      "getContainerStats",
      "listImages",
      "inspectImage",
      "listNetworks",
      "inspectNetwork",
      "listVolumes",
      "inspectVolume",
    ]) {
      expect(isPiToolGated(tool)).toBe(false);
    }
  });

  it("gates every container mutation", () => {
    for (const tool of [
      "startContainer",
      "stopContainer",
      "restartContainer",
      "pauseContainer",
      "unpauseContainer",
      "removeContainer",
      "removeImage",
      "removeNetwork",
      "removeVolume",
      "pullImage",
    ]) {
      expect(isPiToolGated(tool)).toBe(true);
    }
  });
});

describe("decidePiToolCall", () => {
  it("runs an ungated read without asking, in every mode", () => {
    for (const mode of ["ask", "remember", "allow"] as const) {
      expect(decidePiToolCall({ toolName: "read", mode })).toBe("run");
    }
  });

  it("asks before a shell command in ask mode", () => {
    expect(decidePiToolCall({ toolName: "bash", mode: "ask" })).toBe("ask");
  });

  it("ignores a remembered allow in ask mode", () => {
    expect(decidePiToolCall({ toolName: "bash", mode: "ask", cached: "allow" })).toBe("ask");
  });

  it("runs everything in allow mode", () => {
    expect(decidePiToolCall({ toolName: "bash", mode: "allow" })).toBe("run");
  });

  it("honours a remembered verdict in remember mode", () => {
    expect(decidePiToolCall({ toolName: "bash", mode: "remember", cached: "allow" })).toBe("run");
    expect(decidePiToolCall({ toolName: "bash", mode: "remember", cached: "block" })).toBe("reject");
    expect(decidePiToolCall({ toolName: "bash", mode: "remember" })).toBe("ask");
  });

  // A container mutation reaches the app TWICE — first as pi's pre-call gate, then as the operation the app
  // performs itself — so only the boundary that can hold the request and run it may ask. Gating both asked the
  // user twice for one removal, measured against a real model.
  it("leaves a container mutation to the boundary that performs it", () => {
    expect(decidePiToolCall({ toolName: "removeContainer", mode: "ask", boundary: "tool-call" })).toBe("run");
    expect(decidePiToolCall({ toolName: "removeContainer", mode: "ask", boundary: "engine-op" })).toBe("ask");
  });

  it("keeps deciding pi's own tools at the pre-call boundary", () => {
    expect(decidePiToolCall({ toolName: "bash", mode: "ask", boundary: "tool-call" })).toBe("ask");
    expect(decidePiToolCall({ toolName: "read", mode: "ask", boundary: "tool-call" })).toBe("run");
  });

  it("does not defer a remembered container block, which no second boundary would see", () => {
    expect(
      decidePiToolCall({ toolName: "removeContainer", mode: "remember", cached: "block", boundary: "engine-op" }),
    ).toBe("reject");
  });
});

describe("piApprovalSummary", () => {
  it("shows the shell command a bash call would run", () => {
    expect(piApprovalSummary("bash", { command: "rm -rf build" })).toBe("rm -rf build");
  });

  it("shows the path a write or edit would touch", () => {
    expect(piApprovalSummary("write", { path: "src/app.ts" })).toBe("src/app.ts");
    expect(piApprovalSummary("edit", { path: "src/app.ts", edits: [] })).toBe("src/app.ts");
  });

  it("falls back to the tool name when the arguments say nothing useful", () => {
    expect(piApprovalSummary("deploy", { region: "eu" })).toBe("deploy");
  });

  it("names the entity a container mutation would act on, and where", () => {
    expect(piApprovalSummary("removeContainer", { id: "c1", connectionId: "podman-dev" })).toBe("c1 on podman-dev");
    expect(piApprovalSummary("pullImage", { reference: "nginx:latest", connectionId: "docker-1" })).toBe(
      "nginx:latest on docker-1",
    );
  });

  it("omits the connection when the call did not name one", () => {
    expect(piApprovalSummary("stopContainer", { id: "c1" })).toBe("c1");
  });

  it("keeps a long command inside the timeline item's limit", () => {
    const summary = piApprovalSummary("bash", { command: "x".repeat(40_000) });
    expect(summary.length).toBeLessThanOrEqual(2_000);
  });
});

describe("piPermissionContext", () => {
  it("scopes a remembered verdict to the workspace and connection, not to the session", () => {
    const first = piPermissionContext({ workspacePath: "/work", connectionId: "podman-1" });
    const second = piPermissionContext({ workspacePath: "/work", connectionId: "podman-1" });
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain("cd-agent-");
  });

  it("keeps different workspaces apart", () => {
    expect(piPermissionContext({ workspacePath: "/a", connectionId: "c" })).not.toEqual(
      piPermissionContext({ workspacePath: "/b", connectionId: "c" }),
    );
  });
});
