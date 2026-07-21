import type { LLMAdapter, LLMMessage, LLMStreamOptions, StreamEvent } from "@open-multi-agent/core";
import { type GoalRole, makeCreateGoalRun } from "@/ai-system/runtime/goalOrchestrator";
import { makeCreateAgentSession } from "@/ai-system/runtime/interactiveEngine";
import { randomUUID } from "@/utils/randomUUID";

function lastUserText(messages: readonly LLMMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    if (text.trim()) return text.trim();
  }
  return "your message";
}

function ranAnyTool(messages: readonly LLMMessage[]): boolean {
  return messages.some((m) => m.role === "user" && m.content.some((b) => b.type === "tool_result"));
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function* streamWords(text: string, options: LLMStreamOptions): AsyncIterable<StreamEvent> {
  const words = text.split(" ");
  for (let index = 0; index < words.length; index += 1) {
    if (options.abortSignal?.aborted) return;
    await delay(45, options.abortSignal);
    if (options.abortSignal?.aborted) return;
    yield { type: "text", data: index === 0 ? words[index] : ` ${words[index]}` };
  }
  yield {
    type: "done",
    data: { id: randomUUID(), content: [{ type: "text", text }], model: options.model, stop_reason: "end_turn" },
  };
}

interface MockToolCall {
  name: string;
  input: Record<string, unknown>;
  preamble: string[];
}

// Map a free-text prompt to a scripted tool call when the matching tool is offered — enough to exercise the full
// tool loop + generative-UI card end to end with no provider key. Container intents drive listContainers; workspace
// intents drive the real IWorkspaceAccess tools (executed against the configured workspace root on disk).
function pickToolCall(text: string, available: Set<string>): MockToolCall | null {
  const lower = text.toLowerCase();
  const filePath = text.match(/[\w./-]*\.\w[\w./-]*/)?.[0];

  if (
    available.has("listContainers") &&
    /container|image|volume|network/.test(lower) &&
    /list|show|what|which|my|any/.test(lower)
  ) {
    return { name: "listContainers", input: {}, preamble: ["Let", "me", "check", "your", "containers…"] };
  }
  if (available.has("editFile") && /\b(edit|change|replace|rename|fix)\b/.test(lower) && filePath) {
    const oldString = text.match(/"([^"]+)"/)?.[1] ?? "TODO";
    const newString = text.match(/"[^"]+"\s*(?:->|to|with)\s*"([^"]+)"/)?.[1] ?? "DONE";
    return { name: "editFile", input: { path: filePath, oldString, newString }, preamble: ["Editing", `${filePath}…`] };
  }
  if (available.has("readFile") && /\b(read|open|show|view|cat|print)\b/.test(lower) && filePath) {
    return { name: "readFile", input: { path: filePath }, preamble: ["Reading", `${filePath}…`] };
  }
  if (available.has("searchText") && /\b(search|grep|find|where)\b/.test(lower)) {
    const pattern =
      text.match(/"([^"]+)"/)?.[1] ??
      text.match(/(?:search|grep|find|look)\s+(?:for\s+)?["']?([\w-]{2,})/i)?.[1] ??
      "TODO";
    return { name: "searchText", input: { pattern }, preamble: ["Searching", `for "${pattern}"…`] };
  }
  if (available.has("findFiles") && /\b(list|files|glob)\b/.test(lower)) {
    return { name: "findFiles", input: { pattern: "**/*" }, preamble: ["Listing", "files…"] };
  }
  return null;
}

// A scripted open-multi-agent LLMAdapter for CONTAINER_DESKTOP_MOCK: streams a deterministic reply token-by-token
// and, when tools are offered and the prompt asks for a container/workspace action, emits the matching tool call so the
// full tool loop + generative-UI card can be exercised end to end with no provider key. chat() is unused.
export function createMockLlmAdapter(): LLMAdapter {
  return {
    name: "mock",
    async chat() {
      throw new Error("mock adapter: chat() is not used by the interactive loop");
    },
    async *stream(messages, options): AsyncIterable<StreamEvent> {
      const echo = lastUserText(messages);
      if (!ranAnyTool(messages)) {
        const available = new Set((options.tools ?? []).map((tool) => tool.name));
        const call = pickToolCall(echo, available);
        if (call) {
          for (const word of call.preamble) {
            if (options.abortSignal?.aborted) return;
            await delay(40, options.abortSignal);
            yield { type: "text", data: `${word} ` };
          }
          yield { type: "tool_use", data: { type: "tool_use", id: randomUUID(), name: call.name, input: call.input } };
          yield {
            type: "done",
            data: { id: randomUUID(), content: [], model: options.model, stop_reason: "tool_use" },
          };
          return;
        }
      }
      const reply = ranAnyTool(messages)
        ? "Done — the result is shown in the card above."
        : `Mock open-multi-agent reply. You said: "${echo}". Streaming this token by token proves the owned loop, the ChatEventEnvelope protocol, and the quake-console projection are wired end to end.`;
      yield* streamWords(reply, options);
    },
  };
}

// The mock interactive engine: the owned loop wired to the scripted adapter (real provider/keychain untouched).
export const createMockOmaAgentSession = makeCreateAgentSession(() => createMockLlmAdapter());

const MOCK_GOAL_PLAN = JSON.stringify({
  tasks: [
    {
      id: "inspect",
      title: "Inspect the running containers",
      description: "List the containers on the primary connection and note anything unhealthy.",
      dependsOn: [],
      agent: "inspector",
    },
    {
      id: "review",
      title: "Review the engine configuration",
      description: "Check the connection settings for misconfiguration.",
      dependsOn: [],
      agent: "reviewer",
    },
    {
      id: "summarize",
      title: "Summarise the findings",
      description: "Combine both reports into a recommendation.",
      dependsOn: ["inspect", "review"],
      agent: "writer",
    },
  ],
});

// A scripted goal-mode adapter for CONTAINER_DESKTOP_MOCK. Stateless by design: the coordinator's decomposition and
// synthesis turns are told apart by their brief (only the synthesis brief carries a task-results section), so two
// concurrent runs can never share a turn counter the way a closure-held one would.
function createMockGoalAdapter(role: GoalRole): LLMAdapter {
  return {
    name: "mock-goal",
    async chat() {
      throw new Error("mock adapter: chat() is not used by the goal driver");
    },
    async *stream(messages, options): AsyncIterable<StreamEvent> {
      const brief = messages
        .flatMap((message) => message.content.map((block) => (block.type === "text" ? block.text : "")))
        .join("\n");
      if (role === "coordinator") {
        if (brief.includes("# Task results")) {
          yield* streamWords(
            "Mock goal run complete. Every agent reported back, and this synthesis proves the decompose → approve → dispatch → synthesis path is wired end to end.",
            options,
          );
          return;
        }
        yield { type: "text", data: MOCK_GOAL_PLAN };
        yield { type: "done", data: { id: randomUUID(), content: [], model: options.model, stop_reason: "end_turn" } };
        return;
      }
      const title = brief.match(/# Your task: (.+)/)?.[1] ?? "the task";
      // Exercise both tool paths on the first worker turn so the goal screen can be driven end to end with no
      // provider key: an ungated read (renders a card) on one task, and a gated mutation (raises the approval
      // prompt, pausing only that worker) on another.
      const offered = new Set((options.tools ?? []).map((tool) => tool.name));
      const ranTool = messages.some((message) => message.content.some((block) => block.type === "tool_result"));
      if (!ranTool && offered.has("listContainers") && /Inspect/.test(title)) {
        yield { type: "text", data: "Listing the running containers… " };
        yield { type: "tool_use", data: { type: "tool_use", id: randomUUID(), name: "listContainers", input: {} } };
        yield { type: "done", data: { id: randomUUID(), content: [], model: options.model, stop_reason: "tool_use" } };
        return;
      }
      if (!ranTool && offered.has("stopContainer") && /Review/.test(title)) {
        yield { type: "text", data: "One container looks wedged — asking to stop it. " };
        yield {
          type: "tool_use",
          data: { type: "tool_use", id: randomUUID(), name: "stopContainer", input: { id: "mock-container-1" } },
        };
        yield { type: "done", data: { id: randomUUID(), content: [], model: options.model, stop_reason: "tool_use" } };
        return;
      }
      yield* streamWords(`Mock agent finished "${title}" and reported its findings to the coordinator.`, options);
    },
  };
}

// The mock goal engine: the owned multi-agent driver wired to the scripted adapter.
export const createMockOmaGoalRun = makeCreateGoalRun((_access, role) => createMockGoalAdapter(role));
