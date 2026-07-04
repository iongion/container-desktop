// Decide whether xterm should use its WebGL addon or fall back to the built-in DOM renderer.
//
// The WebGL addon is a win ONLY on a hardware-accelerated GL stack (Electron/Chromium on a real GPU): it
// offloads glyph rendering to the GPU. Under WebKitGTK (the Tauri webview) WebGL is frequently SOFTWARE-
// rendered (Mesa llvmpipe / SwiftShader). There the addon is a net loss twice over: creating the GL context +
// glyph atlas stalls the main thread at terminal mount (the "UI blocks when I open Logs" jank), and per-frame
// rendering is no faster than — often slower than — the DOM path. xterm's DOM renderer is more than adequate
// for log/terminal volumes.
//
// So gate on the ACTUAL renderer, not the runtime: enable WebGL only when a probe context reports a non-software
// UNMASKED_RENDERER. Anything else — no context, masked renderer string, or a software renderer — falls back to
// DOM. Capability-based ⇒ correct on every engine×runtime with no Electron regression, and WebGL stays OFF
// precisely where it hurts. Falling back is always safe: the DOM renderer renders identical output.

const SOFTWARE_RENDERER_MARKERS = [
  "llvmpipe",
  "softpipe",
  "swiftshader",
  "software",
  "basic render", // "Microsoft Basic Render Driver" (Windows GPU-less fallback)
  "microsoft basic",
];

/** A GL renderer string looks software-rasterized (llvmpipe / SwiftShader / MS Basic Render, etc.). */
export function isSoftwareRenderer(renderer: string): boolean {
  const value = renderer.toLowerCase();
  return SOFTWARE_RENDERER_MARKERS.some((marker) => value.includes(marker));
}

// The minimal slice of a WebGL context we read to identify the renderer. Injected so the decision is unit-
// testable without a real GL context (jsdom has none); acquireGlProbe() supplies the real one in the app.
export interface RendererProbe {
  getExtension: (name: string) => { UNMASKED_RENDERER_WEBGL: number } | null;
  getParameter: (parameter: number) => unknown;
}

/**
 * Enable WebGL only when the probe PROVES hardware acceleration. Conservative by design: WebGL is an
 * optimization, so absent proof (no context, no debug-renderer extension, or a software renderer) we choose
 * the always-safe DOM renderer. `null` probe ⇒ no GL context at all ⇒ DOM.
 */
export function shouldUseWebglRenderer(probe: RendererProbe | null): boolean {
  if (!probe) {
    return false;
  }
  const info = probe.getExtension("WEBGL_debug_renderer_info");
  if (!info) {
    return false; // renderer string masked ⇒ can't confirm hardware accel ⇒ DOM
  }
  const renderer = String(probe.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? "");
  return renderer !== "" && !isSoftwareRenderer(renderer);
}

// Acquire a throwaway WebGL context purely to read its renderer identity (DOM glue jsdom can't run — verified
// live). A 1×1 offscreen canvas keeps it cheap; any failure resolves to "no probe" ⇒ DOM.
function acquireGlProbe(): RendererProbe | null {
  try {
    if (typeof document === "undefined") {
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as RendererProbe | null;
    return gl ?? null;
  } catch {
    return null;
  }
}

// WebKitGTK (the Tauri webview) mishandles xterm's WebGL renderer two ways: a heavy synchronous stall at mount
// (the Logs-nav jank), and — worse — its layered GL canvases don't repaint on programmatic writes until an OS
// event, so streamed rows never appear on their own. Its DOM renderer has neither problem and is more than
// enough for terminal/log volumes. So never use WebGL under Tauri; only Chromium/Electron (a hardware win) does.
function isTauriWebview(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const w = window as any;
  if (w.__TAURI_INTERNALS__ || w.__TAURI__) {
    return true;
  }
  // Fallback: WebKitGTK/Safari carry AppleWebKit but not the Chrome UA token that Chromium/Electron do.
  return (
    typeof navigator !== "undefined" &&
    /\bAppleWebKit\//.test(navigator.userAgent) &&
    !/\bChrome\//.test(navigator.userAgent)
  );
}

let cached: boolean | undefined;

/** Memoized per session: whether the terminal should load the WebGL addon (else the DOM renderer). */
export function preferWebglRenderer(): boolean {
  if (cached === undefined) {
    cached = !isTauriWebview() && shouldUseWebglRenderer(acquireGlProbe());
  }
  return cached;
}
