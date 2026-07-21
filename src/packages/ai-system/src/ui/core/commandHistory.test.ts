import { beforeEach, describe, expect, it } from "vitest";

import { MAX_COMMAND_HISTORY_ENTRIES } from "@/ai-system/core/limits";
import { clearCommandHistory, commandHistory, navigateHistory, pushCommand } from "./commandHistory";

describe("pushCommand", () => {
  beforeEach(() => clearCommandHistory());

  it("appends trimmed, non-empty, non-consecutive-duplicate entries", () => {
    pushCommand("  a  ");
    pushCommand("a"); // consecutive duplicate (trimmed) — ignored
    pushCommand("");
    pushCommand("   ");
    pushCommand("b");
    expect(commandHistory()).toEqual(["a", "b"]);
  });

  it("retains only the newest bounded entries", () => {
    for (let index = 0; index <= MAX_COMMAND_HISTORY_ENTRIES; index += 1) pushCommand(`command-${index}`);

    expect(commandHistory()).toHaveLength(MAX_COMMAND_HISTORY_ENTRIES);
    expect(commandHistory()[0]).toBe("command-1");
    expect(commandHistory().at(-1)).toBe(`command-${MAX_COMMAND_HISTORY_ENTRIES}`);
  });
});

describe("navigateHistory", () => {
  const h = ["one", "two", "three"];

  it("up from the live draft goes to the newest, then older, clamping at the oldest", () => {
    expect(navigateHistory(h, null, "up", "draft")).toEqual({ index: 2, value: "three" });
    expect(navigateHistory(h, 2, "up", "draft")).toEqual({ index: 1, value: "two" });
    expect(navigateHistory(h, 1, "up", "draft")).toEqual({ index: 0, value: "one" });
    expect(navigateHistory(h, 0, "up", "draft")).toEqual({ index: 0, value: "one" });
  });

  it("down moves toward newer and restores the live draft past the newest", () => {
    expect(navigateHistory(h, 0, "down", "draft")).toEqual({ index: 1, value: "two" });
    expect(navigateHistory(h, 2, "down", "draft")).toEqual({ index: null, value: "draft" });
    expect(navigateHistory(h, null, "down", "draft")).toEqual({ index: null, value: "draft" });
  });

  it("no-ops on empty history", () => {
    expect(navigateHistory([], null, "up", "d")).toEqual({ index: null, value: "d" });
    expect(navigateHistory([], null, "down", "d")).toEqual({ index: null, value: "d" });
  });
});
