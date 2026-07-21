import { describe, expect, it, vi } from "vitest";
import { createTauriExecuteIsolated } from "./executeIsolated";
import type { TauriInvoke } from "./invoke";

describe("createTauriExecuteIsolated", () => {
  it("maps onto command_execute with isolate=true and returns its result", async () => {
    const result = { pid: null, code: 0, success: true, stdout: "ok", stderr: "", command: "podman ps" };
    const invoke = vi.fn(async () => result);
    const exec = createTauriExecuteIsolated(invoke as unknown as TauriInvoke);

    const out = await exec("podman", ["ps"], { cwd: "/tmp/box", env: { PATH: "/usr/bin" }, timeout: 5000 });

    // The isolated exec is the ONE exec command with isolate=true — NOT a separate ai_sandbox_exec command.
    expect(invoke).toHaveBeenCalledWith("command_execute", {
      launcher: "podman",
      args: ["ps"],
      cwd: "/tmp/box",
      env: { PATH: "/usr/bin" },
      isolate: true,
      timeoutMs: 5000,
    });
    expect(out).toBe(result);
  });
});
