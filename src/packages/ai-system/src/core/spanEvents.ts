import type { RunEvent, RunMoney, RunSpanView } from "./runEvents";

export interface TraceRecordLike {
  schemaVersion: number;
  recordId: string;
  sequence: number;
  timestampUnixMs: number;
  runId: string;
  attempt: number;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  recordType: "span_start" | "span_event" | "span_end";
  kind?: string;
  name: string;
  startUnixMs?: number;
  endUnixMs?: number;
  durationMs?: number;
  status?: { code?: string; message?: string };
  error?: { message?: string };
  attributes: Record<string, unknown>;
}

interface SpanCostContext {
  agentName?: string;
  model?: string;
  provider?: string;
  phase?: string;
  taskId?: string;
}

interface SpanMappingOptions {
  resolveProvider?: (context: SpanCostContext) => string | undefined;
  estimateCost?: (
    usage: { inputTokens: number; outputTokens: number },
    context: SpanCostContext,
  ) => RunMoney | undefined;
}

function textAttribute(attributes: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function numberAttribute(attributes: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

function statusCode(record: TraceRecordLike): RunSpanView["status"] {
  if (record.recordType === "span_start") return "running";
  const code = record.status?.code;
  return code === "ok" ||
    code === "error" ||
    code === "cancelled" ||
    code === "timeout" ||
    code === "budget_exhausted" ||
    code === "rejected" ||
    code === "skipped"
    ? code
    : "unknown";
}

function explicitCost(attributes: Record<string, unknown>): RunMoney | undefined {
  const amount = numberAttribute(attributes, "oma.cost.amount");
  const currency = textAttribute(attributes, "oma.cost.currency");
  return amount !== undefined && currency ? { amount, currency } : undefined;
}

function projectSpan(record: TraceRecordLike, options: SpanMappingOptions): RunSpanView | undefined {
  if (record.recordType === "span_event" || !record.kind) return undefined;
  const attributes = record.attributes;
  const agent = textAttribute(attributes, "oma.agent.name");
  const taskId = textAttribute(attributes, "oma.task.id");
  const model = textAttribute(
    attributes,
    "oma.llm.model",
    "oma.model",
    "gen_ai.request.model",
    "gen_ai.response.model",
  );
  const tracedProvider = textAttribute(
    attributes,
    "oma.llm.provider",
    "oma.provider",
    "gen_ai.provider.name",
    "gen_ai.system",
  );
  const phase = textAttribute(attributes, "oma.phase");
  const inputTokens = numberAttribute(attributes, "oma.usage.input_tokens", "gen_ai.usage.input_tokens");
  const outputTokens = numberAttribute(attributes, "oma.usage.output_tokens", "gen_ai.usage.output_tokens");
  const context = { agentName: agent, model, provider: tracedProvider, phase, taskId };
  const provider = options.resolveProvider?.(context) ?? tracedProvider;
  const estimatedCost =
    record.recordType === "span_end" && inputTokens !== undefined && outputTokens !== undefined
      ? options.estimateCost?.({ inputTokens, outputTokens }, { ...context, provider })
      : undefined;
  const error = record.error?.message || record.status?.message;
  return {
    key: `${record.traceId}:${record.spanId}`,
    traceId: record.traceId,
    spanId: record.spanId,
    ...(record.parentSpanId ? { parentKey: `${record.traceId}:${record.parentSpanId}` } : {}),
    attempt: Math.max(1, Math.trunc(record.attempt)),
    kind: record.kind,
    name: record.name,
    status: statusCode(record),
    incomplete: record.recordType !== "span_end",
    ...(record.startUnixMs !== undefined ? { startUnixMs: record.startUnixMs } : {}),
    ...(record.endUnixMs !== undefined ? { endUnixMs: record.endUnixMs } : {}),
    ...(record.durationMs !== undefined ? { durationMs: Math.max(0, record.durationMs) } : {}),
    ...(agent ? { agent } : {}),
    ...(taskId ? { taskId } : {}),
    ...(textAttribute(attributes, "oma.task.title") ? { taskTitle: textAttribute(attributes, "oma.task.title") } : {}),
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    ...(textAttribute(attributes, "oma.tool.name") ? { tool: textAttribute(attributes, "oma.tool.name") } : {}),
    ...(phase ? { phase } : {}),
    ...(inputTokens !== undefined ? { inputTokens: Math.trunc(inputTokens) } : {}),
    ...(outputTokens !== undefined ? { outputTokens: Math.trunc(outputTokens) } : {}),
    ...((explicitCost(attributes) ?? estimatedCost) ? { cost: explicitCost(attributes) ?? estimatedCost } : {}),
    ...(numberAttribute(attributes, "oma.task.retries") !== undefined
      ? { retries: Math.trunc(numberAttribute(attributes, "oma.task.retries") ?? 0) }
      : {}),
    ...(error ? { error } : {}),
  };
}

function taskMetrics(span: RunSpanView): RunEvent | undefined {
  if (!span.taskId) return undefined;
  if (span.kind === "task") {
    return {
      type: "task-metrics",
      taskId: span.taskId,
      ...(span.startUnixMs !== undefined ? { startedAt: span.startUnixMs } : {}),
      ...(span.endUnixMs !== undefined ? { endedAt: span.endUnixMs } : {}),
      ...(span.durationMs !== undefined ? { durationMs: span.durationMs } : {}),
      ...(span.retries !== undefined ? { retries: span.retries } : {}),
    };
  }
  if (span.kind === "llm" && !span.incomplete) {
    return {
      type: "task-metrics",
      taskId: span.taskId,
      ...(span.model ? { model: span.model } : {}),
      ...(span.provider ? { provider: span.provider } : {}),
      ...(span.inputTokens !== undefined ? { inputTokens: span.inputTokens } : {}),
      ...(span.outputTokens !== undefined ? { outputTokens: span.outputTokens } : {}),
      ...(span.cost ? { cost: span.cost } : {}),
    };
  }
  if (span.kind === "tool" && !span.incomplete) {
    return { type: "task-metrics", taskId: span.taskId, toolCalls: 1 };
  }
  return undefined;
}

export function spanToRunEvents(record: TraceRecordLike, options: SpanMappingOptions = {}): RunEvent[] {
  const span = projectSpan(record, options);
  if (!span) return [];
  const events: RunEvent[] = [{ type: record.recordType === "span_start" ? "span-open" : "span-close", span }];
  const metrics = taskMetrics(span);
  if (metrics) events.push(metrics);
  return events;
}
