import { describe, expect, it } from "vitest";

import type { PiSessionSummary } from "@/pi-bridge/protocol";
import {
  currentWorkspaceSessionName,
  filterWorkspaceSessions,
  workspaceSessionTitle,
} from "@/web-app/screens/AI/workspaceSessions";

function session(overrides: Partial<PiSessionSummary>): PiSessionSummary {
  return {
    path: "/home/agent/.pi/agent/sessions/one.jsonl",
    id: "one",
    modified: "2026-08-05T10:00:00.000Z",
    messageCount: 2,
    firstMessage: "",
    current: false,
    ...overrides,
  };
}

describe("workspaceSessionTitle", () => {
  it("prefers the name the user gave the session", () => {
    expect(workspaceSessionTitle(session({ name: "Release triage", firstMessage: "how many containers?" }))).toBe(
      "Release triage",
    );
  });

  it("falls back to the words the conversation opened with", () => {
    expect(workspaceSessionTitle(session({ firstMessage: "how many containers?" }))).toBe("how many containers?");
  });

  it("answers empty for a session with neither, so the caller can say what it is called instead", () => {
    expect(workspaceSessionTitle(session({ name: "   ", firstMessage: "  " }))).toBe("");
  });
});

describe("filterWorkspaceSessions", () => {
  const sessions = [
    session({ id: "a", path: "/a.jsonl", name: "Release triage", firstMessage: "how many containers?" }),
    session({ id: "b", path: "/b.jsonl", firstMessage: "walk me through the build" }),
  ];

  it("keeps every session, in the order the container listed them, when nothing is typed", () => {
    expect(filterWorkspaceSessions(sessions, "  ").map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("matches the name however it was capitalised", () => {
    expect(filterWorkspaceSessions(sessions, "RELEASE").map((entry) => entry.id)).toEqual(["a"]);
  });

  it("matches the first message too, because that is what an unnamed row shows", () => {
    expect(filterWorkspaceSessions(sessions, "build").map((entry) => entry.id)).toEqual(["b"]);
  });

  it("answers nothing when the query matches nothing", () => {
    expect(filterWorkspaceSessions(sessions, "swarm")).toEqual([]);
  });
});

describe("currentWorkspaceSessionName", () => {
  it("reads pi's own name for the conversation the container is on", () => {
    expect(
      currentWorkspaceSessionName([
        session({ id: "a", name: "Release triage", current: true }),
        session({ id: "b", name: "Older" }),
      ]),
    ).toBe("Release triage");
  });

  it("answers nothing when the current conversation was never named", () => {
    expect(currentWorkspaceSessionName([session({ id: "a", current: true })])).toBeUndefined();
  });

  it("answers nothing when no row claims to be current", () => {
    expect(currentWorkspaceSessionName([session({ id: "a", name: "Release triage" })])).toBeUndefined();
  });
});
