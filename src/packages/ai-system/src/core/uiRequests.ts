// Classifies one host_request from the container into what the app must do with it: block on a dialog, gate a
// tool call, or patch the assistant's chrome. Pure — no store, no React — so the routing table is tested
// without a socket, and an unknown method degrades to "ignored" rather than crashing the renderer on a plugin
// that was written against a newer host.

import type { BridgeEvent } from "@/pi-bridge/protocol";

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
}

export interface PendingApprovalRequest {
  requestId: string;
  toolName: string;
  args: unknown;
}

export type HostRequestOutcome =
  | { kind: "dialog"; request: PendingUiRequest }
  | { kind: "approval"; request: PendingApprovalRequest }
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
