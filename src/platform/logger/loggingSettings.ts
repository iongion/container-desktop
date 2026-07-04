// Pure, shell-agnostic defaults + normalizer for the local file-logging policy. Lives apart from the
// logger façade and the electron-log adapter so the renderer (settings UI), main (apply config), and
// tests all share ONE source of truth without pulling in any Electron/electron-log code.

import type { LoggingFileSettings } from "@/env/Types";

// Opt-in, OFF by default. Conservative caps so disk use stays bounded once enabled
// (≈ maxSizeMb * (maxFiles + 1) ≈ 30 MB at the defaults). NEVER a remote/cloud sink.
export const DEFAULT_LOGGING_FILE: LoggingFileSettings = {
  enabled: false,
  maxSizeMb: 5,
  maxFiles: 5,
};

// Selectable bounds surfaced in the settings UI (and used to clamp stored values).
export const LOGGING_FILE_MAX_SIZE_MB = [1, 5, 10, 20, 50] as const;
export const LOGGING_FILE_MAX_FILES = [1, 3, 5, 10, 20] as const;

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < min) {
    return fallback;
  }
  return n > max ? max : n;
}

// Always returns a complete, safe LoggingFileSettings — even from a partial/legacy/garbage blob.
export function normalizeLoggingFileSettings(file?: Partial<LoggingFileSettings> | null): LoggingFileSettings {
  return {
    enabled: !!file?.enabled,
    maxSizeMb: clampNumber(file?.maxSizeMb, DEFAULT_LOGGING_FILE.maxSizeMb, 1, 1024),
    maxFiles: clampNumber(file?.maxFiles, DEFAULT_LOGGING_FILE.maxFiles, 1, 100),
  };
}
