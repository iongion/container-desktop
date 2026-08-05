import type { AgentToolResult, Theme, ToolDefinition, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import { createLogger } from "@/logger";
import type { PiAgentEvent } from "@/pi-agent-host/events";
import type { SurfaceComponent, SurfaceRegistry } from "@/pi-agent-host/surfaces";
import type { SurfaceSlot } from "@/pi-bridge/protocol";

const logger = createLogger("pi-agent-host.toolSurfaces");

// pi's ToolRenderContext, as the renderers actually consume it. Its own type is generic over the tool's
// params and state and is not in pi's export map, so it is declared here against the documented fields.
export interface ToolRenderContext {
  args: unknown;
  toolCallId: string;
  invalidate: () => void;
  lastComponent: Component | undefined;
  state: Record<string, unknown>;
  cwd: string;
  executionStarted: boolean;
  argsComplete: boolean;
  isPartial: boolean;
  expanded: boolean;
  showImages: boolean;
  isError: boolean;
}

type CallRenderer = (args: never, theme: Theme, context: ToolRenderContext) => Component;
type ResultRenderer = (
  result: never,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: ToolRenderContext,
) => Component;

export interface ToolSurfaceRenderer {
  start(toolCallId: string, toolName: string, args: unknown): void;
  update(toolCallId: string, partialResult: unknown): void;
  end(toolCallId: string, result: AgentToolResult<unknown>, isError: boolean): void;
  rerenderAll(): void;
  clear(): void;
}

interface ToolCallState {
  toolName: string;
  args: unknown;
  state: Record<string, unknown>;
  callComponent?: Component;
  resultComponent?: Component;
  result?: unknown;
  isError: boolean;
  isPartial: boolean;
}

export interface ToolSurfaceRendererOptions {
  surfaces: SurfaceRegistry;
  cwd: string;
  getTheme: () => Theme;
  getToolsExpanded: () => boolean;
  getToolDefinition: (name: string) => ToolDefinition | undefined;
}

// A tool that ships its own `renderCall` / `renderResult` draws its row itself, in its own colours. Tools
// without them are untouched and stay on the app's native cards, which is the whole point of the split:
// the built-ins look like the app, a plugin's tool looks like the plugin meant it to.
export function createToolSurfaceRenderer(options: ToolSurfaceRendererOptions): ToolSurfaceRenderer {
  const { surfaces, getTheme, getToolsExpanded, getToolDefinition } = options;
  const calls = new Map<string, ToolCallState>();

  const renderers = (toolName: string) => {
    const definition = getToolDefinition(toolName) as
      | { renderCall?: CallRenderer; renderResult?: ResultRenderer }
      | undefined;
    return { renderCall: definition?.renderCall, renderResult: definition?.renderResult };
  };

  const contextFor = (toolCallId: string, call: ToolCallState, slot: "call" | "result"): ToolRenderContext => ({
    args: call.args,
    toolCallId,
    invalidate: () => {
      const surfaceId = surfaces.surfaceIdForSlot({ kind: "tool", toolCallId, slot });
      if (surfaceId) surfaces.rerender(surfaceId);
    },
    lastComponent: slot === "call" ? call.callComponent : call.resultComponent,
    state: call.state,
    cwd: options.cwd,
    executionStarted: true,
    argsComplete: true,
    isPartial: call.isPartial,
    expanded: getToolsExpanded(),
    // The GUI paints ANSI text, not sixel or kitty image escapes, so a renderer must take its text path.
    showImages: false,
    isError: call.isError,
  });

  const open = (toolCallId: string, slot: "call" | "result", make: () => Component): Component | undefined => {
    let component: Component;
    try {
      component = make();
    } catch (error) {
      // A tool renderer that throws costs that tool its custom row, not the turn.
      logger.error(`tool ${slot} renderer threw`, error);
      return undefined;
    }
    const surfaceSlot: SurfaceSlot = { kind: "tool", toolCallId, slot };
    surfaces.open(surfaceSlot, component as SurfaceComponent);
    return component;
  };

  const renderResult = (toolCallId: string, call: ToolCallState) => {
    const { renderResult: render } = renderers(call.toolName);
    if (!render) return;
    const renderOptions: ToolRenderResultOptions = { expanded: getToolsExpanded(), isPartial: call.isPartial };
    call.resultComponent = open(toolCallId, "result", () =>
      render(call.result as never, renderOptions, getTheme(), contextFor(toolCallId, call, "result")),
    );
  };

  return {
    start(toolCallId, toolName, args) {
      const call: ToolCallState = { toolName, args, state: {}, isError: false, isPartial: false };
      calls.set(toolCallId, call);
      const { renderCall } = renderers(toolName);
      if (!renderCall) return;
      call.callComponent = open(toolCallId, "call", () =>
        renderCall(args as never, getTheme(), contextFor(toolCallId, call, "call")),
      );
    },

    update(toolCallId, partialResult) {
      const call = calls.get(toolCallId);
      if (!call) return;
      call.result = partialResult;
      call.isPartial = true;
      renderResult(toolCallId, call);
    },

    end(toolCallId, result, isError) {
      const call = calls.get(toolCallId);
      if (!call) return;
      call.result = result;
      call.isError = isError;
      call.isPartial = false;
      renderResult(toolCallId, call);
    },

    // The theme changed, or the expansion state did: every tool row has to be asked again, because the
    // colours and the truncation are baked into the lines a component already returned.
    rerenderAll() {
      for (const [toolCallId, call] of calls) {
        for (const slot of ["call", "result"] as const) {
          const surfaceId = surfaces.surfaceIdForSlot({ kind: "tool", toolCallId, slot });
          if (!surfaceId) continue;
          const component = slot === "call" ? call.callComponent : call.resultComponent;
          component?.invalidate?.();
          surfaces.rerender(surfaceId);
        }
      }
    },

    clear() {
      calls.clear();
    },
  };
}

// The same three tool events the transcript is built from, read a second time for the surfaces. Keeping
// it beside the renderer rather than inside `mapAgentEvent` leaves that mapper the pure function it is.
export function routeToolSurfaces(renderer: ToolSurfaceRenderer, event: PiAgentEvent): void {
  switch (event.type) {
    case "tool_execution_start":
      renderer.start(event.toolCallId ?? "", event.toolName ?? "", event.args);
      return;
    case "tool_execution_update":
      renderer.update(event.toolCallId ?? "", event.partialResult);
      return;
    case "tool_execution_end":
      renderer.end(event.toolCallId ?? "", event.result as AgentToolResult<unknown>, event.isError === true);
      return;
    default:
  }
}
