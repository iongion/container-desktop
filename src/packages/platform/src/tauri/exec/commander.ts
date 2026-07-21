import type { CommandExecutionResult } from "@/host-contract/exec";
// The Tauri-side process primitives — ExecuteStreaming / ExecuteAsBackgroundService / Spawn / Kill — backed
// by the Rust process commands (src-tauri/src/process.rs). Two distinct emitter shapes (do NOT conflate):
//   - ExecuteStreaming → a StreamHandle { on, off, dispose, kill } (contract.ts:49) over a fresh eventemitter3.
//   - ExecuteAsBackgroundService → a bare { on } emitter; the readiness/retry loop runs HERE (opts.checkStatus
//     is a JS ProxyRequest ping — it cannot move to Rust), Rust only spawns/streams/kills.
// Kill routes to Rust by a processId token stamped onto the wrap_process child, so BOTH Command.Kill(child)
// and a direct child.kill() (services.ts) terminate the Rust-owned process. Mirrors commander.ts exactly,
// but channel-driven + node-free (portable into the webview bundle). invoke + Channel are injected → testable.

import { EventEmitter } from "eventemitter3";

import type { StreamHandle } from "@/platform/contract";
import { superviseReadiness } from "@/platform/readinessLoop";
import { applyProcessEvent, type CommandDeps, killProcess, processSpawnPayload, wrap_process } from "./process-utils";

export {
  applyProcessEvent,
  type CommandDeps,
  killProcess,
  type ProcessChannel,
  type ProcessEventMessage,
  wrap_process,
} from "./process-utils";

export async function exec_launcher_async(
  deps: CommandDeps,
  launcher: string,
  args: string[],
  opts?: any,
): Promise<CommandExecutionResult> {
  const payload: Record<string, unknown> = {
    launcher,
    args: args ?? [],
    cwd: opts?.cwd,
    env: opts?.env,
  };
  if (opts?.isolate !== undefined) {
    payload.isolate = opts.isolate;
  }
  if (opts?.timeout !== undefined) {
    payload.timeoutMs = opts.timeout;
  }
  // Secret-bearing stdin (registry `login --password-stdin`, `cat > ca.crt`) — piped to the child by the Rust
  // side (host.rs), never placed in argv or logged.
  if (opts?.input !== undefined) {
    payload.input = opts.input;
  }
  return deps.invoke("command_execute", payload);
}

export async function exec_launcher(
  deps: CommandDeps,
  launcher: string,
  args: string[],
  opts?: any,
): Promise<CommandExecutionResult> {
  return exec_launcher_async(deps, launcher, args, opts);
}

// ExecuteStreaming — a finite streamed process (build/logs -f). Returns a StreamHandle.
export async function exec_streaming(
  deps: CommandDeps,
  launcher: string,
  args: string[],
  opts?: any,
): Promise<StreamHandle> {
  const emitter = new EventEmitter();
  const channel = deps.newChannel();
  channel.onmessage = (message) => applyProcessEvent(emitter, message);
  const { processId, pid } = await deps.invoke("process_spawn", {
    payload: processSpawnPayload(launcher, args, opts),
    channel,
  });
  if (opts?.onSpawn) {
    opts.onSpawn(wrap_process(deps, { pid, code: null, success: false, stdout: "", stderr: "" }, processId));
  }
  return {
    on: (event, listener) => {
      emitter.on(event, listener);
    },
    off: (event, listener) => {
      emitter.off(event, listener);
    },
    dispose: () => emitter.removeAllListeners(),
    kill: (signal) => {
      void killProcess(deps, { __processId: processId }, signal);
    },
  };
}

// ExecuteAsBackgroundService — spawn a long-lived service, poll opts.checkStatus until ready. Returns { on }.
export async function exec_service(
  deps: CommandDeps,
  launcher: string,
  args: string[],
  opts?: any,
): Promise<{ on: (event: string, listener: (...args: any[]) => void, context?: any) => void }> {
  const emitter = new EventEmitter();
  const service = {
    on: (event: string, listener: (...args: any[]) => void, context?: any) => {
      emitter.on(event, listener, context);
    },
  };

  // Pre-check: already running? → reuse, no spawn (emit ready on a macrotask so listeners attach first).
  const alreadyRunning = opts?.checkStatus ? await opts.checkStatus({ pid: null, started: false }) : false;
  if (alreadyRunning) {
    const proc = { pid: null, code: null, success: true, stdout: "", stderr: "" };
    if (opts?.onSpawn) {
      opts.onSpawn(wrap_process(deps, proc, undefined));
    }
    setTimeout(() => emitter.emit("ready", wrap_process(deps, proc, undefined)), 0);
    return service;
  }

  const channel = deps.newChannel();
  channel.onmessage = (message) => applyProcessEvent(emitter, message);
  const { processId, pid } = await deps.invoke("process_spawn", {
    payload: processSpawnPayload(launcher, args, opts),
    channel,
  });
  const proc = { pid, code: null, success: false, stdout: "", stderr: "" };
  if (opts?.onSpawn) {
    opts.onSpawn(wrap_process(deps, proc, processId));
  }

  superviseReadiness(
    { pid, retry: opts?.retry },
    {
      checkStatus: opts?.checkStatus,
      onStatusCheck: (status) => {
        emitter.emit("status.check", status);
        opts?.onStatusCheck?.(status);
      },
      onProbeError: () => undefined,
      onReady: () => {
        proc.success = true;
        emitter.emit("ready", wrap_process(deps, proc, processId));
      },
      onError: (error) => emitter.emit("error", error),
    },
  );

  return service;
}

// Spawn — spawnSync-shaped { status, stdout, stderr, pid } (detector.ts reads .status). Buffered exec.
export async function spawn_sync(deps: CommandDeps, launcher: string, args: string[], opts?: any): Promise<any> {
  const result = await exec_launcher_async(deps, launcher, args, opts);
  return {
    status: result?.code ?? null,
    stdout: result?.stdout ?? "",
    stderr: result?.stderr ?? "",
    pid: result?.pid,
  };
}
