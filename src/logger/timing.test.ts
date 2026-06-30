import { describe, expect, it } from "vitest";
import { createTimeline } from "@/logger/timing";

function fakeClock(steps: number[]): () => number {
  const seq = [0, ...steps];
  let i = 0;
  return () => seq[Math.min(i++, seq.length - 1)];
}

describe("createTimeline", () => {
  it("records marks as ms since t0", () => {
    const t = createTimeline({ now: fakeClock([5, 12]) }); // t0=0, marks at 5, 12
    t.mark("a");
    t.mark("b");
    expect(t.marks()).toEqual([
      { name: "a", at: 5 },
      { name: "b", at: 12 },
    ]);
  });

  it("since() returns elapsed from t0 or a named mark", () => {
    const t = createTimeline({ now: fakeClock([10, 30, 30]) });
    t.mark("a"); // at 10
    expect(t.since("a")).toBe(20); // 30 - 10
    expect(t.since()).toBe(30); // 30 - 0
  });

  it("summary() lists marks with per-step deltas and a total", () => {
    const t = createTimeline({ now: fakeClock([5, 20]), label: "startup" });
    t.mark("first");
    t.mark("second");
    const s = t.summary();
    expect(s).toContain("startup");
    expect(s).toContain("first");
    expect(s).toContain("+5");
    expect(s).toContain("second");
    expect(s).toContain("+15"); // 20 - 5
    expect(s).toContain("20"); // total
  });
});
