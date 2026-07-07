import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "eventemitter3";
import type { CommandExecutionResult, ServiceOpts } from "@/env/Types";
import { Platform } from "@/platform/electron/host";
import { createLogger } from "@/platform/logger";
import { getEngineProxyEnv } from "@/platform/proxy-env-policy";
import { superviseReadiness } from "@/platform/readinessLoop";
import { deepMerge } from "@/utils";
import { killProcess, type WrapperOpts } from "./process-utils";

const logger = createLogger("platform.exec");

// Commander
export function applyWrapper(launcher: string, args: string[], opts?: WrapperOpts) {
  let commandLauncher = launcher;
  let commandArgs = args || [];
  if (opts?.wrapper) {
    commandLauncher = opts.wrapper.launcher;
    commandArgs = [...opts.wrapper.args, launcher, ...args];
  }
  return { commandLauncher, commandArgs };
}

function buildSpawnEnv(opts?: { env?: any; proxyEnv?: boolean; isolate?: boolean }): NodeJS.ProcessEnv | undefined {
  // Isolated exec: a WHOLESALE env — exactly opts.env, never process.env or the proxy creds. Returning a concrete
  // object (even {}) is load-bearing: `spawn` with env:undefined INHERITS process.env, which is what isolation
  // must prevent.
  if (opts?.isolate) {
    return { ...(opts.env || {}) };
  }
  const proxyEnv = opts?.proxyEnv ? getEngineProxyEnv() : {};
  if (!opts?.env && Object.keys(proxyEnv).length === 0) {
    return undefined;
  }
  return deepMerge({}, process.env, proxyEnv, opts?.env || {});
}

// Spawn env values are NEVER logged: they contain the full process.env plus (for engine spawns) the
// proxy URL with credentials, and may hold other secrets. Log only the env variable NAMES. Exported for test.
export function logSafeOpts<T>(opts: T): T {
  const value = opts as any;
  if (value && typeof value === "object" && value.env && typeof value.env === "object") {
    return { ...value, env: Object.keys(value.env) } as T;
  }
  return opts;
}

export async function wrapSpawnAsync(launcher: string, launcherArgs: string[], launcherOpts?: Partial<WrapperOpts>) {
  let spawnLauncher = "";
  let spawnArgs: string[] = [];
  let spawnOpts: any;
  if (await Platform.isFlatpak()) {
    const hostLauncher = "flatpak-spawn";
    const hostArgs = [
      "--host",
      // remove flatpak container VFS prefix when executing
      launcher.replace("/var/run/host", ""),
      ...launcherArgs,
    ];
    spawnLauncher = hostLauncher;
    spawnArgs = hostArgs;
    spawnOpts = launcherOpts;
  } else {
    spawnLauncher = launcher;
    spawnArgs = launcherArgs;
    spawnOpts = launcherOpts;
  }
  const spawnLauncherOpts: WrapperOpts = {
    encoding: "utf-8",
    ...(spawnOpts || {}),
  };
  const command = [spawnLauncher, ...spawnArgs].join(" ");
  if (!spawnLauncher) {
    logger.error("[SC.A][>]", command, {
      spawnLauncher,
      spawnArgs,
      spawnLauncherOpts: logSafeOpts(spawnLauncherOpts),
    });
    throw new Error("Launcher path must be set");
  }
  if (typeof spawnLauncher !== "string") {
    logger.error("[SC.A][>]", command, {
      spawnLauncher,
      spawnArgs,
      spawnLauncherOpts: logSafeOpts(spawnLauncherOpts),
    });
    throw new Error("Launcher path has invalid type");
  }
  logger.debug("[SC.A][>][spawn]", {
    command: spawnLauncher,
    args: spawnArgs,
    opts: logSafeOpts(spawnLauncherOpts),
    commandLine: command,
  });
  const child = spawn(spawnLauncher, spawnArgs, spawnLauncherOpts);
  // store for tracing and debugging
  (child as any).command = command;
  return child;
}

