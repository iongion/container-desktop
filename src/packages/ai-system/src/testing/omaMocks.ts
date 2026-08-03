import type {
  LLMAdapter,
  LLMChatOptions,
  LLMMessage,
  LLMResponse,
  LLMStreamOptions,
  StreamEvent,
} from "@open-multi-agent/core";
import {
  makeCreateOmaAgentSession,
  type OmaAgentSessionAdapterObserver,
} from "@/ai-system/runtime/omaAgentSessionRuntime";
import { makeCreateOmaTeamRun, type OmaTeamAdapterContext } from "@/ai-system/runtime/omaTeamRun";
import { makeCompactThreadContext } from "@/ai-system/runtime/omaThreadCompactor";
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

export function mockVisibleUserText(modelInput: string): string {
  const firstLineEnd = modelInput.indexOf("\n");
  const firstLine = modelInput.slice(0, firstLineEnd < 0 ? undefined : firstLineEnd);
  const prefix = "User-invoked skill: ";
  if (!firstLine.startsWith(prefix)) return modelInput;
  const command = firstLine.slice(prefix.length).trim();
  const argumentsStart = modelInput.indexOf("Arguments supplied by the user:\n\n");
  if (argumentsStart < 0) return command;
  const valueStart = argumentsStart + "Arguments supplied by the user:\n\n".length;
  const valueEnd = modelInput.indexOf("\n\nSkill instructions:", valueStart);
  const args = modelInput.slice(valueStart, valueEnd < 0 ? undefined : valueEnd).trim();
  return args ? `${command} ${args}` : command;
}

