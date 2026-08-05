// Classifies one host_request from the container into what the app must do with it: block on a dialog, gate a
// tool call, or patch the assistant's chrome. Pure — no store, no React — so the routing table is tested
// without a socket, and an unknown method degrades to "ignored" rather than crashing the renderer on a plugin
// that was written against a newer host.

import type { BridgeEvent } from "@/pi-bridge/protocol";

import { parseEngineOpRequest } from "./engineOpDispatch";
import { parseWorkspaceOpRequest } from "./workspaceOpDispatch";

export type HostRequestEvent = Extract<BridgeEvent, { type: "host_request" }>;

export type PendingUiRequestMethod = "select" | "confirm" | "input" | "editor";

export interface PendingUiRequest {
  requestId: string;
  method: PendingUiRequestMethod;
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeoutMs?: number;
}

export interface ChromeWidget {
  lines: string[];
  placement: "aboveEditor" | "belowEditor";
}

export interface ChromePatch {
  statuses?: Record<string, string | undefined>;
  widgets?: Record<string, ChromeWidget | undefined>;
  title?: string;
  editorText?: string;
  notify?: { message: string; notifyType: "info" | "warning" | "error" };
  // What the working indicator says and whether it is shown. An absent message restores the app's own cycling
  // words; an absent visibility leaves whatever the last call asked for.
  working?: { message?: string; visible?: boolean };
}

export interface PendingApprovalRequest {
  requestId: string;
  toolName: string;
  args: unknown;
}

// A container operation the agent wants the app to perform on its behalf: pi runs in a container and cannot
// reach the engine ports, so the toolset executes here and the answer travels back over the same request.
export interface PendingEngineOpRequest {
  requestId: string;
  op: string;
  args: Record<string, unknown>;
}

// One public-web query the agent wants the app to run. Like a container operation it executes in the app — which
// owns the address-pinned fetch and the user's setting — and unlike one it takes no connection and no arguments
// beyond the query.
export interface PendingWebSearchRequest {
  requestId: string;
  query: string;
}

// One workspace file or command operation, to be performed where the SESSION chose. It executes in the app because
// only that realm holds the connection transports and the local filesystem; the target itself is the session's, so
// this carries the operation and nothing about where it lands.
export interface PendingWorkspaceOpRequest {
  requestId: string;
  op: string;
  args: Record<string, unknown>;
}

export type HostRequestOutcome =
  | { kind: "dialog"; request: PendingUiRequest }
  | { kind: "approval"; request: PendingApprovalRequest }
  | { kind: "engine-op"; request: PendingEngineOpRequest }
  | { kind: "web-search"; request: PendingWebSearchRequest }
  | { kind: "workspace-op"; request: PendingWorkspaceOpRequest }
  | { kind: "chrome"; patch: ChromePatch }
  | { kind: "ignored" };

const DIALOG_METHODS = new Set<string>(["select", "confirm", "input", "editor"]);

function text(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function lines(payload: Record<string, unknown>, key: string): string[] | undefined {
  const value = payload[key];
  return Array.isArray(value) ? value.map(String) : undefined;
}

function dialog(event: HostRequestEvent): HostRequestOutcome {
  const title = text(event.payload, "title");
  // A dialog with no title has nothing to render and no way for the user to know what they are answering.
  if (!title) return { kind: "ignored" };
  return {
    kind: "dialog",
    request: {
      requestId: event.requestId,
      method: event.method as PendingUiRequestMethod,
      title,
      ...(text(event.payload, "message") ? { message: text(event.payload, "message") } : {}),
      ...(lines(event.payload, "options") ? { options: lines(event.payload, "options") } : {}),
      ...(text(event.payload, "placeholder") ? { placeholder: text(event.payload, "placeholder") } : {}),
      ...(text(event.payload, "prefill") ? { prefill: text(event.payload, "prefill") } : {}),
      timeoutMs: event.timeoutMs,
    },
  };
}

function notifyType(payload: Record<string, unknown>): "info" | "warning" | "error" {
  const value = payload.notifyType;
  return value === "warning" || value === "error" ? value : "info";
}

export function classifyHostRequest(event: HostRequestEvent): HostRequestOutcome {
  if (DIALOG_METHODS.has(event.method)) return dialog(event);

  switch (event.method) {
    case "approval": {
      const toolName = text(event.payload, "toolName");
      if (!toolName) return { kind: "ignored" };
      return { kind: "approval", request: { requestId: event.requestId, toolName, args: event.payload.args } };
    }
    case "engine_op": {
      const parsed = parseEngineOpRequest(event.payload);
      if (!parsed) return { kind: "ignored" };
      return { kind: "engine-op", request: { requestId: event.requestId, op: parsed.op, args: parsed.args ?? {} } };
    }
    case "workspace_op": {
      const parsed = parseWorkspaceOpRequest(event.payload);
      if (!parsed) return { kind: "ignored" };
      return {
        kind: "workspace-op",
        request: { requestId: event.requestId, op: parsed.op, args: parsed.args ?? {} },
      };
    }
    case "web_search": {
      const query = text(event.payload, "query")?.trim();
      // Nothing to search for is not a refusal to report — there is no request here at all.
      if (!query) return { kind: "ignored" };
      return { kind: "web-search", request: { requestId: event.requestId, query } };
    }
    case "setStatus": {
      const key = text(event.payload, "statusKey");
      if (!key) return { kind: "ignored" };
      return { kind: "chrome", patch: { statuses: { [key]: text(event.payload, "statusText") } } };
    }
    case "setWidget": {
      const key = text(event.payload, "widgetKey");
      if (!key) return { kind: "ignored" };
      const widgetLines = lines(event.payload, "widgetLines");
      const placement = event.payload.widgetPlacement === "belowEditor" ? "belowEditor" : "aboveEditor";
      return {
        kind: "chrome",
        patch: { widgets: { [key]: widgetLines ? { lines: widgetLines, placement } : undefined } },
      };
    }
    // pi's setWorkingMessage / setWorkingVisible / setWorkingIndicator, arriving as one. A plugin's own animation
    // frames are NOT adopted — the GUI animates its own spinner and would render someone's glyphs foreign — but an
    // EMPTY frame list is pi's documented way of saying "hide the indicator entirely", so that much is honoured.
    case "setWorking": {
      const frames = lines(event.payload, "workingFrames");
      const visible =
        typeof event.payload.workingVisible === "boolean"
          ? event.payload.workingVisible
          : frames
            ? frames.length > 0
            : undefined;
      return {
        kind: "chrome",
        patch: {
          working: { message: text(event.payload, "workingMessage"), ...(visible === undefined ? {} : { visible }) },
        },
      };
    }
    case "setTitle": {
      const title = text(event.payload, "title");
      return title ? { kind: "chrome", patch: { title } } : { kind: "ignored" };
    }
    case "setEditorText":
      return { kind: "chrome", patch: { editorText: text(event.payload, "text") ?? "" } };
    case "notify": {
      const message = text(event.payload, "message");
      return message
        ? { kind: "chrome", patch: { notify: { message, notifyType: notifyType(event.payload) } } }
        : { kind: "ignored" };
    }
    default:
      return { kind: "ignored" };
  }
}
