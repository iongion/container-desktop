// The public-web search tool, registered with pi from inside the agent container but PERFORMED by the app.
//
// The app is where it belongs: it owns the SSRF-guarded, address-pinned native fetch, it owns the user's
// "enable public web search" setting, and a session started with egress off has no network of its own at all. So
// this is a thin caller, exactly like the container toolset — it asks over the bridge and turns the answer into a
// tool result. The app refuses it, with a reason, when the setting is off.

import type { ExtensionFactory, InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { WEB_SEARCH_TOOL_NAME } from "@/ai-system/core/toolNames";
import { createLogger } from "@/logger";
import type { HostRpc } from "@/pi-agent-host/hostRpc";
import type { WebSearchAnswer } from "@/pi-bridge/protocol";

const logger = createLogger("pi-agent-host.webSearchTool");

type NamedInlineExtension = Extract<InlineExtension, { factory: ExtensionFactory }>;

// Long enough for a slow page over a slow link, short enough that a wedged app does not park the agent.
const WEB_SEARCH_TIMEOUT_MS = 90 * 1_000;

const UNANSWERED: WebSearchAnswer = { ok: false, error: "the app did not answer this web search" };

function isAnswer(value: unknown): value is WebSearchAnswer {
  return typeof value === "object" && value !== null && typeof (value as WebSearchAnswer).ok === "boolean";
}

export function createWebSearchExtension(options: { rpc: HostRpc; description: string }): NamedInlineExtension {
  const { rpc, description } = options;
  // Same rule as the container toolset: a blank description leaves the model guessing from the name alone, and a
  // loader that stopped inlining the markdown must fail at startup rather than quietly ship a mute tool.
  if (!description.trim()) {
    throw new Error(`${WEB_SEARCH_TOOL_NAME} has no description in the tool descriptions resource`);
  }
  return {
    name: "container-desktop-web-search",
    factory: (pi) => {
      pi.registerTool({
        name: WEB_SEARCH_TOOL_NAME,
        label: "Web search",
        description,
        parameters: Type.Object({ query: Type.String() }),
        async execute(_toolCallId, params, signal) {
          const query = String((params as { query?: unknown })?.query ?? "");
          const answer = await rpc.request<WebSearchAnswer>(
            "web_search",
            { query },
            { fallback: UNANSWERED, timeoutMs: WEB_SEARCH_TIMEOUT_MS, signal },
          );
          const result = isAnswer(answer) ? answer : UNANSWERED;
          if (!result.ok) {
            logger.warn("web search refused or failed", result.error);
            // pi marks a result isError by catching a throw; there is no error field to set.
            throw new Error(result.error);
          }
          // `details` is what the GUI card renders (piSessionView maps tool_end.details onto it), so it carries the
          // query too — a card showing only prose cannot say what was asked.
          return { content: [{ type: "text" as const, text: result.text }], details: { query, text: result.text } };
        },
      });
    },
  };
}
