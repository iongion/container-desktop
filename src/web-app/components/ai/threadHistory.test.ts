import { describe, expect, it } from "vitest";
import type { ThreadSummary } from "@/ai-system/core/threads";
import {
  moveThreadHistoryHighlight,
  resolveThreadHistoryHighlight,
  resolveThreadReference,
  selectThreadHistory,
  threadRelativeAge,
} from "@/web-app/components/ai/threadHistory";

const thread = (id: string, title: string, updatedAt: number): ThreadSummary => ({
  id,
  title,
  createdAt: updatedAt,
  updatedAt,
  phase: "idle",
  lastSeq: 0,
});

describe("threadRelativeAge", () => {
  it("uses the largest useful compact unit", () => {
    const now = 10 * 24 * 60 * 60 * 1_000;

    expect(threadRelativeAge(now - 30_000, now)).toEqual({ value: -30, unit: "second" });
    expect(threadRelativeAge(now - 90_000, now)).toEqual({ value: -1, unit: "minute" });
    expect(threadRelativeAge(now - 3 * 60 * 60 * 1_000, now)).toEqual({ value: -3, unit: "hour" });
    expect(threadRelativeAge(now - 2 * 24 * 60 * 60 * 1_000, now)).toEqual({ value: -2, unit: "day" });
  });
});

describe("selectThreadHistory", () => {
  it("orders the newest threads first without mutating the source", () => {
    const source = [thread("old", "Old", 1), thread("new", "New", 3), thread("mid", "Mid", 2)];

    expect(selectThreadHistory(source, "").map((entry) => entry.id)).toEqual(["new", "mid", "old"]);
    expect(source.map((entry) => entry.id)).toEqual(["old", "new", "mid"]);
  });

  it("searches titles as the user types, ignoring case and surrounding whitespace", () => {
    const source = [
      thread("one", "Restart the web container", 1),
      thread("two", "Inspect production volumes", 3),
      thread("three", "Container cleanup", 2),
    ];

    expect(selectThreadHistory(source, "  CONTAIN ").map((entry) => entry.id)).toEqual(["three", "one"]);
  });

  it("uses the id as a deterministic tie-breaker", () => {
    const source = [thread("z", "Last", 2), thread("a", "First", 2)];

    expect(selectThreadHistory(source, "").map((entry) => entry.id)).toEqual(["a", "z"]);
  });
});

describe("Thread history keyboard selection", () => {
  const threads = [thread("new", "Newest", 3), thread("mid", "Middle", 2), thread("old", "Oldest", 1)];

  it("preserves a highlighted row by identity and otherwise prefers the active Thread", () => {
    expect(resolveThreadHistoryHighlight(threads, "mid", "new")).toBe("mid");
    expect(resolveThreadHistoryHighlight(threads, "filtered-out", "new")).toBe("new");
    expect(resolveThreadHistoryHighlight(threads, undefined, "filtered-out")).toBe("new");
    expect(resolveThreadHistoryHighlight([], "mid", "new")).toBeUndefined();
  });

  it("moves and wraps one full-row highlight without relying on browser scrolling", () => {
    expect(moveThreadHistoryHighlight(threads, "new", 1)).toBe("mid");
    expect(moveThreadHistoryHighlight(threads, "new", -1)).toBe("old");
    expect(moveThreadHistoryHighlight(threads, "mid", 5)).toBe("new");
    expect(moveThreadHistoryHighlight(threads, undefined, 1)).toBe("new");
  });
});

describe("resolveThreadReference", () => {
  const threads = [
    thread("thread-1", "Inspect volumes", 3),
    thread("thread-2", "Restart containers", 2),
    thread("thread-3", "Restart containers", 1),
  ];

  it("prefers an exact id, then a unique case-insensitive title", () => {
    expect(resolveThreadReference(threads, "thread-1")).toEqual({ kind: "resolved", thread: threads[0] });
    expect(resolveThreadReference(threads, "INSPECT VOLUMES")).toEqual({ kind: "resolved", thread: threads[0] });
  });

  it("does not guess when a title is ambiguous or absent", () => {
    expect(resolveThreadReference(threads, "Restart containers")).toEqual({ kind: "ambiguous" });
    expect(resolveThreadReference(threads, "Restart")).toEqual({ kind: "not-found" });
  });
});
