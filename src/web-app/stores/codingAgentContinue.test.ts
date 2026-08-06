import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PiBridgeClient } from "@/ai-system/adapters/piBridgeClient";
import { emptyPiSessionView } from "@/ai-system/core/piSessionView";
import type { PiSessionSummary } from "@/pi-bridge/protocol";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";

// Continuing a session that had to be rebuilt lands back on the conversation it had, instead of a blank one the
// button never promised. What is covered here is the choice itself and — the part that matters most — that making it
// only ever SELECTS: no conversation, past or present, is removed or rewritten to get there.

function summary(over: Partial<PiSessionSummary>): PiSessionSummary {
  return {
    path: "/sessions/a.jsonl",
    id: "a",
    modified: "2026-08-06T00:00:00.000Z",
    messageCount: 4,
    firstMessage: "hello",
    current: false,
    ...over,
  };
}

// Records every command the app sends pi, so a destructive one would be visible rather than assumed absent.
function attachClientAnswering(sessions: PiSessionSummary[]) {
  const commands: Array<{ name: string; args: string }> = [];
  const client = {
    onEvent: () => () => {},
    runCommand: vi.fn(async (name: string, args: string) => {
      commands.push({ name, args });
      return name === "resume" && args === "" ? { ok: true, data: { sessions } } : { ok: true, data: {} };
    }),
    close: vi.fn(),
  } as unknown as PiBridgeClient;
  useCodingAgentStore.setState({
    client,
    status: "ready",
    spec: { workspacePath: "/work" } as never,
    connectionId: "podman-1",
    view: emptyPiSessionView("pi-session"),
  });
  return commands;
}

describe("returning to the newest conversation", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
  });

  afterEach(() => {
    useCodingAgentStore.setState({ client: undefined, status: "idle", spec: undefined });
    (globalThis as { window?: unknown }).window = undefined;
    vi.clearAllMocks();
  });

  it("lands on the newest conversation that was actually spoken in", async () => {
    const commands = attachClientAnswering([
      // The blank one this rebuild just created sorts first, and is not somewhere to be returned to.
      summary({ id: "fresh", path: "/sessions/fresh.jsonl", messageCount: 0, current: true }),
      summary({ id: "yesterday", path: "/sessions/yesterday.jsonl", messageCount: 12 }),
      summary({ id: "older", path: "/sessions/older.jsonl", messageCount: 3 }),
    ]);

    await useCodingAgentStore.getState().resumeNewestConversation();

    expect(commands).toEqual([
      { name: "resume", args: "" },
      { name: "resume", args: "/sessions/yesterday.jsonl" },
    ]);
  });

  it("removes nothing to get there — every other conversation is left where it was", async () => {
    const commands = attachClientAnswering([
      summary({ id: "fresh", path: "/sessions/fresh.jsonl", messageCount: 0, current: true }),
      summary({ id: "yesterday", path: "/sessions/yesterday.jsonl", messageCount: 12 }),
      summary({ id: "older", path: "/sessions/older.jsonl", messageCount: 3 }),
    ]);

    await useCodingAgentStore.getState().resumeNewestConversation();

    // Selecting is the whole operation. Anything that could delete, prune, clear or compact a conversation would
    // show up here, and continuing a session must never be the thing that costs the user one.
    expect(commands.every((command) => command.name === "resume")).toBe(true);
    expect(commands.some((command) => /delete|remove|clear|prune|compact|clean/i.test(command.name))).toBe(false);
  });

  it("stays put when the newest conversation is already the one pi is on", async () => {
    const commands = attachClientAnswering([summary({ id: "same", messageCount: 9, current: true })]);

    await useCodingAgentStore.getState().resumeNewestConversation();

    expect(commands).toEqual([{ name: "resume", args: "" }]);
  });

  it("leaves a workspace with nothing said in it alone", async () => {
    const commands = attachClientAnswering([summary({ id: "fresh", messageCount: 0, current: true })]);

    await useCodingAgentStore.getState().resumeNewestConversation();

    expect(commands).toEqual([{ name: "resume", args: "" }]);
  });

  it("keeps the session when the conversation cannot be asked for", async () => {
    const client = {
      onEvent: () => () => {},
      runCommand: vi.fn(async () => ({ ok: false, error: "the socket went away" })),
      close: vi.fn(),
    } as unknown as PiBridgeClient;
    useCodingAgentStore.setState({ client, status: "ready", view: emptyPiSessionView("pi-session") });

    // The blank conversation the user would have had anyway is worth far less than failing the session itself.
    await expect(useCodingAgentStore.getState().resumeNewestConversation()).resolves.toBeUndefined();
    expect(useCodingAgentStore.getState().status).toBe("ready");
  });
});
