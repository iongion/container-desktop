import { describe, expect, it } from "vitest";
import type { SessionSummary } from "@/ai-system/core/sessions";
import {
  moveSessionHistoryHighlight,
  resolveSessionHistoryHighlight,
  resolveSessionReference,
  selectSessionHistory,
  sessionRelativeAge,
} from "@/web-app/components/ai/sessionHistory";

const session = (id: string, title: string, updatedAt: number): SessionSummary => ({
  id,
  title,
  createdAt: updatedAt,
  updatedAt,
  phase: "idle",
  lastSeq: 0,
});

describe("sessionRelativeAge", () => {
  it("uses the largest useful compact unit", () => {
    const now = 10 * 24 * 60 * 60 * 1_000;

    expect(sessionRelativeAge(now - 30_000, now)).toEqual({ value: -30, unit: "second" });
    expect(sessionRelativeAge(now - 90_000, now)).toEqual({ value: -1, unit: "minute" });
    expect(sessionRelativeAge(now - 3 * 60 * 60 * 1_000, now)).toEqual({ value: -3, unit: "hour" });
    expect(sessionRelativeAge(now - 2 * 24 * 60 * 60 * 1_000, now)).toEqual({ value: -2, unit: "day" });
  });
});

describe("selectSessionHistory", () => {
  it("orders the newest sessions first without mutating the source", () => {
    const source = [session("old", "Old", 1), session("new", "New", 3), session("mid", "Mid", 2)];

    expect(selectSessionHistory(source, "").map((entry) => entry.id)).toEqual(["new", "mid", "old"]);
    expect(source.map((entry) => entry.id)).toEqual(["old", "new", "mid"]);
  });

  it("searches titles as the user types, ignoring case and surrounding whitespace", () => {
    const source = [
      session("one", "Restart the web container", 1),
      session("two", "Inspect production volumes", 3),
      session("three", "Container cleanup", 2),
    ];

    expect(selectSessionHistory(source, "  CONTAIN ").map((entry) => entry.id)).toEqual(["three", "one"]);
  });

  it("uses the id as a deterministic tie-breaker", () => {
    const source = [session("z", "Last", 2), session("a", "First", 2)];

    expect(selectSessionHistory(source, "").map((entry) => entry.id)).toEqual(["a", "z"]);
  });
});

describe("Session history keyboard selection", () => {
  const sessions = [session("new", "Newest", 3), session("mid", "Middle", 2), session("old", "Oldest", 1)];

  it("preserves a highlighted row by identity and otherwise prefers the active Session", () => {
    expect(resolveSessionHistoryHighlight(sessions, "mid", "new")).toBe("mid");
    expect(resolveSessionHistoryHighlight(sessions, "filtered-out", "new")).toBe("new");
    expect(resolveSessionHistoryHighlight(sessions, undefined, "filtered-out")).toBe("new");
    expect(resolveSessionHistoryHighlight([], "mid", "new")).toBeUndefined();
  });

  it("moves and wraps one full-row highlight without relying on browser scrolling", () => {
    expect(moveSessionHistoryHighlight(sessions, "new", 1)).toBe("mid");
    expect(moveSessionHistoryHighlight(sessions, "new", -1)).toBe("old");
    expect(moveSessionHistoryHighlight(sessions, "mid", 5)).toBe("new");
    expect(moveSessionHistoryHighlight(sessions, undefined, 1)).toBe("new");
  });
});

describe("resolveSessionReference", () => {
  const sessions = [
    session("session-1", "Inspect volumes", 3),
    session("session-2", "Restart containers", 2),
    session("session-3", "Restart containers", 1),
  ];

  it("prefers an exact id, then a unique case-insensitive title", () => {
    expect(resolveSessionReference(sessions, "session-1")).toEqual({ kind: "resolved", session: sessions[0] });
    expect(resolveSessionReference(sessions, "INSPECT VOLUMES")).toEqual({ kind: "resolved", session: sessions[0] });
  });

  it("does not guess when a title is ambiguous or absent", () => {
    expect(resolveSessionReference(sessions, "Restart containers")).toEqual({ kind: "ambiguous" });
    expect(resolveSessionReference(sessions, "Restart")).toEqual({ kind: "not-found" });
  });
});
