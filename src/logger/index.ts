import { userConfiguration } from "@/container-client/config";
import type { ILogger } from "@/env/Types";

type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const DEFAULT_LOG_LEVEL: LogLevel = "warn";
const LEVEL_WEIGHT: Record<LogLevel, number> = {
  silent: -1,
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const CONSOLE_METHOD: Record<Exclude<LogLevel, "silent">, "debug" | "info" | "warn" | "error"> = {
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
};

interface ManagedLogger extends ILogger {
  setLevel: (level: string) => void;
}

const loggers: ManagedLogger[] = [];

// Pluggable persistence backend (the Tauri seam)
// The façade ALWAYS writes to the console itself — identical behavior in every shell and in tests. A
// registered backend ADDS persistence for already level-gated records (e.g. the Electron electron-log
// adapter writes them to a rotating LOCAL file and forwards renderer records to main). A future Tauri
// shell registers its own adapter behind the SAME port, with no change to the call sites. Default =
// no-op (console only — exactly today's behavior). The backend NEVER sees a remote/cloud sink.
export type LoggerWriteLevel = Exclude<LogLevel, "silent">;

export interface LoggerBackend {
  write(level: LoggerWriteLevel, scope: string, args: any[]): void;
}

const noopBackend: LoggerBackend = { write() {} };
let activeBackend: LoggerBackend = noopBackend;

// Installed by a shell's composition root (Electron main / renderer bootstrap); passing null restores
// the console-only default (used by tests to stay hermetic).
export function registerLoggerBackend(backend: LoggerBackend | null | undefined): void {
  activeBackend = backend ?? noopBackend;
}

function getEnvironmentLogLevel(): string | undefined {
  // Main/preload: process.env — the live, shipped value.
  const fromProcess = (globalThis as any).process?.env?.CONTAINER_DESKTOP_LOG_LEVEL;
  if (fromProcess) {
    return fromProcess;
  }
  // Renderer (contextIsolation, no process): the preload bridge exposes the live main-process value, so the
  // level set at RUNTIME (e.g. CONTAINER_DESKTOP_LOG_LEVEL=debug ./app) takes effect without a rebuild.
  const fromBridge = (globalThis as any).CONTAINER_DESKTOP_LOG_LEVEL;
  if (fromBridge) {
    return fromBridge;
  }
  // Fallback: the vite build-time define (covers any logging before the preload bridge is installed).
  try {
    return (import.meta as any).env?.CONTAINER_DESKTOP_LOG_LEVEL;
  } catch {
    return undefined;
  }
}

export function normalizeLogLevel(level?: string): LogLevel {
  switch (`${level ?? ""}`.trim().toLowerCase()) {
    case "debug":
    case "trace":
      return "debug";
    case "info":
      return "info";
    case "warn":
    case "warning":
      return "warn";
    case "error":
      return "error";
    case "silent":
    case "none":
    case "off":
      return "silent";
    default:
      return DEFAULT_LOG_LEVEL;
  }
}

let currentLevel = normalizeLogLevel(getEnvironmentLogLevel());

function applyLevel(level?: string): LogLevel {
  currentLevel = normalizeLogLevel(level);
  for (const logger of loggers) {
    logger.setLevel(currentLevel);
  }
  return currentLevel;
}

class ScopedLogger implements ManagedLogger {
  private level = currentLevel;

  constructor(private readonly name: string) {}

  setLevel(level: string): void {
    this.level = normalizeLogLevel(level);
  }

  debug(...args: any[]): void {
    this.write("debug", args);
  }

  info(...args: any[]): void {
    this.write("info", args);
  }

  warn(...args: any[]): void {
    this.write("warn", args);
  }

  error(...args: any[]): void {
    this.write("error", args);
  }

  private write(level: Exclude<LogLevel, "silent">, args: any[]): void {
    if (LEVEL_WEIGHT[this.level] < LEVEL_WEIGHT[level]) {
      return;
    }
    const method = CONSOLE_METHOD[level];
    const target = console[method] ?? console.log;
    target.call(console, `[${this.name}]`, ...args);
    // Mirror the (already level-gated) record to the persistence backend, if a shell installed one.
    activeBackend.write(level, this.name, args);
  }
}

export function createLogger(name = "app"): ILogger {
  const logger = new ScopedLogger(name);
  loggers.push(logger);
  return logger;
}

export async function getLevel() {
  const environmentLevel = getEnvironmentLogLevel();
  if (environmentLevel) {
    return applyLevel(environmentLevel);
  }
  const logging = await userConfiguration.getKey<any>("logging");
  return applyLevel(logging?.level);
}

export async function setLevel(level) {
  const normalized = applyLevel(level);
  await userConfiguration.setKey("logging", { level: normalized });
  return normalized;
}

export function __setLoggerLevelForTests(level: string): void {
  applyLevel(level);
}
