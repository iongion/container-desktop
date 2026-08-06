import { describe, expect, it } from "vitest";

import { sessionLaunchers } from "@/ai-system/core/sessionLaunchers";

const podman = { id: "podman-1", connected: true };
const docker = { id: "docker-1", connected: true };

describe("sessionLaunchers", () => {
  // The bootstrap: with nothing configured there is still something to click, built from what the app already knows.
  it("offers a default for a connection that has never been set up", () => {
    expect(sessionLaunchers({ connections: [podman], workspaceRoot: "/home/me/project" })).toEqual([
      {
        connectionId: "podman-1",
        name: "Default",
        isDefault: true,
        workspacePath: "/home/me/project",
        state: "absent",
        action: "start",
        egress: true,
      },
    ]);
  });

  // Without a workspace there is nothing to mount, so there is nothing to offer — that connection needs the one
  // question answered first.
  it("offers nothing it could not actually start", () => {
    expect(sessionLaunchers({ connections: [podman] })).toEqual([]);
  });

  // The state is still told apart — the row says which it is — but the VERB is not, because the difference costs the
  // user nothing: a rebuilt pair finds its conversation in the volume, so continuing means the same thing either way.
  it("offers one verb for a session that exists, whether its containers are up or stopped", () => {
    const rows = sessionLaunchers({
      connections: [podman, docker],
      configured: {
        "podman-1": { workspacePath: "/home/me/a", modelId: "qwen3-4b" },
        "docker-1": { workspacePath: "/home/me/b", modelId: "claude-sonnet-4" },
      },
      discovered: [
        { connectionId: "podman-1", complete: true, running: true },
        { connectionId: "docker-1", complete: true, running: false },
      ],
    });
    expect(rows.map((row) => [row.connectionId, row.state, row.action])).toEqual([
      ["podman-1", "running", "continue"],
      ["docker-1", "stopped", "continue"],
    ]);
  });

  // Half a pair cannot serve, and nothing removes it for the user any more — so it reads as not there yet and
  // starting rebuilds it.
  it("treats half a pair as nothing to resume", () => {
    const [row] = sessionLaunchers({
      connections: [podman],
      configured: { "podman-1": { workspacePath: "/home/me/a" } },
      discovered: [{ connectionId: "podman-1", complete: false, running: false }],
    });
    expect(row).toMatchObject({ state: "absent", action: "start" });
  });

  it("uses the name the user gave the session", () => {
    const [row] = sessionLaunchers({
      connections: [podman],
      configured: { "podman-1": { workspacePath: "/home/me/a", name: "Scheduler work" } },
    });
    expect(row).toMatchObject({ name: "Scheduler work", isDefault: false });
  });

  it("carries what the session may reach, so a row can say it", () => {
    const [row] = sessionLaunchers({
      connections: [podman],
      configured: { "podman-1": { workspacePath: "/home/me/a", egress: false } },
    });
    expect(row.egress).toBe(false);
  });

  // Every action runs a command against the engine, so a connection the app cannot reach has nothing to offer.
  it("leaves out a connection that is not connected", () => {
    expect(
      sessionLaunchers({
        connections: [{ id: "podman-1", connected: false }],
        configured: { "podman-1": { workspacePath: "/home/me/a" } },
      }),
    ).toEqual([]);
  });

  // A configured session is the user's own decision and comes first; an unconfigured connection's default is an
  // offer, so it goes after.
  it("puts configured sessions before offered ones", () => {
    const rows = sessionLaunchers({
      connections: [podman, docker],
      configured: { "docker-1": { workspacePath: "/home/me/b", name: "Scheduler work" } },
      workspaceRoot: "/home/me/project",
    });
    expect(rows.map((row) => row.name)).toEqual(["Scheduler work", "Default"]);
  });

  // This app favours podman, so where it offers a default rather than following the user's own choice, podman is the
  // one it offers — whatever order the connections happen to arrive in.
  it("offers podman first when it is running", () => {
    const rows = sessionLaunchers({
      connections: [
        { id: "docker-1", connected: true, engine: "docker" },
        { id: "podman-1", connected: true, engine: "podman" },
      ],
      workspaceRoot: "/home/me/project",
    });
    expect(rows.map((row) => row.connectionId)).toEqual(["podman-1", "docker-1"]);
  });

  it("falls back to whatever is available when podman is not", () => {
    const rows = sessionLaunchers({
      connections: [
        { id: "docker-1", connected: true, engine: "docker" },
        { id: "container-1", connected: true, engine: "container" },
      ],
      workspaceRoot: "/home/me/project",
    });
    expect(rows[0].connectionId).toBe("docker-1");
  });

  // A podman connection that is not running cannot be favoured — it cannot be acted on at all.
  it("does not favour a podman connection that is not running", () => {
    const rows = sessionLaunchers({
      connections: [
        { id: "docker-1", connected: true, engine: "docker" },
        { id: "podman-1", connected: false, engine: "podman" },
      ],
      workspaceRoot: "/home/me/project",
    });
    expect(rows.map((row) => row.connectionId)).toEqual(["docker-1"]);
  });

  // The preference is about what the app OFFERS, never about reordering what the user configured themselves.
  it("leaves the user's own sessions in their own order", () => {
    const rows = sessionLaunchers({
      connections: [
        { id: "docker-1", connected: true, engine: "docker" },
        { id: "podman-1", connected: true, engine: "podman" },
      ],
      configured: {
        "docker-1": { workspacePath: "/home/me/b", name: "Scheduler work" },
        "podman-1": { workspacePath: "/home/me/a", name: "Rally counter" },
      },
    });
    expect(rows.map((row) => row.name)).toEqual(["Scheduler work", "Rally counter"]);
  });
});
