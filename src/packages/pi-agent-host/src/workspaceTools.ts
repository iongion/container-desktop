// The workspace toolset, registered with pi from inside the agent container. pi's own file tools see the container's
// filesystem; these see the TARGET the session chose — this machine, a remote host over its connection's transport,
// an existing container, or a disposable sandbox — which the container cannot reach at all. So each tool is a thin
// caller: it asks the app to perform one operation over `workspace_op` and turns the answer into a tool result.
//
// No gate here, and registering a tool grants nothing: the permission gate handles every `tool_call` regardless of
// who registered the tool, and the app holds the mutating ones at the boundary where it can run them on approval.

import type { ExtensionFactory, InlineExtension } from "@earendil-works/pi-coding-agent";

import { createLogger } from "@/logger";
import type { HostRpc } from "@/pi-agent-host/hostRpc";
import { workspaceToolSpecs } from "@/pi-agent-host/workspaceToolCatalogue";
import type { WorkspaceOpResult } from "@/pi-bridge/protocol";

const logger = createLogger("pi-agent-host.workspaceTools");

type NamedInlineExtension = Extract<InlineExtension, { factory: ExtensionFactory }>;

// Long enough for a build or a test run started through `execCommand` on a remote host, short enough that a wedged
// app does not park the agent forever. A mutation still waits on the user's approval inside this window.
const WORKSPACE_OP_TIMEOUT_MS = 10 * 60 * 1_000;

// hostRpc resolves to its fallback rather than rejecting, so silence has to arrive as an explicit failure —
// otherwise a dropped socket would read to the model as an empty directory.
const UNANSWERED: WorkspaceOpResult = {
  ok: false,
  error: "the app did not answer this workspace operation",
};

function isResult(value: unknown): value is WorkspaceOpResult {
  return typeof value === "object" && value !== null && typeof (value as WorkspaceOpResult).ok === "boolean";
}

// What the model reads. A file's contents are already text and re-encoding them as JSON would hand the model
// escaped newlines to unpick; a listing, a stat and a command result are structures worth their shape.
function resultText(op: string, value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return `${op} succeeded`;
  return JSON.stringify(value, null, 2);
}

export function createWorkspaceToolsExtension(options: {
  rpc: HostRpc;
  descriptions: Readonly<Record<string, string>>;
}): NamedInlineExtension {
  const { rpc, descriptions } = options;
  return {
    name: "container-desktop-workspace-tools",
    factory: (pi) => {
      for (const spec of workspaceToolSpecs(descriptions)) {
        pi.registerTool({
          name: spec.name,
          label: spec.label,
          description: spec.description,
          parameters: spec.parameters,
          async execute(_toolCallId, params, signal) {
            const answer = await rpc.request<WorkspaceOpResult>(
              "workspace_op",
              { op: spec.name, args: (params ?? {}) as Record<string, unknown> },
              { fallback: UNANSWERED, timeoutMs: WORKSPACE_OP_TIMEOUT_MS, signal },
            );
            const result = isResult(answer) ? answer : UNANSWERED;
            if (!result.ok) {
              logger.warn("workspace operation refused or failed", spec.name, result.error);
              // pi marks a result isError by catching a throw; there is no error field to set.
              throw new Error(result.error);
            }
            return {
              content: [{ type: "text" as const, text: resultText(spec.name, result.value) }],
              details: result.value,
            };
          },
        });
      }
    },
  };
}
