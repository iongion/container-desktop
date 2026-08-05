import type {
  ExtensionFactory,
  InlineExtension,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

import { createLogger } from "@/logger";
import type { HostRpc } from "@/pi-agent-host/hostRpc";

const logger = createLogger("pi-agent-host.permissionGate");

export interface ApprovalVerdict {
  allow: boolean;
  reason?: string;
}

// pi's InlineExtension is a union of a bare factory and a named record; the named half is what we build, and
// naming it keeps `.factory` reachable for callers. Extract on `factory`, not on `name` — a function type
// already carries `name`, so extracting by that keeps both halves of the union.
type NamedInlineExtension = Extract<InlineExtension, { factory: ExtensionFactory }>;

const REFUSED: ApprovalVerdict = { allow: false, reason: "no response from the app" };

function isVerdict(value: unknown): value is ApprovalVerdict {
  return typeof value === "object" && value !== null && typeof (value as ApprovalVerdict).allow === "boolean";
}

// pi has no approval system of its own, so the gate is this handler. The policy lives in the app — it owns the
// user's permission settings and the verdict cache — so every call asks and the app decides whether that means
// auto-allow, a cached verdict or a visible card. One decision path, at the cost of a round-trip per call.
export function createPermissionGateExtension(rpc: HostRpc): NamedInlineExtension {
  return {
    name: "container-desktop-permission-gate",
    factory: (pi) => {
      pi.on("tool_call", async (event: ToolCallEvent): Promise<ToolCallEventResult | undefined> => {
        let verdict: unknown;
        try {
          verdict = await rpc.request<ApprovalVerdict>(
            "approval",
            { toolName: event.toolName, toolCallId: event.toolCallId, args: event.input },
            { fallback: REFUSED },
          );
        } catch (error) {
          // An unreachable app is not consent. Fail closed and say why in the block reason.
          logger.error("asking the app for a tool verdict failed", error);
          return { block: true, reason: (error as Error).message };
        }
        if (!isVerdict(verdict)) return { block: true, reason: REFUSED.reason };
        if (verdict.allow) return undefined;
        return { block: true, reason: verdict.reason ?? "blocked by the app's permission policy" };
      });
    },
  };
}
