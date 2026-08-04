import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { CONTAINER_TOOL_NAMES } from "@/ai-system/core/toolNames";
import { createPiSession, parseModelApi } from "@/pi-agent-host/session";
import type { BridgeEvent } from "@/pi-bridge/protocol";

// The real loader reads these out of a prompt resource that only esbuild inlines, so the session takes them as an
// argument and the suite supplies its own.
const CONTAINER_TOOL_DESCRIPTIONS = Object.fromEntries(CONTAINER_TOOL_NAMES.map((name) => [name, `does ${name}`]));

// The smallest real extension: one session_start handler, which is where a plugin first gets a ui context.
const onSessionStart = (name: string, run: (ctx: ExtensionContext) => void): InlineExtension => ({
  name,
  factory: (pi) => {
    pi.on("session_start", (_event, ctx) => run(ctx));
  },
});

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
      containerToolDescriptions: CONTAINER_TOOL_DESCRIPTIONS,
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

  it("runs extensions in tui mode, so a plugin component reaches the bridge as a surface frame", async () => {
    const events: BridgeEvent[] = [];
    const seen: { mode?: string } = {};
    const session = await createPiSession({
      cwd: mkdtempSync(join(tmpdir(), "cd-pi-session-")),
      agentDir: mkdtempSync(join(tmpdir(), "cd-pi-agentdir-")),
      gatewayUrl: "http://gateway.invalid:8788/v1",
      containerToolDescriptions: CONTAINER_TOOL_DESCRIPTIONS,
      gatewayToken: "tok",
      modelId: "canned",
      emit: (event) => events.push(event),
      streamOverride: cannedStream as never,
      extraExtensions: [
        onSessionStart("surface-probe", (ctx) => {
          seen.mode = ctx.mode;
          ctx.ui.setHeader(() => ({ render: () => ["probe header"], invalidate: () => {} }));
        }),
      ],
    });

    await session.prompt("say hello");

    expect(seen.mode).toBe("tui");
    const frame = events.find((event) => event.type === "surface_frame");
    expect(frame).toMatchObject({ lines: ["probe header"], slot: { kind: "header" } });
  });

  it("repaints open surfaces when the app sends a new theme palette", async () => {
    const events: BridgeEvent[] = [];
    const session = await createPiSession({
      cwd: mkdtempSync(join(tmpdir(), "cd-pi-session-")),
      agentDir: mkdtempSync(join(tmpdir(), "cd-pi-agentdir-")),
      gatewayUrl: "http://gateway.invalid:8788/v1",
      containerToolDescriptions: CONTAINER_TOOL_DESCRIPTIONS,
      gatewayToken: "tok",
      modelId: "canned",
      emit: (event) => events.push(event),
      streamOverride: cannedStream as never,
      extraExtensions: [
        onSessionStart("theme-probe", (ctx) => {
          ctx.ui.setHeader(() => ({ render: () => [ctx.ui.theme.fg("accent", "x")], invalidate: () => {} }));
        }),
      ],
    });

    await session.prompt("say hello");
    session.setThemePalette({ accent: "#ff0000" });

    const frames = events.filter((event) => event.type === "surface_frame");
    const accent = (frames.at(-1) as { lines: string[] }).lines[0];
    expect(accent).toBe("\x1b[38;2;255;0;0mx\x1b[39m");
  });
});

describe("parseModelApi", () => {
  it("defaults to OpenAI completions, which every provider family but Anthropic speaks", () => {
    expect(parseModelApi(undefined)).toBe("openai-completions");
    expect(parseModelApi("")).toBe("openai-completions");
  });

  it("selects Anthropic's own wire shape when the app asked for it", () => {
    expect(parseModelApi("anthropic-messages")).toBe("anthropic-messages");
  });

  // A typo would otherwise reach pi as an unknown api and fail deep inside its provider composer.
  it("refuses a shape this host cannot register", () => {
    expect(() => parseModelApi("openai-responses")).toThrow(/CD_MODEL_API/);
  });
});
