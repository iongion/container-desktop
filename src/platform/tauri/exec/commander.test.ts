import { EventEmitter } from "eventemitter3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyProcessEvent, exec_service, exec_streaming, killProcess, spawn_sync } from "./commander";

const noChannel = () => ({ onmessage: null });

describe("applyProcessEvent", () => {
  it("maps each Rust process event to the commander.ts payload shape", () => {
    const emitter = new EventEmitter();
    const seen: any[] = [];
    emitter.on("data", (p) => seen.push(["data", p]));
    emitter.on("exit", (p) => seen.push(["exit", p]));
    emitter.on("close", (p) => seen.push(["close", p]));
    emitter.on("error", (p) => seen.push(["error", p]));
    applyProcessEvent(emitter, { type: "data", from: "stderr", data: "x" });
    applyProcessEvent(emitter, { type: "exit", code: 1, signal: "SIGTERM" });
    applyProcessEvent(emitter, { type: "close", code: 1 });
    applyProcessEvent(emitter, { type: "error", errorType: "process.error", error: "boom" });
    expect(seen).toEqual([
      ["data", { from: "stderr", data: "x" }],
      ["exit", { code: 1, signal: "SIGTERM" }],
      ["close", { code: 1 }],
      ["error", { type: "process.error", error: "boom" }],
    ]);
  });
});

describe("exec_streaming (ExecuteStreaming)", () => {
  it("spawns, maps channel events to StreamHandle events, and routes kill/dispose", async () => {
    let channel: any;
    const invoke = vi.fn(async (cmd: string, _args?: any) =>
      cmd === "process_spawn" ? { processId: "proc-9", pid: 7 } : undefined,
    );
    const newChannel = () => {
      channel = { onmessage: null };
      return channel;
    };
    const onSpawn: any[] = [];
    const handle = await exec_streaming({ invoke, newChannel }, "podman", ["build", "."], {
      cwd: "/tmp",
      onSpawn: (w: any) => onSpawn.push(w),
    });
    expect(onSpawn[0].child.__processId).toBe("proc-9");
    expect(onSpawn[0].child.pid).toBe(7);
    expect(invoke.mock.calls[0][1].payload).toMatchObject({ launcher: "podman", args: ["build", "."], cwd: "/tmp" });
    expect(invoke.mock.calls[0][1].channel).toBe(channel);

    const data: any[] = [];
    let exitCode: any;
    handle.on("data", (p: any) => data.push(p));
    handle.on("exit", (p: any) => {
      exitCode = p.code;
    });
    channel.onmessage({ processId: "proc-9", type: "data", from: "stdout", data: "Step 1/3" });
    channel.onmessage({ processId: "proc-9", type: "exit", code: 0 });
    expect(data).toEqual([{ from: "stdout", data: "Step 1/3" }]);
    expect(exitCode).toBe(0);

    handle.kill("SIGTERM");
    expect(invoke).toHaveBeenCalledWith("process_kill", { payload: { processId: "proc-9", signal: "SIGTERM" } });

    handle.dispose();
    channel.onmessage({ processId: "proc-9", type: "data", from: "stdout", data: "late" });
    expect(data).toHaveLength(1); // nothing delivered after dispose
  });
});

describe("exec_service (ExecuteAsBackgroundService)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits ready WITHOUT spawning when checkStatus reports already-running", async () => {
    vi.useFakeTimers();
    const invoke = vi.fn(async () => {
      throw new Error("must not spawn when already running");
    });
    const checkStatus = vi.fn(async () => true);
    const service = await exec_service({ invoke, newChannel: noChannel }, "podman", ["system", "service"], {
      checkStatus,
    });
    const ready: any[] = [];
    service.on("ready", (p) => ready.push(p));
    await vi.advanceTimersByTimeAsync(0); // fire the setTimeout(0)
    expect(ready).toHaveLength(1);
    expect(ready[0].process.success).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("spawns then emits ready once a retry's checkStatus passes", async () => {
    vi.useFakeTimers();
    let started = 0;
    const checkStatus = vi.fn(async ({ started: hasStarted }: any) => {
      if (!hasStarted) return false; // pre-check: not running
      started += 1;
      return started >= 2; // ready on the 2nd probe
    });
    const invoke = vi.fn(async (cmd: string) =>
      cmd === "process_spawn" ? { processId: "proc-1", pid: 4242 } : undefined,
    );
    const service = await exec_service({ invoke, newChannel: noChannel }, "podman", ["system", "service"], {
      checkStatus,
      retry: { count: 5, wait: 1000 },
    });
    const ready: any[] = [];
    service.on("ready", (p) => ready.push(p));
    await vi.advanceTimersByTimeAsync(1000); // probe 1 → false
    expect(ready).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000); // probe 2 → true
    expect(ready).toHaveLength(1);
    expect(ready[0].child.pid).toBe(4242);
    expect(ready[0].child.__processId).toBe("proc-1");
    expect(ready[0].process.success).toBe(true);
  });

  it("emits a domain.max-retries error after exhausting retries", async () => {
    vi.useFakeTimers();
    const checkStatus = vi.fn(async () => false);
    const onStatusCheck = vi.fn();
    const invoke = vi.fn(async (cmd: string) =>
      cmd === "process_spawn" ? { processId: "proc-1", pid: 1 } : undefined,
    );
    const service = await exec_service({ invoke, newChannel: noChannel }, "x", [], {
      checkStatus,
      onStatusCheck,
      retry: { count: 2, wait: 1000 },
    });
    const errors: any[] = [];
    service.on("error", (e) => errors.push(e));
    await vi.advanceTimersByTimeAsync(3000); // 2 probes then the retries===0 tick
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe("domain.max-retries");
    expect(onStatusCheck).toHaveBeenCalledTimes(2);
  });
});

describe("spawn_sync (Spawn) + killProcess (Kill)", () => {
  it("spawn_sync returns a spawnSync-shaped result (status, not code)", async () => {
    const invoke = vi.fn(async () => ({ pid: 5, code: 0, success: true, stdout: "out", stderr: "" }));
    const result = await spawn_sync({ invoke, newChannel: noChannel }, "pwsh", ["-c", "x"], { env: { A: "1" } });
    expect(result).toEqual({ status: 0, stdout: "out", stderr: "", pid: 5 });
    expect(invoke).toHaveBeenCalledWith("command_execute", {
      launcher: "pwsh",
      args: ["-c", "x"],
      cwd: undefined,
      env: { A: "1" },
    });
  });

  it("killProcess delegates to the child's processId-stamped kill", async () => {
    const invoke = vi.fn(async (_cmd: string, _args?: any) => undefined);
    const child = {
      __processId: "proc-3",
      kill: async () => {
        await invoke("process_kill", { payload: { processId: "proc-3", signal: undefined } });
      },
    };
    await killProcess({ invoke, newChannel: noChannel }, child);
    expect(invoke).toHaveBeenCalledWith("process_kill", { payload: { processId: "proc-3", signal: undefined } });
  });
});
