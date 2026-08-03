import { describe, expect, it } from "vitest";
import { spanToRunEvents, type TraceRecordLike } from "@/ai-system/core/spanEvents";

const BASE = {
  schemaVersion: 2,
  recordId: "record-1",
  sequence: 1,
  timestampUnixMs: 100,
  runId: "run-1",
  attempt: 1,
  traceId: "trace-1",
  spanId: "span-1",
} as const;

function end(
  kind: string,
  attributes: Record<string, unknown>,
  overrides: Partial<TraceRecordLike> = {},
): TraceRecordLike {
  return {
    ...BASE,
    recordType: "span_end",
    kind,
    name: kind === "task" ? "execute_task" : kind === "tool" ? "execute_tool" : "chat",
    startUnixMs: 100,
    endUnixMs: 920,
    durationMs: 820,
    status: { code: "ok" },
    attributes,
    ...overrides,
  };
}

describe("spanToRunEvents", () => {
  it("maps a task span into hierarchy and authoritative timing/retry metrics", () => {
    const events = spanToRunEvents(
      end("task", {
        "oma.task.id": "task-1",
        "oma.task.title": "Inspect",
        "oma.agent.name": "worker-1",
        "oma.task.retries": 2,
        ignored: "not projected",
      }),
    );

    expect(events).toEqual([
      {
        type: "span-close",
        span: {
          key: "trace-1:span-1",
          traceId: "trace-1",
          spanId: "span-1",
          attempt: 1,
          kind: "task",
          name: "execute_task",
          status: "ok",
          incomplete: false,
          startUnixMs: 100,
          endUnixMs: 920,
          durationMs: 820,
          agent: "worker-1",
          taskId: "task-1",
          taskTitle: "Inspect",
          retries: 2,
        },
      },
      {
        type: "task-metrics",
        taskId: "task-1",
        startedAt: 100,
        endedAt: 920,
        durationMs: 820,
        retries: 2,
      },
    ]);
  });

  it("attributes LLM tokens/model/provider to its task and preserves its parent", () => {
    const events = spanToRunEvents(
      end(
        "llm",
        {
          "oma.task.id": "task-1",
          "oma.agent.name": "worker-1",
          "oma.llm.model": "model-a",
          "oma.llm.provider": "openrouter",
          "oma.usage.input_tokens": 21,
          "oma.usage.output_tokens": 13,
          "oma.phase": "turn",
        },
        { spanId: "llm-1", parentSpanId: "agent-1" },
      ),
    );

    expect(events[0]).toMatchObject({
      type: "span-close",
      span: {
        key: "trace-1:llm-1",
        parentKey: "trace-1:agent-1",
        model: "model-a",
        provider: "openrouter",
        inputTokens: 21,
        outputTokens: 13,
        taskId: "task-1",
      },
    });
    expect(events[1]).toEqual({
      type: "task-metrics",
      taskId: "task-1",
      model: "model-a",
      provider: "openrouter",
      inputTokens: 21,
      outputTokens: 13,
    });
  });

  it("counts a completed tool span against its task", () => {
    expect(
      spanToRunEvents(end("tool", { "oma.task.id": "task-1", "oma.tool.name": "inspectContainer" })).at(-1),
    ).toEqual({ type: "task-metrics", taskId: "task-1", toolCalls: 1 });
  });

  it("keeps coordinator decomposition and synthesis spans distinguishable", () => {
    const decompose = spanToRunEvents(end("agent", { "oma.agent.name": "coordinator", "oma.phase": "decomposition" }));
    const synthesis = spanToRunEvents(
      end("agent", { "oma.agent.name": "coordinator", "oma.phase": "synthesis" }, { spanId: "span-2" }),
    );

    expect(decompose[0]).toMatchObject({ type: "span-close", span: { phase: "decomposition" } });
    expect(synthesis[0]).toMatchObject({ type: "span-close", span: { phase: "synthesis" } });
  });
});
