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
