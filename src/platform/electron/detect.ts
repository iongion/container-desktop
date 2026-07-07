// Runtime shell detection for the Electron renderer branch. Electron preload exposes window.Preloaded before the
// renderer bundle runs; Tauri AND Wails also set Preloaded later (from their host bridges), so explicitly exclude
// both of their markers to keep shell detection mutually exclusive.
export function isElectronRuntime(source: any = typeof window !== "undefined" ? window : undefined): boolean {
  return !!source?.Preloaded && !("__TAURI_INTERNALS__" in source) && !("__CONTAINER_DESKTOP_WAILS__" in source);
}
