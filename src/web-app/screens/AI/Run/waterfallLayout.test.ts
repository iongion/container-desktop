import { describe, expect, it } from "vitest";

import type { RunSpanView } from "@/ai-system/core/runEvents";
import { buildWaterfall, limitWaterfall } from "./waterfallLayout";

function span(overrides: Partial<RunSpanView> = {}): RunSpanView {
  const key = overrides.key ?? "trace:root";
  return {
    key,
    traceId: "trace",
    spanId: key.split(":").at(-1) ?? key,
    attempt: 1,
    kind: "task",
    name: key,
    status: "ok",
    incomplete: false,
    ...overrides,
  };
}

describe("buildWaterfall", () => {
  it("scales a single timed span to the full attempt width", () => {
    const layout = buildWaterfall([span({ startUnixMs: 1_000, endUnixMs: 2_000, durationMs: 1_000 })]);

    expect(layout.attempts).toHaveLength(1);
    expect(layout.attempts[0]).toMatchObject({ attempt: 1, startUnixMs: 1_000, endUnixMs: 2_000, durationMs: 1_000 });
    expect(layout.attempts[0]?.rows[0]).toMatchObject({
      key: "trace:root",
      depth: 0,
      offsetPercent: 0,
      widthPercent: 100,
      timingKnown: true,
    });
  });

  it("nests children by parent key and scales every row against the attempt", () => {
    const layout = buildWaterfall([
      span({ startUnixMs: 1_000, endUnixMs: 2_000, durationMs: 1_000 }),
      span({
        key: "trace:child",
        spanId: "child",
        parentKey: "trace:root",
        kind: "llm",
        startUnixMs: 1_100,
        endUnixMs: 1_300,
        durationMs: 200,
      }),
    ]);

    expect(layout.attempts[0]?.rows).toMatchObject([
      { key: "trace:root", depth: 0, hasChildren: true, offsetPercent: 0, widthPercent: 100 },
      { key: "trace:child", depth: 1, hasChildren: false, offsetPercent: 10, widthPercent: 20 },
    ]);
  });

  it("keeps zero-duration spans visible", () => {
    const layout = buildWaterfall([
      span({ startUnixMs: 1_000, endUnixMs: 2_000, durationMs: 1_000 }),
      span({ key: "trace:instant", spanId: "instant", startUnixMs: 1_500, endUnixMs: 1_500, durationMs: 0 }),
    ]);

    expect(layout.attempts[0]?.rows[1]).toMatchObject({ offsetPercent: 50, widthPercent: 0.35 });
  });

  it("marks missing starts unknown and leaves start-only spans without a width", () => {
    const layout = buildWaterfall([
      span({ startUnixMs: 1_000, endUnixMs: 1_200, durationMs: 200 }),
      span({ key: "trace:start-only", spanId: "start-only", startUnixMs: 1_050, incomplete: true }),
      span({ key: "trace:unknown", spanId: "unknown", durationMs: 50 }),
    ]);

    const startOnly = layout.attempts[0]?.rows.find((row) => row.key === "trace:start-only");
    expect(startOnly).toMatchObject({
      timingKnown: true,
      offsetPercent: 25,
    });
    expect(startOnly).not.toHaveProperty("widthPercent");
    const unknown = layout.attempts[0]?.rows.find((row) => row.key === "trace:unknown");
    expect(unknown).toMatchObject({
      timingKnown: false,
    });
    expect(unknown).not.toHaveProperty("offsetPercent");
    expect(unknown).not.toHaveProperty("widthPercent");
  });

  it("groups and independently scales attempts", () => {
    const layout = buildWaterfall([
      span({ attempt: 2, startUnixMs: 5_000, endUnixMs: 5_200, durationMs: 200 }),
      span({ attempt: 1, startUnixMs: 1_000, endUnixMs: 2_000, durationMs: 1_000 }),
    ]);

    expect(layout.attempts.map((attempt) => attempt.attempt)).toEqual([1, 2]);
    expect(layout.attempts.map((attempt) => attempt.rows[0]?.widthPercent)).toEqual([100, 100]);
  });
});

describe("limitWaterfall", () => {
  it("keeps one global preorder window across attempts and reports the remainder", () => {
    const layout = buildWaterfall([
      span({ key: "trace:a", spanId: "a", attempt: 1 }),
      span({ key: "trace:b", spanId: "b", attempt: 1 }),
      span({ key: "trace:c", spanId: "c", attempt: 2 }),
      span({ key: "trace:d", spanId: "d", attempt: 2 }),
    ]);

    expect(limitWaterfall(layout, 3)).toMatchObject({ visibleCount: 3, remainingCount: 1 });
    expect(limitWaterfall(layout, 3).attempts.map((attempt) => attempt.rows.map((row) => row.key))).toEqual([
      ["trace:a", "trace:b"],
      ["trace:c"],
    ]);
  });
});
