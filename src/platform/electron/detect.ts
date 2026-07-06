// Runtime shell detection for the Electron renderer branch. Electron preload exposes window.Preloaded before the
// renderer bundle runs; Tauri also sets Preloaded later, so explicitly exclude the Tauri marker.
export function isElectronRuntime(source: any = typeof window !== "undefined" ? window : undefined): boolean {
  return !!source?.Preloaded && !("__TAURI_INTERNALS__" in source);
}
