// The container toolset, registered with pi from inside the agent container. pi cannot reach the engine ports —
// they live in the app, on the other side of the bridge — so each tool is a thin caller: it asks the app to
// perform one operation over `engine_op` and turns the answer into a tool result.
//
// There is no gate here, and registering a tool grants nothing: the app decides when it performs the operation, on
// the `engine_op` request below. It deliberately does NOT decide at pi's pre-call `tool_call` gate — one operation
// asked at both boundaries showed the user two identical cards for a single removal.

import type { ExtensionFactory, InlineExtension } from "@earendil-works/pi-coding-agent";

import { createLogger } from "@/logger";
import { containerToolSpecs } from "@/pi-agent-host/containerToolCatalogue";
import type { HostRpc } from "@/pi-agent-host/hostRpc";
import type { EngineOpResult } from "@/pi-bridge/protocol";

const logger = createLogger("pi-agent-host.containerTools");

type NamedInlineExtension = Extract<InlineExtension, { factory: ExtensionFactory }>;

// Long enough for a pull or a slow inspect over a remote socket, short enough that a wedged app does not park the
// agent forever. A mutation still waits on the user's approval inside this window.
const ENGINE_OP_TIMEOUT_MS = 10 * 60 * 1_000;

// hostRpc resolves to its fallback rather than rejecting, so silence has to arrive as an explicit failure —
// otherwise a dropped socket would read to the model as an empty container list.
const UNANSWERED: EngineOpResult = {
  ok: false,
  error: "the app did not answer this container operation",
};

function isResult(value: unknown): value is EngineOpResult {
  return typeof value === "object" && value !== null && typeof (value as EngineOpResult).ok === "boolean";
}

// What the model reads. A string payload is already text — logs above all — and re-encoding it as JSON would hand
// the model escaped newlines to unpick. A boolean is an acknowledgement, not data, so it is stated in words.
function resultText(op: string, value: unknown): string {
  if (typeof value === "string") return value;
  if (value === true) return `${op} succeeded`;
  if (value === false) return `${op} reported no change`;
  return JSON.stringify(value ?? null, null, 2);
}

export function createContainerToolsExtension(options: {
  rpc: HostRpc;
  descriptions: Readonly<Record<string, string>>;
}): NamedInlineExtension {
  const { rpc, descriptions } = options;
  return {
    name: "container-desktop-container-tools",
    factory: (pi) => {
      for (const spec of containerToolSpecs(descriptions)) {
        pi.registerTool({
          name: spec.name,
          label: spec.label,
          description: spec.description,
          parameters: spec.parameters,
          async execute(_toolCallId, params, signal) {
            const answer = await rpc.request<EngineOpResult>(
              "engine_op",
              { op: spec.name, args: (params ?? {}) as Record<string, unknown> },
              { fallback: UNANSWERED, timeoutMs: ENGINE_OP_TIMEOUT_MS, signal },
            );
            const result = isResult(answer) ? answer : UNANSWERED;
            if (!result.ok) {
              logger.warn("container operation refused or failed", spec.name, result.error);
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
