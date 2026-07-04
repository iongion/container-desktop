// Preload-side CLI activity capture. Runs in the Node-capable preload realm and wraps the
// Command object BEFORE it is exposed to the renderer, timing each CLI invocation and
// pushing plain, structured-cloneable entries to renderer subscribers over the
// contextBridge `ActivityBus`.
//
// Keep this CJS-safe: no ESM-only deps, no top-level await, no React/web-app imports — it
// is bundled into preload.cjs. Every emitted payload must be structured-cloneable
// (primitives / strings / string[] only) because it crosses the contextBridge.

type Subscriber = (entry: any) => void;

const subscribers = new Set<Subscriber>();
let enabled = true;

// Buffer entries emitted before the renderer subscribes (CLI runs during startup, before
// the notification store mounts) and replay them to the first subscriber.
const BUFFER_CAP = 500;
const buffer: any[] = [];

function emit(entry: any) {
  if (!enabled) {
    return;
  }
  if (subscribers.size === 0) {
    buffer.push(entry);
    if (buffer.length > BUFFER_CAP) {
      buffer.shift();
    }
    return;
  }
  for (const callback of subscribers) {
    try {
      callback(entry);
    } catch {
      // A dead/throwing renderer subscriber must never break command execution.
    }
  }
}

export const ActivityBus = {
  subscribe(callback: Subscriber) {
    if (buffer.length > 0) {
      for (const entry of buffer) {
        try {
          callback(entry);
        } catch {
          // ignore replay errors
        }
      }
      buffer.length = 0;
    }
    subscribers.add(callback);
    return () => {
      subscribers.delete(callback);
    };
  },
  setEnabled(value: boolean) {
    enabled = value;
  },
};

const MAX_PREVIEW = 4 * 1024;

function preview(value: any): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = typeof value === "string" ? value : `${value}`;
  if (!text) {
    return undefined;
  }
  return text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}… (${text.length} bytes)` : text;
}

function toCommandLine(launcher: string, args?: readonly string[]): string {
  return [launcher, ...(args || [])].map((part) => (/\s/.test(`${part}`) ? JSON.stringify(part) : `${part}`)).join(" ");
}

export function wrapCommandForActivity(command: ICommand): ICommand {
  const wrapResult = (invocation: "Execute" | "Spawn") => {
    const original = command[invocation].bind(command);
    return async (launcher: string, args: string[], opts?: any) => {
      const guid = crypto.randomUUID();
      const startedAt = Date.now();
      const commandLine = toCommandLine(launcher, args);
      emit({ guid, date: startedAt, phase: "pending", invocation, launcher, args: args || [], commandLine });
      try {
        const result: any = await original(launcher, args, opts);
        const exitCode = typeof result?.code === "number" ? result.code : (result?.status ?? null);
        const success = typeof result?.success === "boolean" ? result.success : exitCode === 0;
        emit({
          guid,
          date: Date.now(),
          phase: "settled",
          invocation,
          launcher,
          args: args || [],
          commandLine,
          status: success ? "ok" : "error",
          exitCode,
          durationMs: Date.now() - startedAt,
          stdoutPreview: preview(result?.stdout),
          stderrPreview: preview(result?.stderr),
        });
        return result;
      } catch (error: any) {
        emit({
          guid,
          date: Date.now(),
          phase: "settled",
          invocation,
          launcher,
          args: args || [],
          commandLine,
          status: "error",
          durationMs: Date.now() - startedAt,
          stderrPreview: preview(error?.message ?? error),
        });
        throw error;
      }
    };
  };

  const originalBackground = command.ExecuteAsBackgroundService.bind(command);
  const wrappedBackground = async (launcher: string, args: string[], opts?: any) => {
    const guid = crypto.randomUUID();
    const startedAt = Date.now();
    const commandLine = toCommandLine(launcher, args);
    const base = {
      guid,
      invocation: "ExecuteAsBackgroundService" as const,
      launcher,
      args: args || [],
      commandLine,
      background: true,
    };
    emit({ ...base, date: startedAt, phase: "pending" });
    const emitter: any = await originalBackground(launcher, args, opts);
    try {
      emitter?.on?.("ready", () =>
        emit({ ...base, date: Date.now(), phase: "settled", status: "ok", durationMs: Date.now() - startedAt }),
      );
      emitter?.on?.("error", (error: any) =>
        emit({
          ...base,
          date: Date.now(),
          phase: "settled",
          status: "error",
          durationMs: Date.now() - startedAt,
          stderrPreview: preview(error?.message ?? error),
        }),
      );
    } catch {
      // Some service emitters may not expose `on`; the pending entry still records the launch.
    }
    return emitter; // returned unwrapped to the caller — the EventEmitter never crosses the bus
  };

  const originalStreaming = command.ExecuteStreaming.bind(command);
  const wrappedStreaming = async (launcher: string, args: string[], opts?: any) => {
    const guid = crypto.randomUUID();
    const startedAt = Date.now();
    const commandLine = toCommandLine(launcher, args);
    const base = {
      guid,
      invocation: "ExecuteStreaming" as const,
      launcher,
      args: args || [],
      commandLine,
      background: true,
    };
    emit({ ...base, date: startedAt, phase: "pending" });
    const handle: any = await originalStreaming(launcher, args, opts);
    let settled = false;
    const settle = (extra: any) => {
      if (settled) {
        return;
      }
      settled = true;
      emit({ ...base, date: Date.now(), phase: "settled", durationMs: Date.now() - startedAt, ...extra });
    };
    try {
      handle?.on?.("exit", (payload: any) => {
        const code = typeof payload?.code === "number" ? payload.code : null;
        settle({ status: code === 0 ? "ok" : "error", exitCode: code });
      });
      handle?.on?.("error", (payload: any) =>
        settle({ status: "error", stderrPreview: preview(payload?.error?.message ?? payload?.error ?? payload) }),
      );
    } catch {
      // Some handles may not expose `on`; the pending entry still records the launch.
    }
    return handle; // returned unwrapped — the StreamHandle never crosses the bus
  };

  return {
    ...command,
    Execute: wrapResult("Execute"),
    Spawn: wrapResult("Spawn"),
    ExecuteAsBackgroundService: wrappedBackground,
    ExecuteStreaming: wrappedStreaming,
  };
}
