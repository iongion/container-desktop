// Runtime shell detection for the Wails branch. Wails v3's @wailsio/runtime no longer publishes on
// window.wails, and the native window._wails plumbing name is alpha-unstable — so the Wails Go shell
// injects an app-owned marker at document start (src-wails/main.go WebviewWindowOptions.JS). boot()
// checks this (and the Electron branch excludes it) so shell detection stays mutually exclusive.
export function isWailsRuntime(source: any = typeof window !== "undefined" ? window : undefined): boolean {
  return !!source && "__CONTAINER_DESKTOP_WAILS__" in source;
}
