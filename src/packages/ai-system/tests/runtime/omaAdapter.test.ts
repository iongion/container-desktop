import { describe, expect, it } from "vitest";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import type { ThreadEventEnvelope } from "@/ai-system/core/threadEvents";
import type { AgentSessionCreationOptions, AgentSessionTaskSettings } from "@/ai-system/core/types";
import { createOmaAdapter } from "@/ai-system/runtime/omaAdapter";
import { makeCreateOmaAgentSession } from "@/ai-system/runtime/omaAgentSessionRuntime";

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

function controlledSseResponse(): {
  response: Response;
  push: (content: string) => void;
  finish: () => void;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        streamController.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              id: "c",
              object: "chat.completion.chunk",
              created: 0,
              model: "m",
              choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
            })}\n\n`,
          ),
        );
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
  return {
    response,
    push(content) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            id: "c",
            object: "chat.completion.chunk",
            created: 0,
            model: "m",
            choices: [{ index: 0, delta: { content }, finish_reason: null }],
          })}\n\n`,
        ),
      );
    },
    finish() {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            id: "c",
            object: "chat.completion.chunk",
            created: 0,
            model: "m",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          })}\n\ndata: [DONE]\n\n`,
        ),
      );
      controller.close();
    },
  };
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

async function drain(events: ThreadEventEnvelope[]): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (events.some((e) => e.event.type === "task-complete" || e.event.type === "error")) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for streamed token");
}

describe("createOmaAdapter (real AI-SDK provider path)", () => {
  it("forwards provider deltas before OMA chat resolves", async () => {
    const controlled = controlledSseResponse();
    const fetchStub = (async () => controlled.response) as unknown as typeof fetch;
    const deltas: string[] = [];
    const adapter = createOmaAdapter(RESOLVED, fetchStub, {
      agentName: "worker-1",
      onToken: (agentName, delta) => deltas.push(`${agentName}:${delta}`),
    });
    let settled = false;
    const chat = adapter
      .chat([{ role: "user", content: [{ type: "text", text: "hi" }] }], { model: "test-model" })
      .finally(() => {
        settled = true;
      });

    controlled.push("Hello");
    await waitFor(() => deltas.length === 1);
    expect(settled).toBe(false);
    controlled.push(" world");
    await waitFor(() => deltas.length === 2);
    expect(settled).toBe(false);
    controlled.finish();

    await expect(chat).resolves.toMatchObject({
      content: [{ type: "text", text: "Hello world" }],
      stop_reason: "end_turn",
    });
    expect(deltas).toEqual(["worker-1:Hello", "worker-1: world"]);
  });

  it("streams an OpenAI-compatible SSE response through the OMA Agent runner as assistant deltas", async () => {
    const fetchStub = (async () => sseResponse(["Hello", " from", " OpenRouter"])) as unknown as typeof fetch;
    const task = {
      resolved: RESOLVED,
      providerFetch: fetchStub,
      system: "system",
      permissionMode: "ask",
      execution: {},
    } as unknown as AgentSessionTaskSettings;
    const events: ThreadEventEnvelope[] = [];
    const options: AgentSessionCreationOptions = {
      threadId: "s1",
      history: [],
      taskSettings: task,
      emit: (envelope) => events.push(envelope),
    };
    const session = makeCreateOmaAgentSession((_task, observer) =>
      createOmaAdapter(RESOLVED, fetchStub, {
        agentName: "assistant",
        onToken: (_agentName, delta, messages) => observer.onToken(delta, messages),
      }),
    )(options);

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
