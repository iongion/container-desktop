// Backend-agnostic capture driver: the minimal page-automation surface both capture paths implement —
// Playwright/CDP (Electron, Chromium) and WebdriverIO/W3C-WebDriver (Tauri, WebKitGTK). The screenshot
// and demo-replay orchestration (screenshotActions.ts, demoReplay.ts) is written against this port so a
// single action layer drives either shell; the backend is chosen by CONTAINER_DESKTOP_CAPTURE_BACKEND
// (see ./backend). DOM logic stays inside evaluate() — identical page-side JS on both engines — leaving
// only a small set of true primitives (pointer, screenshot, injection) backend-specific.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

// Which element to target when a selector matches several. Mirrors Playwright's first()/last()/nth().
export type Nth = "first" | "last" | number;

export interface CaptureDriver {
  evaluate<T = unknown>(fn: (arg: any) => T, arg?: any): Promise<T>;
  // Like evaluate, but the page function returns a Promise that must be awaited in-page (e.g. a
  // MutationObserver settle). Playwright's evaluate awaits it natively; WebdriverIO needs executeAsync.
  evaluateAsync<T = unknown>(fn: (arg: any) => Promise<T>, arg?: any): Promise<T>;
  waitForFunction(fn: (arg: any) => any, arg?: any, opts?: { timeout?: number }): Promise<void>;
  pause(ms: number): Promise<void>;
  waitForLoadState(state?: "load" | "domcontentloaded"): Promise<void>;
  injectScript(source: string): Promise<void>;
  injectStyle(css: string): Promise<void>;
  waitForSelector(selector: string, opts?: { timeout?: number }): Promise<void>;
  boundingBox(selector: string, opts?: { nth?: Nth; scrollIntoView?: boolean }): Promise<Box | null>;
  getAttribute(selector: string, name: string, opts?: { nth?: Nth }): Promise<string | null>;
  innerText(selector: string, opts?: { nth?: Nth }): Promise<string>;
  fill(selector: string, value: string, opts?: { nth?: Nth }): Promise<void>;
  click(selector: string, opts?: { nth?: Nth }): Promise<void>;
  pointerMove(x: number, y: number, steps: number): Promise<void>;
  pointerDown(): Promise<void>;
  pointerUp(): Promise<void>;
  pressKey(key: string): Promise<void>;
  screenshotElement(selector: string, path: string): Promise<void>;
  screenshotViewport(path: string): Promise<void>;
  url(): Promise<string>;
  viewportSize(): Promise<Viewport>;
}

// A launched app + its driver. close() tears the whole thing down (browser/session + child process).
export interface CaptureApp {
  driver: CaptureDriver;
  close(): Promise<void>;
}

export interface LaunchOptions {
  engine: string;
  viewport: Viewport;
  mode: string;
  // "screenshots" | "demo" — scopes the per-run mock user-data dir so the two capture kinds never collide.
  label: string;
  // Electron: the CDP port to launch/attach on. Tauri drives WebDriver on a fixed port and ignores this.
  port: number;
}

export type CaptureBackendKind = "electron" | "tauri";

export interface CaptureBackend {
  readonly kind: CaptureBackendKind;
  launch(opts: LaunchOptions): Promise<CaptureApp>;
  // Kill orphaned app/driver processes left by a previous crashed run (backend-specific process names).
  killStray(): Promise<void>;
}
