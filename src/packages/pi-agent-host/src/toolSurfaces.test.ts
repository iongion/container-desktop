import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { buildPiTheme } from "@/pi-agent-host/piTheme";
import { createSurfaceRegistry } from "@/pi-agent-host/surfaces";
import { createToolSurfaceRenderer, routeToolSurfaces, type ToolRenderContext } from "@/pi-agent-host/toolSurfaces";
import type { AppThemePalette, BridgeEvent } from "@/pi-bridge/protocol";

const palette: AppThemePalette = {
  chrome: "#1b2027",
  bg: "#22282f",
  surface: "#2a313a",
  border: "#39424d",
  text: "#e8edf2",
  textMuted: "#9aa5b1",
  accent: "#14b8a6",
  success: "#2ea043",
  warning: "#d29922",
  error: "#f85149",
};

function harness(definitions: Record<string, unknown> = {}, toolsExpanded = false) {
  const events: BridgeEvent[] = [];
  const surfaces = createSurfaceRegistry({ emit: (event) => events.push(event), defaultColumns: 80 });
  const renderer = createToolSurfaceRenderer({
    surfaces,
    cwd: "/workspace",
    getTheme: () => buildPiTheme(palette),
    getToolsExpanded: () => toolsExpanded,
    getToolDefinition: (name) => definitions[name] as ToolDefinition | undefined,
  });
  return { events, surfaces, renderer };
}

const frames = (events: BridgeEvent[]) =>
  events.filter((event): event is Extract<BridgeEvent, { type: "surface_frame" }> => event.type === "surface_frame");

// Declared with pi's own parameter list so the mock records a typed call tuple, not an empty one.
const resultRenderer = (lines: string[]) =>
  vi.fn(
    (
      _result: unknown,
      _options: { expanded: boolean; isPartial: boolean },
      _theme: unknown,
      _context: ToolRenderContext,
    ) => ({ render: () => lines }),
  );

describe("createToolSurfaceRenderer", () => {
  it("leaves a tool with no renderers on the app's native cards", () => {
    const { events, renderer } = harness();
    renderer.start("t1", "bash", { command: "ls" });
    renderer.end("t1", { content: [] } as never, false);
    expect(frames(events)).toHaveLength(0);
  });

  it("opens a call surface for a tool that renders its own invocation", () => {
    const { events, renderer } = harness({
      deploy: { renderCall: (args: { target: string }) => ({ render: () => [`deploy ${args.target}`] }) },
    });
    renderer.start("t1", "deploy", { target: "prod" });
    expect(frames(events).at(-1)).toMatchObject({
      lines: ["deploy prod"],
      slot: { kind: "tool", toolCallId: "t1", slot: "call" },
      focus: false,
    });
  });

  it("opens a result surface and hands the renderer pi's own options", () => {
    const renderResult = resultRenderer(["done"]);
    const { events, renderer } = harness({ deploy: { renderResult } }, true);
    renderer.start("t1", "deploy", {});
    renderer.end("t1", { content: [{ type: "text", text: "ok" }] } as never, false);
    expect(frames(events).at(-1)).toMatchObject({ lines: ["done"], slot: { slot: "result" } });
    expect(renderResult.mock.calls[0][1]).toEqual({ expanded: true, isPartial: false });
  });

  it("marks a streaming update as partial and the final result as not", () => {
    const renderResult = resultRenderer(["x"]);
    const { renderer } = harness({ deploy: { renderResult } });
    renderer.start("t1", "deploy", {});
    renderer.update("t1", { content: [] });
    renderer.end("t1", { content: [] } as never, true);
    expect(renderResult.mock.calls[0][1]).toMatchObject({ isPartial: true });
    expect(renderResult.mock.calls[1][1]).toMatchObject({ isPartial: false });
    expect(renderResult.mock.calls[1][3].isError).toBe(true);
  });

  it("gives the renderer a context whose invalidate repaints just that row", () => {
    let captured: ToolRenderContext | undefined;
    let text = "first";
    const { events, renderer } = harness({
      deploy: {
        renderCall: (_args: unknown, _theme: unknown, context: ToolRenderContext) => {
          captured = context;
          return { render: () => [text] };
        },
      },
    });
    renderer.start("t1", "deploy", { target: "prod" });
    expect(captured).toMatchObject({
      toolCallId: "t1",
      cwd: "/workspace",
      args: { target: "prod" },
      showImages: false,
    });

    text = "second";
    captured?.invalidate();
    expect(frames(events).at(-1)).toMatchObject({ lines: ["second"] });
  });

  it("shares one state object between the call and result renders of the same tool call", () => {
    const seen: Record<string, unknown>[] = [];
    const capture = (...args: unknown[]) => {
      seen.push((args.at(-1) as ToolRenderContext).state);
      return { render: () => ["x"] };
    };
    const { renderer } = harness({ deploy: { renderCall: capture, renderResult: capture } });
    renderer.start("t1", "deploy", {});
    renderer.end("t1", { content: [] } as never, false);
    expect(seen[0]).toBe(seen[1]);
  });

  it("survives a renderer that throws, keeping the turn alive", () => {
    const { events, renderer } = harness({
      deploy: {
        renderCall: () => {
          throw new Error("bad renderer");
        },
      },
    });
    expect(() => renderer.start("t1", "deploy", {})).not.toThrow();
    expect(frames(events)).toHaveLength(0);
  });

  it("repaints every open tool row when the theme changes", () => {
    let text = "before";
    const { events, renderer } = harness({ deploy: { renderCall: () => ({ render: () => [text] }) } });
    renderer.start("t1", "deploy", {});
    text = "after";
    renderer.rerenderAll();
    expect(frames(events).at(-1)).toMatchObject({ lines: ["after"] });
  });
});

describe("routeToolSurfaces", () => {
  it("maps pi's three tool events onto the renderer", () => {
    const renderer = { start: vi.fn(), update: vi.fn(), end: vi.fn(), rerenderAll: vi.fn(), clear: vi.fn() };
    routeToolSurfaces(renderer, { type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { a: 1 } });
    routeToolSurfaces(renderer, { type: "tool_execution_update", toolCallId: "t1", partialResult: { content: [] } });
    const result = { content: [{ type: "text", text: "ok" }] };
    routeToolSurfaces(renderer, { type: "tool_execution_end", toolCallId: "t1", isError: true, result });
    routeToolSurfaces(renderer, { type: "message_end" });

    expect(renderer.start).toHaveBeenCalledWith("t1", "bash", { a: 1 });
    expect(renderer.update).toHaveBeenCalledWith("t1", { content: [] });
    expect(renderer.end).toHaveBeenCalledWith("t1", result, true);
  });
});
