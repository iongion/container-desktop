import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import type { ResolvedProvider } from "@/ai-system/core";
import { createAgentRunner } from "./agent";
import { createAgentTools } from "./tools";

const resolved: ResolvedProvider = {
  id: "llamacpp",
  kind: "local",
  baseURL: "http://127.0.0.1:8080/v1",
  model: "test",
  isCloud: false,
  requiresKey: false,
  auth: { scheme: "none" },
};

function textModel(parts: string[]) {
  const chunks = [
    { type: "text-start", id: "1" },
    ...parts.map((delta) => ({ type: "text-delta", id: "1", delta })),
    { type: "text-end", id: "1" },
    { type: "finish", finishReason: "stop", usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } },
  ];
  return new MockLanguageModelV3({
    doStream: async () => ({ stream: simulateReadableStream({ chunks: chunks as never[] }) }),
  });
}

// Step 1 emits a tool-call; step 2 (after the tool result) streams the analysis text.
function toolThenTextModel(toolName: string, input: unknown) {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      const chunks =
        call === 1
          ? [
              { type: "tool-call", toolCallId: "tc1", toolName, input: JSON.stringify(input) },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
              },
            ]
          : [
              { type: "text-start", id: "1" },
              { type: "text-delta", id: "1", delta: "Analysis done" },
              { type: "text-end", id: "1" },
              {
                type: "finish",
                finishReason: "stop",
                usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
              },
            ];
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
    },
  });
}

describe("createAgentRunner", () => {
  it("streams text deltas then settles via onDone", async () => {
    const onDelta = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const run = createAgentRunner({ buildModel: () => textModel(["Looks ", "healthy"]) });
    run({
      resolved,
      system: "s",
      messages: [{ role: "user", content: "status?" }],
      tools: {},
      signal: new AbortController().signal,
      onDelta,
      onDone,
      onError,
    });
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onDelta.mock.calls.map((c) => c[0]).join("")).toBe("Looks healthy");
    expect(onError).not.toHaveBeenCalled();
  });

  it("executes a model tool-call through the sandbox, then streams the analysis", async () => {
    const runSandboxed = vi.fn(async () => ({
      ok: true,
      tier: "SAFE" as const,
      reason: "",
      stdout: "CID\n",
      stderr: "",
      code: 0,
      truncated: false,
    }));
    const tools = createAgentTools({ runSandboxed, searchKnowledge: vi.fn(async () => []), mode: "allow" });
    const onDelta = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const run = createAgentRunner({
      buildModel: () => toolThenTextModel("runCommand", { program: "podman", args: ["ps"] }),
    });
    run({
      resolved,
      system: "s",
      messages: [{ role: "user", content: "why is podman unreachable?" }],
      tools,
      maxSteps: 5,
      signal: new AbortController().signal,
      onDelta,
      onDone,
      onError,
    });
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(runSandboxed).toHaveBeenCalledWith({ program: "podman", args: ["ps"] }, { enforceFloor: false });
    expect(onDelta.mock.calls.map((c) => c[0]).join("")).toContain("Analysis done");
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a model build failure via onError without throwing", () => {
    const onError = vi.fn();
    const run = createAgentRunner({
      buildModel: () => {
        throw new Error("bad provider");
      },
    });
    run({
      resolved,
      system: "s",
      messages: [{ role: "user", content: "x" }],
      tools: {},
      signal: new AbortController().signal,
      onDelta: vi.fn(),
      onDone: vi.fn(),
      onError,
    });
    expect(onError).toHaveBeenCalledWith("bad provider");
  });
});
