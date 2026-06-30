// Pure, ordered Assistant timeline. The converged AI store appends to ONE ordered list as
// stream events arrive — array order IS sequence order — so a resumed turn (user → command → result →
// prose) renders in true order with no bucketing/misordering. Framework-free + unit-tested.
import type { AgentStreamEvent, ChatMessage } from "@/ai-system/core";

export type ApprovalStatus = "pending" | "resolving" | "allowed" | "rejected";

export type TranscriptItem =
  | { kind: "message"; id: string; role: "user" | "assistant"; content: string; streaming: boolean }
  | { kind: "command"; id: string; program: string; args: string[] }
  | { kind: "command-result"; id: string; ok: boolean; stdout: string; stderr: string }
  | { kind: "rejected"; id: string; program: string; args: string[]; reason: string }
  | {
      kind: "approval";
      id: string;
      actionId: string;
      cmdKind: "command" | "web" | "tool";
      program: string;
      args: string[];
      reason: string;
      status: ApprovalStatus;
      /** Friendly one-line summary for a typed-tool approval (cmdKind === "tool"); commands render program+args. */
      title?: string;
    }
  // A first-class typed tool call (e.g. listContainers) + its redacted result, rendered as a generative-UI
  // card by AssistantScreen's cards registry (with the generic step/output as fallback for un-carded tools).
  | {
      kind: "tool";
      id: string;
      tool: string;
      title: string;
      args: Record<string, unknown>;
      status: "running" | "complete" | "error";
      ok?: boolean;
      result?: unknown;
    }
  | { kind: "error"; id: string; message: string };

export function userMessageItem(id: string, content: string): TranscriptItem {
  return { kind: "message", id, role: "user", content, streaming: false };
}

// Seed a timeline from a session's persisted messages (tool steps + approvals are ephemeral, not restored).
export function itemsFromMessages(messages: ChatMessage[]): TranscriptItem[] {
  return messages.map((m) => ({
    kind: "message",
    id: m.id,
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
    streaming: false,
  }));
}

// Derive the persisted messages from the timeline (only user/assistant prose persists).
export function messagesFromItems(items: TranscriptItem[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const it of items) {
    if (it.kind === "message") {
      out.push({ id: it.id, role: it.role, content: it.content, createdAt: out.length });
    }
  }
  return out;
}

function settleStreaming(items: TranscriptItem[]): TranscriptItem[] {
  return items.map((it) => (it.kind === "message" && it.streaming ? { ...it, streaming: false } : it));
}

// Append one stream event to the ordered timeline. `nextId` mints ids for new items. A delta extends the
// trailing streaming assistant bubble or opens a new one (so a resumed turn's prose starts a fresh bubble
// after the prior turn settled); done/error settle streaming.
export function reduceStreamEvent(
  items: TranscriptItem[],
  evt: AgentStreamEvent,
  nextId: () => string,
): TranscriptItem[] {
  switch (evt.type) {
    case "delta": {
      const text = evt.payload.text ?? "";
      if (!text) {
        return items;
      }
      const lastIndex = items.length - 1;
      const last = items[lastIndex];
      if (last && last.kind === "message" && last.role === "assistant" && last.streaming) {
        const next = items.slice();
        next[lastIndex] = { ...last, content: last.content + text };
        return next;
      }
      return [...items, { kind: "message", id: nextId(), role: "assistant", content: text, streaming: true }];
    }
    case "tool": {
      const e = evt.payload.event;
      if (!e) {
        return items;
      }
      if (e.type === "command") {
        return [...items, { kind: "command", id: nextId(), program: e.program, args: e.args }];
      }
      if (e.type === "command-result") {
        return [...items, { kind: "command-result", id: nextId(), ok: e.ok, stdout: e.stdout, stderr: e.stderr }];
      }
      if (e.type === "rejected") {
        return [...items, { kind: "rejected", id: nextId(), program: e.program, args: e.args, reason: e.reason }];
      }
      if (e.type === "approval-request") {
        return [
          ...items,
          {
            kind: "approval",
            id: nextId(),
            actionId: e.actionId,
            cmdKind: e.kind,
            program: e.program,
            args: e.args,
            reason: e.reason,
            status: "pending",
            title: e.title,
          },
        ];
      }
      if (e.type === "tool-call") {
        return [
          ...items,
          { kind: "tool", id: nextId(), tool: e.tool, title: e.title, args: e.args, status: "running" },
        ];
      }
      if (e.type === "tool-result") {
        // Fill the most recent still-running call of this tool; else append a completed item (defensive).
        for (let i = items.length - 1; i >= 0; i -= 1) {
          const it = items[i];
          if (it.kind === "tool" && it.tool === e.tool && it.status === "running") {
            const next = items.slice();
            next[i] = {
              ...it,
              result: e.result,
              ok: e.ok,
              status: e.ok ? "complete" : "error",
              title: e.title || it.title,
            };
            return next;
          }
        }
        return [
          ...items,
          {
            kind: "tool",
            id: nextId(),
            tool: e.tool,
            title: e.title,
            args: {},
            status: e.ok ? "complete" : "error",
            ok: e.ok,
            result: e.result,
          },
        ];
      }
      return items;
    }
    case "error":
      return [
        ...settleStreaming(items),
        { kind: "error", id: nextId(), message: evt.payload.message ?? "unknown error" },
      ];
    case "done":
      return settleStreaming(items);
    default:
      return items;
  }
}

// Update a surfaced approval card's status (user clicked Allow/Reject, or it is awaiting the broker).
export function setApprovalStatus(items: TranscriptItem[], actionId: string, status: ApprovalStatus): TranscriptItem[] {
  return items.map((it) => (it.kind === "approval" && it.actionId === actionId ? { ...it, status } : it));
}

// True while any approval card is still awaiting the user — the stream stays open for the resume.
export function hasPendingApproval(items: TranscriptItem[]): boolean {
  return items.some((it) => it.kind === "approval" && (it.status === "pending" || it.status === "resolving"));
}
