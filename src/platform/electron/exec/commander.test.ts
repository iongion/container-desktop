import { EventEmitter } from "eventemitter3";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  return { default: { spawn: spawnMock }, spawn: spawnMock };
});

vi.mock("@/platform/electron/host", async () => {
  const actual = await vi.importActual<typeof import("@/platform/electron/host")>("@/platform/electron/host");
  return { ...actual, Platform: { ...actual.Platform, isFlatpak: vi.fn(async () => false) } };
});

import { exec_service, logSafeOpts } from "./commander";

function fakeChild(pid = 4242) {
  const child = new EventEmitter() as any;
  const stdout = new EventEmitter() as any;
  const stderr = new EventEmitter() as any;
  stdout.setEncoding = vi.fn();
  stderr.setEncoding = vi.fn();
  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = { end: vi.fn(), destroy: vi.fn() };
  child.pid = pid;
  child.exitCode = null;
  child.killed = false;
  child.kill = vi.fn();
  child.unref = vi.fn();
  return child;
}

afterEach(() => {
  vi.useRealTimers();
  spawnMock.mockReset();
});

describe("commander logSafeOpts", () => {
  it("replaces spawn env VALUES with key names so proxy credentials never reach logs", () => {
    const safe = logSafeOpts({
      encoding: "utf-8",
      env: { PATH: "/usr/bin", HTTPS_PROXY: "socks5h://alice:secret@proxy.example.com:1080" },
    });

    expect(safe.env).toEqual(["PATH", "HTTPS_PROXY"]);
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("alice");
    expect(serialized).not.toContain("proxy.example.com");
  });

  it("leaves opts without an env untouched", () => {
    const opts = { encoding: "utf-8", cwd: "/tmp" };
    expect(logSafeOpts(opts)).toBe(opts);
    expect(logSafeOpts(undefined)).toBeUndefined();
  });
});

describe("exec_service", () => {
  it("emits ready without spawning when checkStatus reports an existing service", async () => {
    vi.useFakeTimers();
    const checkStatus = vi.fn(async () => true);
    const onSpawn = vi.fn();

    const service = await exec_service("podman", ["system", "service"], { checkStatus, onSpawn });
    const ready: any[] = [];
    service.on("ready", (payload: any) => ready.push(payload));

    await vi.advanceTimersByTimeAsync(0);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(checkStatus).toHaveBeenCalledWith({ pid: null, started: false });
    expect(onSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        process: expect.objectContaining({ pid: null, success: true }),
      }),
    );
    expect(ready).toHaveLength(1);
    expect(ready[0].process.success).toBe(true);
  });

  it("emits status checks and ready once a retry probe succeeds", async () => {
    vi.useFakeTimers();
    const child = fakeChild(1234);
    spawnMock.mockReturnValue(child);
    let startedChecks = 0;
    const checkStatus = vi.fn(async ({ started }: any) => {
      if (!started) {
        return false;
      }
      startedChecks += 1;
      return startedChecks >= 2;
    });
    const onStatusCheck = vi.fn();

    const service = await exec_service("podman", ["system", "service"], {
      checkStatus,
      onStatusCheck,
      retry: { count: 5, wait: 1000 },
    });
    const statusChecks: any[] = [];
    const ready: any[] = [];
    service.on("status.check", (payload: any) => statusChecks.push(payload));
    service.on("ready", (payload: any) => ready.push(payload));

    await vi.advanceTimersByTimeAsync(1000);
    expect(ready).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);

    expect(spawnMock).toHaveBeenCalledWith(
      "podman",
      ["system", "service"],
      expect.objectContaining({ encoding: "utf-8" }),
    );
    expect(statusChecks).toEqual([
      { retries: 4, maxRetries: 5 },
      { retries: 3, maxRetries: 5 },
    ]);
    expect(onStatusCheck).toHaveBeenCalledTimes(2);
    expect(ready).toHaveLength(1);
    expect(ready[0].child.pid).toBe(1234);
    expect(ready[0].process.success).toBe(true);
  });

  it("emits a domain.max-retries error after exhausting readiness probes", async () => {
    vi.useFakeTimers();
    spawnMock.mockReturnValue(fakeChild(7));
    const checkStatus = vi.fn(async () => false);
    const onStatusCheck = vi.fn();

    const service = await exec_service("x", [], {
      checkStatus,
      onStatusCheck,
      retry: { count: 2, wait: 1000 },
    });
    const errors: any[] = [];
    service.on("error", (error: any) => errors.push(error));

    await vi.advanceTimersByTimeAsync(3000);

    expect(onStatusCheck).toHaveBeenCalledTimes(2);
    expect(errors).toEqual([{ type: "domain.max-retries", code: undefined }]);
  });

  it("does not start another readiness probe while the previous one is pending", async () => {
    vi.useFakeTimers();
    spawnMock.mockReturnValue(fakeChild(9));
    let releaseFirstProbe: ((value: boolean) => void) | undefined;
    const checkStatus = vi.fn(({ started }: any) => {
      if (!started) {
        return Promise.resolve(false);
      }
      return new Promise<boolean>((resolve) => {
        releaseFirstProbe = resolve;
      });
    });

    const service = await exec_service("x", [], {
      checkStatus,
      retry: { count: 4, wait: 1000 },
    });
    const statusChecks: any[] = [];
    service.on("status.check", (payload: any) => statusChecks.push(payload));

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(statusChecks).toEqual([{ retries: 3, maxRetries: 4 }]);

    releaseFirstProbe?.(false);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    expect(statusChecks).toEqual([
      { retries: 3, maxRetries: 4 },
      { retries: 2, maxRetries: 4 },
    ]);
  });

  it("forwards child process data, error, exit, and close events", async () => {
    vi.useFakeTimers();
    const child = fakeChild(55);
    spawnMock.mockReturnValue(child);
    const service = await exec_service("x", [], { checkStatus: async () => false, retry: { count: 10, wait: 1000 } });
    const seen: any[] = [];
    service.on("data", (payload: any) => seen.push(["data", payload]));
    service.on("error", (payload: any) => seen.push(["error", payload]));
    service.on("exit", (payload: any) => seen.push(["exit", payload]));
    service.on("close", (payload: any) => seen.push(["close", payload]));

    child.stdout.emit("data", "out");
    child.stderr.emit("data", "err");
    child.emit("error", { code: "ENOENT", message: "missing" });
    child.emit("exit", 0);
    child.emit("close", 0);

    expect(seen).toEqual([
      ["data", { from: "stdout", data: "out" }],
      ["data", { from: "stderr", data: "err" }],
      ["error", { type: "process.error", code: "ENOENT" }],
      ["exit", { code: 0, managed: false }],
      ["close", { code: 0 }],
    ]);
  });
});
