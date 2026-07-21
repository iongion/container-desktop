import { describe, expect, it } from "vitest";
import type { ChatEventEnvelope } from "@/ai-system/core/chatEvents";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import type { AgentSessionCreationOptions, AgentSessionTaskSettings } from "@/ai-system/core/types";
import { makeCreateAgentSession } from "./interactiveEngine";
import { createOmaAdapter } from "./omaAdapter";

// Build an OpenAI-compatible chat-completions SSE body (the wire format @ai-sdk/openai-compatible parses).
function sseResponse(contentChunks: string[]): Response {
  const chunkEvents = [
    { choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
    ...contentChunks.map((content) => ({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })),
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ];
  const body = `${chunkEvents
    .map(
      (event) =>
        `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...event })}`,
    )
    .join("\n\n")}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const RESOLVED = {
  id: "test-openai-compatible",
  kind: "openai-compatible",
  baseURL: "https://example.test/v1",
  model: "test-model",
  isCloud: true,
  requiresKey: false,
  auth: { scheme: "none" },
  discovery: "openai-compatible",
} as unknown as ResolvedProvider;

async function drain(events: ChatEventEnvelope[]): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (events.some((e) => e.event.type === "task-complete" || e.event.type === "error")) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("createOmaAdapter (real AI-SDK provider path)", () => {
  it("streams an OpenAI-compatible SSE response through the owned loop as assistant deltas", async () => {
    const fetchStub = (async () => sseResponse(["Hello", " from", " OpenRouter"])) as unknown as typeof fetch;
    const task = {
      resolved: RESOLVED,
      providerFetch: fetchStub,
      system: "system",
      permissionMode: "ask",
      execution: {},
    } as unknown as AgentSessionTaskSettings;
    const events: ChatEventEnvelope[] = [];
    const options: AgentSessionCreationOptions = {
      sessionId: "s1",
      history: [],
      taskSettings: task,
      emit: (envelope) => events.push(envelope),
    };
    const session = makeCreateAgentSession(() => createOmaAdapter(RESOLVED, fetchStub))(options);

    await session.submit({ id: "m1", content: "hi", createdAt: 1 });
    await drain(events);

    const errors = events.flatMap((e) => (e.event.type === "error" ? [e.event.message] : []));
    expect(errors).toEqual([]);
    const deltas = events.flatMap((e) => (e.event.type === "assistant-delta" ? [e.event.text] : [])).join("");
    expect(deltas).toBe("Hello from OpenRouter");
    const assistant = session.snapshot().timeline.find((t) => t.kind === "message" && t.role === "assistant");
    expect(assistant).toMatchObject({ status: "complete", content: "Hello from OpenRouter" });
  });
});
