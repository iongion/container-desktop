import type { EventEmitter } from "eventemitter3";
import { getEngineProxyEnv } from "@/platform/proxy-env-policy";

// The Go-side process event (src-wails/process.go ProcessEvent).
export interface ProcessEventMessage {
  processId?: string;
  type: "data" | "exit" | "close" | "error";
  from?: "stdout" | "stderr";
  data?: string;
  code?: number | null;
  signal?: string;
  errorType?: string;
  error?: string;
}

export interface ProcessChannel {
  onmessage: ((message: ProcessEventMessage) => void) | null;
}

export interface CommandDeps {
  invoke: (command: string, args: Record<string, unknown>) => Promise<any>;
  newChannel: () => ProcessChannel;
}

function processSpawnEnv(opts?: any): Record<string, string> | undefined {
  const proxyEnv = opts?.proxyEnv ? getEngineProxyEnv() : {};
  if (!opts?.env && Object.keys(proxyEnv).length === 0) {
    return undefined;
  }
  return { ...proxyEnv, ...(opts?.env ?? {}) };
}

// Go ProcessEvent -> the emitter events node/exec/commander.ts emits (payload shapes per contract.ts).
export function applyProcessEvent(emitter: EventEmitter, message: ProcessEventMessage): void {
  switch (message?.type) {
    case "data":
      emitter.emit("data", { from: message.from, data: message.data ?? "" });
      break;
    case "exit":
      emitter.emit("exit", { code: message.code ?? null, signal: message.signal });
      break;
    case "close":
      emitter.emit("close", { code: message.code ?? null });
      break;
    case "error":
      emitter.emit("error", { type: message.errorType ?? "process.error", error: message.error });
      break;
  }
}

export function processSpawnPayload(launcher: string, args: string[], opts?: any): Record<string, unknown> {
  return { launcher, args: args ?? [], cwd: opts?.cwd, env: processSpawnEnv(opts) };
}

function toSignal(signal: unknown): string | undefined {
  return signal == null ? undefined : String(signal);
}

async function killRustProcess(deps: CommandDeps, processId: string, signal?: unknown): Promise<void> {
  await deps.invoke("process_kill", { payload: { processId, signal: toSignal(signal) } }).catch(() => undefined);
}

// Mirrors node/exec/commander.ts wrap_process: the { process, child } shape onSpawn/ready hands to callers.
// The Wails child carries the Go processId so Command.Kill(child) and child.kill() route to process_kill.
export function wrap_process(deps: CommandDeps, proc: any, processId: string | undefined) {
  return {
    process: proc,
    child: {
      __processId: processId,
      code: proc.code,
      success: proc.success,
      pid: proc.pid,
      kill: async (signal?: unknown) => {
        if (processId) {
          await killRustProcess(deps, processId, signal);
        }
      },
      unref: () => undefined,
    },
  };
}

// Terminate a Go-owned process from a processId-stamped child, or delegate to a child kill function.
export async function killProcess(deps: CommandDeps, target: any, signal?: unknown): Promise<void> {
  if (target?.__processId) {
    await killRustProcess(deps, target.__processId, signal);
    return;
  }
  if (typeof target?.kill === "function") {
    await target.kill(signal);
  }
}
