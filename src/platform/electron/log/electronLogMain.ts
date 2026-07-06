// Electron MAIN logging adapter (one LoggerBackend behind the @/platform/logger port). It owns the single LOCAL
// log file + size-based rotation via electron-log, and — through log.initialize() — receives the records
// the renderer forwards. Console output stays with the @/platform/logger façade; this adapter handles FILE only.
//
// LOCAL-ONLY: no remote/cloud transport is ever configured — the file transport is the only sink. Do not
// add one.
//
// Only the Electron main composition root imports this module, so electron-log/main never leaks into the
// renderer bundle. A future Tauri shell provides its own adapter behind the same port. The pure rotation
// policy lives in ./rotation (so it is unit-testable without Electron).

import fs from "node:fs";
import path from "node:path";
import { app, shell } from "electron";
import log from "electron-log/main";

import type { LoggingFileSettings } from "@/env/Types";
import type { LoggerBackend } from "@/platform/logger";
import { rotateArchives } from "./rotation";

// Result of a log-file action — lets the renderer toast when the file is missing/inaccessible instead of
// silently failing (and without the logging system logging about itself into its own sink).
export interface LogFileActionResult {
  ok: boolean;
  reason?: "missing" | "error";
  detail?: string;
}

const LOG_DIR = "logs";
const LOG_FILE_NAME = "container-desktop.log";

export function getLogFilePath(): string {
  return path.join(app.getPath("userData"), LOG_DIR, LOG_FILE_NAME);
}

let initialized = false;
const scopes = new Map<string, any>();

function scoped(scope: string): any {
  let instance = scopes.get(scope);
  if (!instance) {
    instance = log.scope(scope);
    scopes.set(scope, instance);
  }
  return instance;
}

// Wire electron-log for main: install the renderer→main bridge, pin the file path/format, harden
// local-only. Must run before the first BrowserWindow so renderer forwarding is in place. Idempotent.
export function setupElectronLogMain(): void {
  if (initialized) {
    return;
  }
  initialized = true;
  log.initialize();
  // LOCAL-ONLY: never a remote/cloud sink. Console stays with the @/platform/logger façade, and main does not echo
  // its logs into the renderer dev tools — the file transport is the only sink electron-log drives here.
  log.transports.remote.level = false;
  log.transports.console.level = false;
  log.transports.ipc.level = false;
  log.transports.file.resolvePathFn = () => getLogFilePath();
  log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [{scope}] {text}";
  // Off until the user opts in (applyElectronLogFileConfig).
  log.transports.file.level = false;
}

// Apply the user's file-logging policy. The façade pre-gates by level, so the file persists exactly what
// it forwards — we only flip the transport on/off and set the size/rotation bounds.
export function applyElectronLogFileConfig(file: LoggingFileSettings): void {
  setupElectronLogMain();
  const maxFiles = Math.max(1, file.maxFiles);
  log.transports.file.maxSize = Math.max(1, file.maxSizeMb) * 1024 * 1024;
  log.transports.file.archiveLogFn = (oldLogFile) => rotateArchives(oldLogFile.path, maxFiles);
  log.transports.file.level = file.enabled ? "silly" : false;
}

function logFileExists(): boolean {
  try {
    return fs.existsSync(getLogFilePath());
  } catch {
    return false;
  }
}

// reason "missing" is NORMAL (the file is only created on the first write) — the UI treats it as info, not
// an error. reason "error" means it exists but could not be opened/accessed — that is a real error.
export async function openLogFile(): Promise<LogFileActionResult> {
  if (!logFileExists()) {
    return { ok: false, reason: "missing" };
  }
  // shell.openPath resolves with "" on success or an error string on failure (it does not reject).
  const detail = await shell.openPath(getLogFilePath());
  return detail ? { ok: false, reason: "error", detail } : { ok: true };
}

export async function revealLogFile(): Promise<LogFileActionResult> {
  if (!logFileExists()) {
    return { ok: false, reason: "missing" };
  }
  shell.showItemInFolder(getLogFilePath());
  return { ok: true };
}

// The persistence sink the @/platform/logger façade calls in MAIN. Console stays with the façade; this only routes
// records to electron-log's FILE transport (a no-op until the user enables file logging).
export const electronLogMainBackend: LoggerBackend = {
  write(level, scope, args) {
    setupElectronLogMain();
    scoped(scope)[level](...args);
  },
};