export async function exec_launcher_async(launcher: string, launcherArgs: string[], opts?: WrapperOpts) {
  const timeoutMs = typeof opts?.timeout === "number" && opts.timeout > 0 ? opts.timeout : undefined;
  const maxCollect =
    typeof opts?.maxCollectBytes === "number" && opts.maxCollectBytes > 0 ? opts.maxCollectBytes : undefined;
  const spawnOpts: any = {
    encoding: "utf-8", // TODO: not working for spawn - find alternative
    cwd: opts?.cwd,
    env: buildSpawnEnv(opts),
    detached: opts?.detached,
    stdio: opts?.detached ? "ignore" : undefined,
  };
  const { commandLauncher, commandArgs } = applyWrapper(launcher, launcherArgs, opts);
  return new Promise<CommandExecutionResult>((resolve, reject) => {
    let resolved = false;
    return wrapSpawnAsync(commandLauncher, commandArgs, spawnOpts)
      .then((child) => {
        //
        const result: CommandExecutionResult = {
          pid: undefined,
          code: undefined,
          success: false,
          stdout: "",
          stderr: "",
          command: "", // Decorated by child process
        };
        const command = (child as any).command;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const processResolve = (from: string, data: any) => {
          if (resolved) {
            return;
          }
          if (timeout) {
            clearTimeout(timeout);
          }
          result.pid = child.pid as any;
          result.code = from === "spawn" ? 0 : from === "timeout" ? null : (data as any);
          result.stderr = result.stderr || "";
          result.success = from === "spawn" ? true : from === "exit" && data === 0;
          result.command = command;
          resolved = true;
          logger.debug("[SC.A][<]", {
            pid: result.pid,
            code: result.code,
            success: result.success,
            command,
          });
          resolve(result);
        };
        if (timeoutMs) {
          timeout = setTimeout(() => {
            result.stderr = `${result.stderr || ""}${result.stderr ? "\n" : ""}Command timed out after ${timeoutMs}ms`;
            try {
              child.kill("SIGTERM");
            } catch (error: any) {
              logger.warn(command, "timeout kill failed", error?.message ?? error);
            }
            processResolve("timeout", null);
          }, timeoutMs);
          timeout.unref?.();
        }
        if (spawnOpts.detached) {
          child.on("spawn", () => {
            child.unref();
            processResolve("spawn", 0);
          });
        } else {
          child.on("exit", (code) => processResolve("exit", code));
        }
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        // child.on("close", (code) => processResolve("close", code));
        child.on("error", (error) => {
          logger.error(command, "spawning error", error.message);
          (result as any).error = error;
          processResolve("error", error);
        });
        // Pipe secret-bearing stdin (e.g. `login --password-stdin`, `cat > ca.crt`) to the child, then EOF so the
        // program stops reading. Non-detached only — the detached path spawns with stdio:"ignore" (no stdin
        // stream). Any write error surfaces via the "error" handler above. The secret never touches argv or logs.
        if (typeof opts?.input === "string" && !spawnOpts.detached) {
          try {
            child.stdin?.end(opts.input);
          } catch (error: any) {
            logger.error(command, "stdin write failed", error?.message ?? error);
          }
        }
        child.stdout?.on("data", (data) => {
          // maxCollect (sandbox only) caps in-flight output so a runaway child can't exhaust memory; over the cap
          // we terminate + resolve. Engine execs pass no cap, so this is a no-op for them (unbounded, as before).
          if (maxCollect !== undefined && (result.stdout || "").length >= maxCollect) {
            if (!resolved) {
              result.stderr = `${result.stderr || ""}${result.stderr ? "\n" : ""}output exceeded the ${maxCollect}-byte collection cap`;
              try {
                child.kill("SIGTERM");
              } catch (error: any) {
                logger.warn(command, "cap kill failed", error?.message ?? error);
              }
              processResolve("timeout", null);
            }
            return;
          }
          result.stdout += `${data}`;
        });
        child.stderr?.on("data", (data) => {
          if (maxCollect !== undefined && (result.stderr || "").length >= maxCollect) {
            return;
          }
          result.stderr += `${data}`;
        });
      })
      .catch(reject);
  });
}

export async function exec_launcher(launcher: string, launcherArgs: string[], opts?: WrapperOpts) {
  return await exec_launcher_async(launcher, launcherArgs, opts);
}

export function wrap_process(proc: any, child: any) {
  return {
    process: proc,
    child: {
      code: proc.code,
      success: proc.success,
      pid: proc.pid,
      kill: async (signal?: NodeJS.Signals | number) => {
        logger.debug("(OS) Killing child process started", proc.pid, {
          signal,
        });
        if (child) {
          killProcess(child, signal);
        } else {
          logger.warn("(OS) Killing child process skipped - child not started here", proc.pid);
        }
        logger.debug("(OS) Killing child process completed", proc.pid, {
          child,
        });
      },
      unref: () => {
        logger.debug("(OS) Unref child process started", proc.pid);
        try {
          if (child) {
            child.unref();
          } else {
            logger.warn("(OS) Unref child process skipped - child not started here", proc.pid);
          }
        } catch (error: any) {
          logger.error("(OS) Unref child process failed", error);
        }
        logger.debug("(OS) Unref child process completed", proc.pid);
      },
    },
  };
}