// True when the LAST message is a tool result — a tool already ran THIS turn, so the model should now summarise
// rather than call another tool. Scanning the WHOLE history instead would make a session "spent" after its first
// tool call (every later user turn would skip tool selection), which is wrong — a real model offers tools every turn.
function toolAlreadyRanThisTurn(messages: readonly LLMMessage[]): boolean {
  const last = messages[messages.length - 1];
  return !!last && last.role === "user" && last.content.some((block) => block.type === "tool_result");
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

// Gated-mutation triggers for exercising the Assistant's native approval card with no provider key (ask mode gates
// every mutation). "restart/stop/remove … container" → ONE gated call; "restart … and/both/all …" → TWO gated
// calls in one turn. The OMA chat runner executes tool calls sequentially, so two calls
// surface as one approval card, then — after it is allowed and runs — the next: the flow drives them in order.
// Falls back to the read-tool picker (listContainers / readFile / …) for non-mutation intents.
function pickToolCalls(text: string, available: Set<string>): MockToolCall[] {
  const lower = text.toLowerCase();
  if (available.has("restartContainer") && /\brestart\b.*\b(?:and|both|all)\b/.test(lower)) {
    return [
      { name: "restartContainer", input: { id: "web" }, preamble: ["Restarting", "web", "and", "cache…"] },
      { name: "restartContainer", input: { id: "cache" }, preamble: [] },
    ];
  }
  const mutation =
    available.has("removeContainer") && /\b(?:remove|delete)\b.*\bcontainer\b/.test(lower)
      ? "removeContainer"
      : available.has("restartContainer") && /\brestart\b.*\bcontainer\b/.test(lower)
        ? "restartContainer"
        : available.has("stopContainer") && /\bstop\b.*\bcontainer\b/.test(lower)
          ? "stopContainer"
          : null;
  if (mutation) return [{ name: mutation, input: { id: "web" }, preamble: ["Working", "on", "the", "container…"] }];
  const read = pickToolCall(text, available);
  return read ? [read] : [];
}

// A scripted open-multi-agent LLMAdapter for CONTAINER_DESKTOP_MOCK: streams a deterministic reply token-by-token
// and, when tools are offered and the prompt asks for a container/workspace action, emits the matching tool call(s)
// so the full tool loop + generative-UI card + approval gate can be exercised end to end with no provider key.
// chat() is unused.
function createMockLlmAdapter(observer?: OmaAgentSessionAdapterObserver): LLMAdapter {
  return {
    name: "mock",
    async chat(messages, options: LLMChatOptions): Promise<LLMResponse> {
      const modelInput = lastUserText(messages);
      if (!toolAlreadyRanThisTurn(messages)) {
        const available = new Set((options.tools ?? []).map((tool) => tool.name));
        const calls = pickToolCalls(modelInput, available);
        if (calls.length > 0) {
          const text = calls[0].preamble.map((word) => `${word} `).join("");
          for (const word of calls[0].preamble) {
            if (options.abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");
            await delay(40, options.abortSignal);
            if (options.abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");
            observer?.onToken(`${word} `, messages);
          }
          return {
            id: randomUUID(),
            content: [
              ...(text ? [{ type: "text" as const, text }] : []),
              ...calls.map((call) => ({
                type: "tool_use" as const,
                id: randomUUID(),
                name: call.name,
                input: call.input,
              })),
            ],
            model: options.model,
            stop_reason: "tool_use",
            usage: { input_tokens: 8, output_tokens: 5 },
          };
        }
      }
      const reply = toolAlreadyRanThisTurn(messages)
        ? "Done — the result is shown in the card above."
        : `Mock open-multi-agent reply. You said: "${mockVisibleUserText(modelInput)}". Streaming this token by token proves the OMA runner, the ThreadEventEnvelope protocol, and the quake-console projection are wired end to end.`;
      const words = reply.split(" ");
      for (let index = 0; index < words.length; index += 1) {
        if (options.abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");
        await delay(45, options.abortSignal);
        if (options.abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");
        observer?.onToken(index === 0 ? words[index] : ` ${words[index]}`, messages);
      }
      return {
        id: randomUUID(),
        content: [{ type: "text", text: reply }],
        model: options.model,
        stop_reason: "end_turn",
        usage: { input_tokens: 8, output_tokens: words.length },
      };
    },
    async *stream(messages, options): AsyncIterable<StreamEvent> {
      const modelInput = lastUserText(messages);
      if (!toolAlreadyRanThisTurn(messages)) {
        const available = new Set((options.tools ?? []).map((tool) => tool.name));
        const calls = pickToolCalls(modelInput, available);
        if (calls.length > 0) {
          for (const word of calls[0].preamble) {
            if (options.abortSignal?.aborted) return;
            await delay(40, options.abortSignal);
            yield { type: "text", data: `${word} ` };
          }
          for (const call of calls) {
            yield {
              type: "tool_use",
              data: { type: "tool_use", id: randomUUID(), name: call.name, input: call.input },
            };
          }
          yield {
            type: "done",
            data: { id: randomUUID(), content: [], model: options.model, stop_reason: "tool_use" },
          };
          return;
        }
      }
      const reply = toolAlreadyRanThisTurn(messages)
        ? "Done — the result is shown in the card above."
        : `Mock open-multi-agent reply. You said: "${mockVisibleUserText(modelInput)}". Streaming this token by token proves the OMA runner, the ThreadEventEnvelope protocol, and the quake-console projection are wired end to end.`;
      yield* streamWords(reply, options);
    },
  };
}

// The mock chat uses OMA's real Agent runner with a scripted leaf adapter (provider/keychain untouched).
export const createMockOmaAgentSession = makeCreateOmaAgentSession((_task, observer) => createMockLlmAdapter(observer));
export const compactMockThreadContext = makeCompactThreadContext(() => createMockLlmAdapter());

// The mock coordinator's task DAG (inspect/review run in parallel, summarize fans in). Kept as data — not a frozen
// JSON string — so a roster run can bind each task to a worker: parsePlan REQUIRES every task to name a roster id
// once workers are supplied, so an unbound plan would fail to parse the instant a goal is started with a roster.
const MOCK_PLAN_TASKS: ReadonlyArray<{
  id: string;
  title: string;
  description: string;
  dependsOn: string[];
  agent: string;
}> = [
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
];

// The OMA coordinator prompt carries the roster as "- **<id>** — name: specialty" lines. Pull the ids back out so
// the scripted plan can assign one per task, round-robin —
// the mock's way of exercising multi-worker routing end to end without a real coordinator.
function rosterIdsFromPrompt(systemPrompt: string | undefined): string[] {
  const marker = systemPrompt?.indexOf("## Team Roster") ?? -1;
  if (marker < 0 || !systemPrompt) return [];
  return [...systemPrompt.slice(marker).matchAll(/^- \*\*([^*]+)\*\*/gm)].map((match) => match[1]);
}

function mockTeamPlan(rosterIds: string[]): string {
  const titleById = new Map(MOCK_PLAN_TASKS.map((task) => [task.id, task.title]));
  return JSON.stringify(
    MOCK_PLAN_TASKS.map((task, index) => ({
      title: task.title,
      description: task.description,
      assignee: rosterIds[index % rosterIds.length],
      dependsOn: task.dependsOn.map((id) => titleById.get(id) ?? id),
    })),
  );
}

function mockResponse(text: string, model: string): LLMResponse {
  return {
    id: randomUUID(),
    content: text ? [{ type: "text", text }] : [],
    model,
    stop_reason: "end_turn",
    usage: { input_tokens: 8, output_tokens: Math.max(1, text.split(/\s+/).length) },
  };
}

async function emitMockTeamText(
  context: OmaTeamAdapterContext,
  text: string,
  signal?: AbortSignal,
  messages?: readonly LLMMessage[],
): Promise<void> {
  const words = text.split(" ");
  for (let index = 0; index < words.length; index += 1) {
    await delay(45, signal);
    if (signal?.aborted) return;
    context.onToken(context.agentName, index === 0 ? words[index] : ` ${words[index]}`, messages);
  }
}

// A scripted OMA team-run adapter for CONTAINER_DESKTOP_MOCK. It implements chat() because OMA's runner owns the tool
// loop; provider-like word deltas still reach the UI through the same injected-adapter callback as real providers.
function createMockTeamAdapter(context: OmaTeamAdapterContext): LLMAdapter {
  const chat = async (messages: LLMMessage[], options: LLMChatOptions): Promise<LLMResponse> => {
    const brief = messages
      .flatMap((message) => message.content.map((block) => (block.type === "text" ? block.text : "")))
      .join("\n");
    if (context.role === "coordinator") {
      const text = brief.includes("## Task Results")
        ? "Mock team run complete. Every agent reported back, and this synthesis proves the decompose → approve → dispatch → synthesis path is wired end to end."
        : mockTeamPlan(rosterIdsFromPrompt(options.systemPrompt));
      await emitMockTeamText(context, text, options.abortSignal, messages);
      return mockResponse(text, options.model);
    }
    const title = brief.match(/# Task: (.+)/)?.[1] ?? "the task";
    // Exercise both tool paths on the first worker turn so the run screen can be driven end to end with no
    // provider key: an ungated read (renders a card) on one task, and a gated mutation (raises the approval
    // prompt, pausing only that worker) on another.
    const offered = new Set((options.tools ?? []).map((tool) => tool.name));
    const ranTool = toolAlreadyRanThisTurn(messages);
    if (!ranTool && offered.has("listContainers") && /Inspect/.test(title)) {
      const text = "Listing the running containers… ";
      await emitMockTeamText(context, text, options.abortSignal, messages);
      return {
        ...mockResponse(text, options.model),
        content: [
          { type: "text", text },
          { type: "tool_use", id: randomUUID(), name: "listContainers", input: {} },
        ],
        stop_reason: "tool_use",
      };
    }
    if (!ranTool && offered.has("stopContainer") && /Review/.test(title)) {
      const text = "One container looks wedged — asking to stop it. ";
      await emitMockTeamText(context, text, options.abortSignal, messages);
      return {
        ...mockResponse(text, options.model),
        content: [
          { type: "text", text },
          { type: "tool_use", id: randomUUID(), name: "stopContainer", input: { id: "mock-container-1" } },
        ],
        stop_reason: "tool_use",
      };
    }
    const text = `Mock agent finished "${title}" and reported its findings to the coordinator.`;
    await emitMockTeamText(context, text, options.abortSignal, messages);
    return mockResponse(text, options.model);
  };

  return {
    name: "mock-team",
    chat,
    async *stream(messages, options): AsyncIterable<StreamEvent> {
      yield { type: "done", data: await chat(messages, options) };
    },
  };
}

export const createMockOmaTeamRun = makeCreateOmaTeamRun(createMockTeamAdapter);
