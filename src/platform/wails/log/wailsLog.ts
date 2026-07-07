// Wails persistence backend for the @/platform/logger façade — the symmetric seam to tauri/log/tauriLog.ts
// (which forwards to @tauri-apps/plugin-log → the Rust file sink). Wails v3's @wailsio/runtime ships NO frontend
// log plugin, so records are forwarded to the Go ShellService.LogWrite, which appends them to
// userData/logs/container-desktop.log — the SAME file logging_open / logging_reveal reveal.
//
// The sink is INJECTED by the bridge (setWailsLogSink) rather than imported here, because bridge.ts is the single
// module allowed to import @wailsio/runtime (the one native seam). Until the bridge wires it — and if it is ever
// cleared — writes are dropped from the FILE only (the façade still owns the console), so a missing sink never
// breaks a caller. Console stays owned by the façade; this only ADDS the file sink. Only the Wails boot branch
// (web-app/index.tsx) imports this module.

import type { LoggerBackend, LoggerWriteLevel } from "@/platform/logger";
import { formatLogArgs } from "./logFormat";

type WailsLogSink = (level: LoggerWriteLevel, message: string) => void;

let sink: WailsLogSink | null = null;

/** Wire (or clear) the native file sink. Called by the bridge once the Wails invoke transport is up. */
export function setWailsLogSink(next: WailsLogSink | null): void {
  sink = next;
}

export const wailsLogBackend: LoggerBackend = {
  write(level, scope, args) {
    // Fire-and-forget and never throw: a file-write failure must not break the caller (the façade already wrote
    // to console). Records emitted before the bridge wires the sink go to console only, like Tauri's earliest boot.
    try {
      sink?.(level, formatLogArgs(scope, args));
    } catch {
      // logging must never propagate an error
    }
  },
};
