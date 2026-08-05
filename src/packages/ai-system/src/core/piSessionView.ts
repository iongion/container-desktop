// Projects pi bridge events into the app's existing SessionView. This is the seam that lets the whole
// assistant UI — markdown, tool cards, approvals, thinking — render pi output with no component changes:
// the vocabulary stays the app's and the producer is the pi bridge.

import type { EffectiveContextSource } from "@/ai-system/core/context";
import type { AIPermissionMode } from "@/ai-system/core/permissions";
import { piApprovalSummary } from "@/ai-system/core/piApprovals";
import { toEffectiveContext, toSessionUsage } from "@/ai-system/core/piContextReport";
import type { SessionView } from "@/ai-system/core/sessionEvents";
import { classifyHostRequest } from "@/ai-system/core/uiRequests";
import type { BridgeEvent } from "@/pi-bridge/protocol";
import { randomUUID } from "@/utils/randomUUID";

type TimelineItem = SessionView["timeline"][number];

// A live user turn has no bridge event — the app knows what it submitted — so the store injects `user_message`
// through this projector to keep every timeline mutation in a single tested place. It is a bridge event as well,
// because a REPLACED session replays its history through the same case, which is why there is one projection here
// and not two that drift. `approval_settled` is the same idea for the answer the user gave a gated tool call: the
// container is told over the bridge, the transcript is told through here.
export type PiSessionViewEvent = BridgeEvent | { type: "approval_settled"; requestId: string; allowed: boolean };

export function emptyPiSessionView(sessionId: string): SessionView {
  return { sessionId, phase: "idle", lastSeq: 0, timeline: [] };
}

function settleStreaming(view: SessionView, status: "complete" | "error"): TimelineItem[] {
  const streaming = view.streamingAssistant;
  if (!streaming) return view.timeline;
  return view.timeline.map((item, index) =>
    index === streaming.timelineIndex && item.kind === "message" ? { ...item, status } : item,
  );
}

type NoticeItem = Extract<TimelineItem, { kind: "notice" }>;

// What a finished step with no text is worth saying. pi's own stop reasons (pi-ai `StopReason`): `toolUse` means the
// tool card is the answer, `aborted` and `error` are already on screen as themselves, and `length` is a cap reached
// before a single word — which is not the same thing as a model that simply said nothing.
function turnNotice(stopReason: string): NoticeItem["notice"] | undefined {
  if (stopReason === "length") return "output-cap";
  return stopReason === "stop" ? "empty-answer" : undefined;
}

type ToolItem = Extract<TimelineItem, { kind: "tool" }>;

function withTool(view: SessionView, toolCallId: string, patch: (item: ToolItem) => ToolItem): TimelineItem[] {
  return view.timeline.map((item) => (item.kind === "tool" && item.toolCallId === toolCallId ? patch(item) : item));
}

// `session` carries what the transcript cannot read off the event: the connection the asking session runs on, so an
// approval card can name where a container mutation lands even when the agent left it to the app to decide, plus the
// app-side facts a usage or context report needs — which configured provider this is, the permission mode in force,
// and the project sources the app itself put into the prompt.
export interface PiSessionViewContext {
  connectionId?: string;
  providerId?: string;
  permissionMode?: AIPermissionMode;
  contextSources?: readonly EffectiveContextSource[];
  now?: () => number;
}

