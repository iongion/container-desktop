import { afterEach, describe, expect, it, vi } from "vitest";
import { setWailsLogSink, wailsLogBackend } from "./wailsLog";

// The Wails log backend forwards already level-gated records to the DI'd native file sink (the Go
// ShellService.LogWrite the bridge wires), formatted like the console line — and must never throw, so a missing
// or failing sink can't break a log call. Symmetric to tauri/log/tauriLog behaviour.

afterEach(() => setWailsLogSink(null));

describe("wailsLogBackend", () => {
  it("forwards formatted records (level + '[scope] ...args') to the injected sink", () => {
    const sink = vi.fn();
    setWailsLogSink(sink);
    wailsLogBackend.write("warn", "engine", ["hello", { a: 1 }]);
    expect(sink).toHaveBeenCalledWith("warn", '[engine] hello {"a":1}');
  });

  it("is a no-op (never throws) when no sink is wired — file sink absent, console still owned by the façade", () => {
    setWailsLogSink(null);
    expect(() => wailsLogBackend.write("info", "boot", ["x"])).not.toThrow();
  });

  it("swallows a throwing sink (logging must never break the caller)", () => {
    setWailsLogSink(() => {
      throw new Error("boom");
    });
    expect(() => wailsLogBackend.write("error", "s", ["y"])).not.toThrow();
  });
});
