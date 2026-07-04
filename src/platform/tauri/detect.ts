// Runtime shell detection. Tauri v2 injects `window.__TAURI_INTERNALS__` into every webview, so this is a
// cheap, import-free check (equivalent to @tauri-apps/api's isTauri(), without pulling that module into the
// Electron bundle at module-eval time). boot() uses it to decide whether to install the Tauri host bridge.
export function isTauriRuntime(source: any = typeof window !== "undefined" ? window : undefined): boolean {
  return !!source && "__TAURI_INTERNALS__" in source;
}