export function projectPiSessionView(
  view: SessionView,
  event: PiSessionViewEvent,
  session?: PiSessionViewContext,
): SessionView {
  const next = { ...view, lastSeq: view.lastSeq + 1 };

  switch (event.type) {
    case "user_message":
      return {
        ...next,
        // The agent owes the answer from here, not from its first token — everything that shows a turn is in
        // flight reads this phase, and the gap before the first token is the longest part of a turn and the
        // one with nothing else on screen. The turn still ends on `idle` (or `error`), as it always did.
        phase: "model",
        timeline: [
          ...view.timeline,
          {
            kind: "message",
            id: randomUUID(),
            role: "user",
            content: event.text,
            delivery: "applied",
            status: "complete",
          },
        ],
      };

    case "assistant_delta": {
      const streaming = view.streamingAssistant;
      if (streaming) {
        const content = streaming.content + event.text;
        return {
          ...next,
          phase: "model",
          timeline: view.timeline.map((item, index) =>
            index === streaming.timelineIndex && item.kind === "message" ? { ...item, content } : item,
          ),
          streamingAssistant: { ...streaming, content },
        };
      }
      const id = randomUUID();
      return {
        ...next,
        phase: "model",
        timeline: [
          ...view.timeline,
          { kind: "message", id, role: "assistant", content: event.text, delivery: "applied", status: "streaming" },
        ],
        streamingAssistant: { id, timelineIndex: view.timeline.length, content: event.text },
      };
    }

    case "assistant_end": {
      // An abort is the user's own Stop or tool rejection: the turn reads as stopped and the session is idle
      // again, never as a model error.
      const aborted = event.stopReason === "aborted";
      const status = aborted
        ? ("stopped" as const)
        : event.stopReason === "error"
          ? ("error" as const)
          : ("complete" as const);
      const streaming = view.streamingAssistant;
      if (!streaming) {
        // Nothing was said and nothing is streaming. An empty bubble is noise — but silence is only right when the
        // step had nothing to say for a reason the transcript already shows: the user's own Stop, an error that
        // reported itself as its own entry, or a tool call, whose card IS what the model said. A turn that simply
        // finished empty gets a notice, because a real 4B model does exactly that and it looked like a turn that
        // never ran.
        if (!event.text) {
          const notice = turnNotice(event.stopReason);
          return {
            ...next,
            ...(aborted ? { phase: "idle" as const } : {}),
            ...(notice ? { timeline: [...view.timeline, { kind: "notice" as const, id: randomUUID(), notice }] } : {}),
          };
        }
        return {
          ...next,
          ...(aborted ? { phase: "idle" as const } : {}),
          timeline: [
            ...view.timeline,
            {
              kind: "message",
              id: randomUUID(),
              role: "assistant",
              content: event.text,
              delivery: "applied",
              status,
            },
          ],
        };
      }
      return {
        ...next,
        ...(aborted ? { phase: "idle" as const } : {}),
        timeline: view.timeline.map((item, index) =>
          index === streaming.timelineIndex && item.kind === "message"
            ? { ...item, content: event.text || item.content, status }
            : item,
        ),
        streamingAssistant: undefined,
      };
    }

    case "tool_start":
      return {
        ...next,
        phase: "tool",
        timeline: [
          ...view.timeline,
          {
            kind: "tool",
            id: randomUUID(),
            toolCallId: event.toolCallId,
            tool: event.toolName,
            title: event.toolName,
            args: (event.args ?? {}) as Record<string, unknown>,
            status: "running",
          },
        ],
      };

    case "tool_update":
      return { ...next, timeline: withTool(view, event.toolCallId, (item) => ({ ...item, message: event.text })) };

    case "tool_end":
      return {
        ...next,
        timeline: withTool(view, event.toolCallId, (item) => ({
          ...item,
          status: event.isError ? "error" : "complete",
          ok: !event.isError,
          message: event.text,
          result: event.details,
        })),
      };

    // Plugin-published data. It is content the plugin chose to show, so it lands in the timeline as its own
    // kind — never merged into the streaming assistant message, which would read as something the model said.
    case "entry":
      return {
        ...next,
        timeline: [
          ...view.timeline,
          { kind: "data", id: randomUUID(), customType: event.customType, data: event.data },
        ],
      };

    case "custom_message":
      return {
        ...next,
        timeline: [
          ...view.timeline,
          {
            kind: "data",
            id: randomUUID(),
            customType: event.customType,
            data: event.details,
            text: event.content || undefined,
          },
        ],
      };

    case "error":
      return {
        ...next,
        phase: "error",
        timeline: [
          ...settleStreaming(view, "error"),
          { kind: "error", id: randomUUID(), scope: "model", message: event.message },
        ],
        streamingAssistant: undefined,
      };

    case "idle":
      return { ...next, phase: "idle", streamingAssistant: undefined };

    // Neither report is transcript content: they replace what the usage and context panels show. `lastSeq` still
    // moves, because a subscriber watching it has something new to render.
    case "usage":
      return { ...next, usage: toSessionUsage(event.usage) };

    case "request_context":
      return {
        ...next,
        context: toEffectiveContext(
          event.context,
          {
            // Absent means the caller did not say — which is true of the live specs, and of a session started
            // before a provider was recorded. The panel shows the model either way.
            providerId: session?.providerId ?? "unknown",
            permissionMode: session?.permissionMode ?? "ask",
            ...(session?.contextSources ? { sources: session.contextSources } : {}),
          },
          session?.now?.() ?? Date.now(),
        ),
      };

    case "host_request": {
      // Only the approval gate belongs in the transcript. Dialogs and chrome are session UI the store holds
      // outside the timeline, so a status update never reads as something the model said.
      const outcome = classifyHostRequest(event);
      // An operation the app performs ITSELF needs the same card as a tool pi would run: a container mutation lands
      // on the user's real engine and a workspace one on the target they chose — this machine, among them. The store
      // only projects the ones it decided to ask about, so an ungated read never reaches here.
      const asked =
        outcome.kind === "approval"
          ? outcome.request
          : outcome.kind === "engine-op" || outcome.kind === "workspace-op"
            ? { requestId: outcome.request.requestId, toolName: outcome.request.op, args: outcome.request.args }
            : undefined;
      if (!asked) return next;
      const { requestId, toolName, args } = asked;
      const toolCallId = typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : requestId;
      return {
        ...next,
        phase: "awaiting-approval",
        timeline: [
          ...view.timeline,
          {
            kind: "approval",
            id: randomUUID(),
            approvalId: requestId,
            toolCallId,
            tool: toolName,
            title: toolName,
            args: (args ?? {}) as Record<string, unknown>,
            reason: piApprovalSummary(toolName, args, session?.connectionId),
            status: "pending",
          },
        ],
      };
    }

    case "approval_settled": {
      const settled = view.timeline.map((item) =>
        item.kind === "approval" && item.approvalId === event.requestId
          ? { ...item, status: event.allowed ? ("allowed" as const) : ("rejected" as const) }
          : item,
      );
      // The agent resumes the moment the answer is given: it is back to running a tool, not waiting on one.
      const phase = view.phase === "awaiting-approval" ? "tool" : view.phase;
      return { ...next, phase, timeline: settled };
    }

    default:
      return next;
  }
}
