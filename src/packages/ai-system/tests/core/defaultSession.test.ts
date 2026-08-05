import { describe, expect, it } from "vitest";

import { planDefaultSession } from "@/ai-system/core/defaultSession";

const podman = { id: "podman-1", connected: true };
const docker = { id: "docker-1", connected: true };
const workspace = { workspacePath: "/home/me/project" };

describe("planDefaultSession", () => {
  // The complaint this whole design answers: quitting the app should not cost you the session. A pair that is
  // standing and running is adopted in silence — no drawer, no question.
  it("adopts a running session without asking", () => {
    expect(
      planDefaultSession({
        connections: [podman],
        configured: { "podman-1": workspace },
        discovered: [{ connectionId: "podman-1", complete: true, running: true }],
      }),
    ).toEqual({ kind: "adopt", connectionId: "podman-1" });
  });

  // Stopped is not gone. The containers hold the conversation, so the offer is to continue it — which is why this
  // lands in the NonIdealState as Resume rather than as "start a session".
  it("offers to resume a session that is merely stopped", () => {
    expect(
      planDefaultSession({
        connections: [podman],
        configured: { "podman-1": workspace },
        discovered: [{ connectionId: "podman-1", complete: true, running: false }],
      }),
    ).toEqual({ kind: "resume", connectionIds: ["podman-1"] });
  });

  it("adopts a running session rather than offering to resume a stopped one elsewhere", () => {
    expect(
      planDefaultSession({
        connections: [podman, docker],
        configured: { "podman-1": workspace, "docker-1": workspace },
        discovered: [
          { connectionId: "podman-1", complete: true, running: false },
          { connectionId: "docker-1", complete: true, running: true },
        ],
      }),
    ).toEqual({ kind: "adopt", connectionId: "docker-1" });
  });

  // Configured but nothing standing — the containers were removed, or this is the first boot after setup. The
  // configuration says everything needed, so it is rebuilt without a question.
  it("rebuilds a configured session whose containers are gone", () => {
    expect(
      planDefaultSession({ connections: [podman], configured: { "podman-1": workspace }, discovered: [] }),
    ).toEqual({ kind: "create", connectionId: "podman-1" });
  });

  it("asks once when the assistant has never been set up", () => {
    const plan = planDefaultSession({ connections: [podman, docker] });
    expect(plan.kind).toBe("configure");
  });

  // The nicety: with one connection there is nothing to choose, and with a workspace already known there is nothing
  // to type. The one permitted question becomes one click.
  it("answers its own question when there is one connection and a known workspace", () => {
    expect(planDefaultSession({ connections: [podman], workspaceRoot: "/home/me/project" })).toEqual({
      kind: "configure",
      connectionId: "podman-1",
      workspacePath: "/home/me/project",
      ready: true,
    });
  });

  // Two engines is a real choice about where containers run, so it stays the user's.
  it("does not pick the connection for the user when there are several", () => {
    const plan = planDefaultSession({ connections: [podman, docker], workspaceRoot: "/home/me/project" });
    expect(plan).toMatchObject({ kind: "configure", ready: false });
    expect(plan).not.toHaveProperty("connectionId");
  });

  // The workspace is the folder that gets mounted and written to. Never guessed.
  it("will not invent a workspace it was not given", () => {
    expect(planDefaultSession({ connections: [podman] })).toEqual({
      kind: "configure",
      connectionId: "podman-1",
      ready: false,
    });
  });

  // A session on an engine the app cannot reach cannot be adopted, resumed or rebuilt — every one of those runs a
  // command against it.
  it("ignores a session on a connection that is not connected", () => {
    const plan = planDefaultSession({
      connections: [{ id: "podman-1", connected: false }],
      configured: { "podman-1": workspace },
      discovered: [{ connectionId: "podman-1", complete: true, running: true }],
    });
    expect(plan.kind).toBe("configure");
  });

  // Half a pair was already cleared by the reaper, so what reaches here is not resumable — it has to be rebuilt.
  it("rebuilds rather than resumes when only half the pair was found", () => {
    expect(
      planDefaultSession({
        connections: [podman],
        configured: { "podman-1": workspace },
        discovered: [{ connectionId: "podman-1", complete: false, running: false }],
      }),
    ).toEqual({ kind: "create", connectionId: "podman-1" });
  });

  it("lists every stopped session so the user picks which to continue", () => {
    expect(
      planDefaultSession({
        connections: [podman, docker],
        configured: { "podman-1": workspace, "docker-1": workspace },
        discovered: [
          { connectionId: "podman-1", complete: true, running: false },
          { connectionId: "docker-1", complete: true, running: false },
        ],
      }),
    ).toEqual({ kind: "resume", connectionIds: ["podman-1", "docker-1"] });
  });
});
