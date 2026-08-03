// WebKitGTK smoke target: runs OMA's real orchestrator in the webview with a self-contained adapter.

import type { LLMAdapter, LLMChatOptions, LLMMessage, LLMStreamOptions, StreamEvent } from "@open-multi-agent/core";
import { OpenMultiAgent } from "@open-multi-agent/core";

const SMOKE_TEXT = "hello from the webview";
const SMOKE_USAGE = { input_tokens: 3, output_tokens: 5 };

// A minimal, self-contained LLMAdapter (implements both chat + stream) so the short-circuit runTeam completes
// successfully — the point is to exercise OMA's orchestration in the webview, not a real model.
const smokeAdapter: LLMAdapter = {
  name: "smoke-mock",
  async chat(_messages: LLMMessage[], options: LLMChatOptions) {
    return {
      id: "smoke",
      content: [{ type: "text", text: SMOKE_TEXT }],
      model: options.model ?? "mock",
      stop_reason: "end_turn",
      usage: SMOKE_USAGE,
    };
  },
  async *stream(_messages: LLMMessage[], options: LLMStreamOptions): AsyncIterable<StreamEvent> {
    yield { type: "text", data: SMOKE_TEXT };
    yield {
      type: "done",
      data: {
        id: "smoke",
        content: [{ type: "text", text: SMOKE_TEXT }],
        model: options.model ?? "mock",
        stop_reason: "end_turn",
        usage: SMOKE_USAGE,
      },
    };
  },
};

export async function omaWebviewSmoke(): Promise<Record<string, unknown>> {
  try {
    const adapter = smokeAdapter;
    // defaultCwd avoids OMA's `<process.cwd()>/.agent-workspace` sandbox default (path-safety.ts) — the
    // OMA-sanctioned way to keep node's process.cwd() off the webview path. Per-agent cwd set too.
    const oma = new OpenMultiAgent({ defaultCwd: "/oma" });
    const team = oma.createTeam("phase0-smoke", {
      name: "phase0-smoke",
      agents: [{ name: "smoke-agent", model: "mock", adapter, cwd: "/oma" }],
    });
    const result = await oma.runTeam(team, "hi", { coordinator: { adapter } });
    const firstTask = result.tasks?.[0];
    return {
      ok: true,
      success: result.success,
      status: result.status?.code,
      tasks: result.tasks?.length ?? 0,
      agentResults: result.agentResults ? Object.keys(result.agentResults).length : 0,
      // Surface WHY it settled error, to confirm it is a functional/mock outcome and not a swallowed node failure.
      errorInfo: result.errorInfo ? `${result.errorInfo.code ?? ""}: ${result.errorInfo.message ?? ""}` : undefined,
      taskStatus: firstTask?.status,
      taskError: firstTask && "error" in firstTask ? String((firstTask as { error?: unknown }).error ?? "") : undefined,
      totalTokens: result.totalTokenUsage
        ? result.totalTokenUsage.input_tokens + result.totalTokenUsage.output_tokens
        : undefined,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}
