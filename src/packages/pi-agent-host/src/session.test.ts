import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createPiSession } from "@/pi-agent-host/session";
import type { BridgeEvent } from "@/pi-bridge/protocol";

// A canned provider stream: no network, no key, deterministic deltas. This is what makes the whole
// session wiring testable in the hermetic suite. Every event carries `partial` and `done` carries the
// finished `message` because that is what pi-ai's AssistantMessageEvent union requires — pi builds its
// context and usage accounting from those, not from the deltas.
const USAGE = {
  input: 1,
  output: 2,
  cacheRead: 0,
  cacheWrite: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const assistantMessage = (text: string, stopReason: string) => ({
  role: "assistant",
  content: text ? [{ type: "text", text }] : [],
  api: "openai-completions",
  provider: "container-desktop-gateway",
  model: "canned",
  usage: USAGE,
  stopReason,
  timestamp: 0,
});

const cannedStream = async function* () {
  yield { type: "start", partial: assistantMessage("", "stop") };
  yield { type: "text_start", contentIndex: 0, partial: assistantMessage("", "stop") };
  yield { type: "text_delta", contentIndex: 0, delta: "Hello ", partial: assistantMessage("Hello ", "stop") };
  yield { type: "text_delta", contentIndex: 0, delta: "world", partial: assistantMessage("Hello world", "stop") };
  yield {
    type: "text_end",
    contentIndex: 0,
    content: "Hello world",
    partial: assistantMessage("Hello world", "stop"),
  };
  yield { type: "done", reason: "stop", message: assistantMessage("Hello world", "stop") };
};

describe("createPiSession", () => {
  it("streams a canned turn out as bridge events", async () => {
    const events: BridgeEvent[] = [];
    const cwd = mkdtempSync(join(tmpdir(), "cd-pi-session-"));
    const session = await createPiSession({
      cwd,
      agentDir: mkdtempSync(join(tmpdir(), "cd-pi-agentdir-")),
      gatewayUrl: "http://gateway.invalid:8788/v1",
      gatewayToken: "tok",
      modelId: "canned",
      emit: (event) => events.push(event),
      streamOverride: cannedStream as never,
    });

    await session.prompt("say hello");

    const deltas = events.filter((event) => event.type === "assistant_delta");
    expect(deltas.map((event) => (event as { text: string }).text).join("")).toBe("Hello world");
    expect(events.some((event) => event.type === "assistant_end")).toBe(true);
    expect(events.some((event) => event.type === "idle")).toBe(true);
    expect(session.cwd).toBe(cwd);
    expect(session.sessionId.length).toBeGreaterThan(0);
  });
});