// Finite streamed execution. Unlike exec_service (a readiness/retry loop that emits "domain.max-retries"
// when a long-lived service never reports ready), this spawns a process expected to RUN TO COMPLETION —
// e.g. an image build — and forwards its raw stdout/stderr chunks and exit as they happen. No checkStatus,
// no retry timer. The returned StreamHandle owns detach (off), teardown (dispose) and kill.
export async function exec_streaming(
  programPath: string,
  programArgs: string[],
  opts?: Partial<ServiceOpts>,
): Promise<StreamHandle> {
  const em = new EventEmitter();
  const launcherOpts = {
    encoding: "utf-8",
    cwd: opts?.cwd,
    env: buildSpawnEnv(opts),
  };
  const { commandLauncher, commandArgs } = applyWrapper(programPath, programArgs, opts as any);
  const child = await wrapSpawnAsync(commandLauncher, commandArgs, launcherOpts);
  const proc: CommandExecutionResult = { pid: child.pid!, code: null, success: false, stdout: "", stderr: "" };
  if (opts?.onSpawn) {
    opts.onSpawn(wrap_process(proc, child));
  }
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (data) => em.emit("data", { from: "stdout", data: `${data}` }));
  child.stderr?.on("data", (data) => em.emit("data", { from: "stderr", data: `${data}` }));
  child.on("error", (error) => em.emit("error", { type: "process.error", error }));
  child.on("close", (code) => em.emit("close", { code }));
  child.on("exit", (code, signal) => em.emit("exit", { code, signal }));
  return {
    on: (event, listener) => em.on(event, listener),
    off: (event, listener) => em.off(event, listener),
    dispose: () => em.removeAllListeners(),
    kill: (signal) => killProcess(child, signal),
  };
}

export async function exec_service(programPath: string, programArgs: string[], opts?: Partial<ServiceOpts>) {
  let isManagedExit = false;
  let child: ChildProcessWithoutNullStreams | undefined;
  const proc: CommandExecutionResult = {
    pid: null,
    code: null,
    success: false,
    stdout: "",
    stderr: "",
  };
  const em = new EventEmitter();
  // Check
  const running = opts?.checkStatus ? await opts.checkStatus({ pid: null, started: false }) : false;
  if (running) {
    logger.debug("Already running - reusing");
    proc.success = true;
    if (opts?.onSpawn) {
      opts?.onSpawn(wrap_process(proc, child));
    }
    setTimeout(() => em.emit("ready", wrap_process(proc, child)), 0);
  } else {
    // Handle
    const onProcessError = (_child: ChildProcessWithoutNullStreams | undefined, error: any) => {
      logger.error("Child process error", error.code, error.message);
      em.emit("error", { type: "process.error", code: error.code });
    };
    const onProcessExit = (_child: ChildProcessWithoutNullStreams | undefined, code: number | null) => {
      em.emit("exit", { code, managed: isManagedExit });
      isManagedExit = false;
    };
    const onProcessClose = (_child: ChildProcessWithoutNullStreams | undefined, code: number | null) => {
      em.emit("close", { code });
    };
    const onProcessData = (child: ChildProcessWithoutNullStreams | undefined, from: string, data: any) => {
      if (from !== "stdout") {
        if (from === "stderr") {
          logger.warn("Child process data", child?.pid, from, data);
        } else {
          logger.debug("Child process data", child?.pid, from, data);
        }
      }
      em.emit("data", { from, data });
    };
    const waitForProcess = (child: ChildProcessWithoutNullStreams) =>
      superviseReadiness(
        { pid: child.pid ?? null, retry: opts?.retry },
        {
          checkStatus: opts?.checkStatus,
          onStatusCheck: (status) => {
            logger.debug("Remaining", status.retries, "of", status.maxRetries);
            logger.debug("Checking status", { pid: child.pid });
            em.emit("status.check", status);
            opts?.onStatusCheck?.(status);
          },
          onPendingSkip: () => logger.debug("Waiting for result of last retry - skipping new retry"),
          onProbeError: (error: any) => logger.error("Checked status - failed", error.message),
          onReady: () => {
            logger.debug("Checked status", { running: true });
            isManagedExit = true;
            proc.success = true;
            em.emit("ready", wrap_process(proc, child));
          },
          onError: (error) => {
            logger.error("Max retries reached");
            em.emit("error", error);
          },
        },
      );
    // Starting spawn
    const launcherOpts = {
      encoding: "utf-8",
      cwd: opts?.cwd,
      env: buildSpawnEnv(opts),
    };
    child = await wrapSpawnAsync(programPath, programArgs, launcherOpts);
    proc.pid = child.pid!;
    proc.code = child.exitCode;
    if (opts?.onSpawn) {
      opts?.onSpawn(wrap_process(proc, child));
    }
    logger.debug("Child process spawned", child.pid, {
      programPath,
      programArgs,
      launcherOpts: logSafeOpts(launcherOpts),
    });
    child.on("exit", (code) => onProcessExit(child, code));
    child.on("close", (code) => onProcessClose(child, code));
    child.on("error", (error) => onProcessError(child, error));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data) => onProcessData(child, "stdout", data.toString()));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (data) => onProcessData(child, "stderr", data.toString()));
    if (typeof child.pid === "undefined") {
      proc.success = false;
      logger.error("Child process spawn failure", proc);
    } else {
      proc.success = !child.killed;
      logger.debug("Child process spawn success", proc);
      waitForProcess(child);
    }
  }
  return {
    on: (event: string, listener: (...args: any[]) => void, context?: any) => em.on(event, listener, context),
  };
}
