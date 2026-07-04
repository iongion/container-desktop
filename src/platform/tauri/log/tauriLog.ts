// Tauri persistence backend for the @/platform/logger façade — the file transport the façade was missing
// under Tauri. The Electron shell has electronLogRenderer → main → rotating file; this is the symmetric Tauri
// seam: forward already level-gated records to @tauri-apps/plugin-log, whose Rust side (src-tauri/src/lib.rs)
// writes them to userData/logs/container-desktop.log — the SAME file logging_open / logging_reveal reveal.
//
// Console stays owned by the façade; this only ADDS the file sink (no remote/cloud sink). Only the Tauri boot
// branch (web-app/index.tsx) imports this module, so @tauri-apps/plugin-log never loads under Electron.

import { debug, error, info, warn } from "@tauri-apps/plugin-log";

import type { LoggerBackend, LoggerWriteLevel } from "@/platform/logger";
import { formatLogArgs } from "./logFormat";

const SINK: Record<LoggerWriteLevel, (message: string) => Promise<void>> = { debug, info, warn, error };

export const tauriLogBackend: LoggerBackend = {
  write(level, scope, args) {
    // Fire-and-forget: a file-write failure must never break the caller (the façade already wrote to console).
    void SINK[level](formatLogArgs(scope, args)).catch(() => undefined);
  },
};
