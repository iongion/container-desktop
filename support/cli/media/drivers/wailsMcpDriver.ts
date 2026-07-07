import { execFileSync } from "node:child_process";
import type { Box, CaptureDriver, Nth, Viewport } from "./types";

// CaptureDriver over Wails v3's built-in MCP server (HTTP JSON-RPC at /mcp; app built with `-tags mcp`).
// The Wails counterpart of the Playwright (Electron/CDP) and WebdriverIO (Tauri/WebDriver) adapters — Wails
// has NEITHER CDP (WebKit2GTK) nor WebDriver, so its remote-control surface is the MCP toolset. Seams:
//  - Every DOM read/write reduces to the `js_eval` tool: the (tsx-transpiled) page function is reconstructed
//    from its source via indirect eval and run in the app realm, like webdriverDriver's evaluateAsync. js_eval
//    returns the value String-coerced, so we always JSON.stringify in-page and JSON.parse here. `nth` is passed
//    as a plain arg and resolved in-page (no locator concept).
//  - Pointer input uses the MCP mouse_* tools; a down+up at one spot maps to a single mouse_click.
//  - WebKitGTK/MCP expose NO pixel screenshot (screenshot_dom is structural), so screenshots grab the native
//    window over X11 with ImageMagick `import` (needs an X server + GDK_BACKEND=x11 — set by wailsBackend).
// RUNTIME_NAME_SHIM must already be injected (wailsBackend does it) so esbuild's __name helper resolves.

const APP_WINDOW_TITLE = "Container Desktop";

// Minimal MCP JSON-RPC client (Node global fetch). Streamable-HTTP (SSE `data:` framed) tolerant; carries the
// Mcp-Session-Id the server hands back on initialize.
export class WailsMcpClient {
  private sessionId: string | null = null;
  private id = 1;

  constructor(private readonly endpoint: string) {}

  private async rpc(method: string, params?: unknown, notification = false): Promise<any> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const body: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (!notification) {
      body.id = this.id++;
    }
    if (params !== undefined) {
      body.params = params;
    }
    const res = await fetch(this.endpoint, { method: "POST", headers, body: JSON.stringify(body) });
    const sid = res.headers.get("Mcp-Session-Id");
    if (sid) {
      this.sessionId = sid;
    }
    const text = await res.text();
    if (notification || !text.trim()) {
      return null;
    }
    const json = text.includes("data:")
      ? text
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("")
      : text;
    const parsed = JSON.parse(json);
    if (parsed.error) {
      throw new Error(`MCP ${method}: ${JSON.stringify(parsed.error)}`);
    }
    return parsed.result;
  }

  async initialize(): Promise<void> {
    await this.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "wailsMcpDriver", version: "1.0.0" },
    });
    await this.rpc("notifications/initialized", undefined, true).catch(() => {});
  }

  // tools/call → flattened text of the content blocks; throws on isError.
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const result = await this.rpc("tools/call", { name, arguments: args });
    const text = (result?.content ?? [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    if (result?.isError) {
      throw new Error(`MCP tool ${name} failed: ${text}`);
    }
    return text;
  }

  // Run a page function (source + single arg) via js_eval and JSON-parse its result.
  async evalPage<T>(fn: (arg: any) => any, arg: unknown): Promise<T> {
    const src = fn.toString();
    const js = [
      `const __fn = (${src});`,
      `const __arg = ${arg === undefined ? "undefined" : JSON.stringify(arg)};`,
      "const __r = await __fn(__arg);",
      "return JSON.stringify(__r === undefined ? null : __r);",
    ].join("\n");
    const text = (await this.callTool("js_eval", { js })).trim();
    if (!text) {
      return null as T;
    }
    return JSON.parse(text) as T;
  }
}

// Grab the native window's pixels to `path` over X11 (ImageMagick `import`), optionally cropped to `box`
// (viewport-relative == window-relative for the frameless window). Finds the window by title; falls back to
// the X root. `+repage` resets the virtual canvas so the crop is a clean standalone image.
function captureWindow(path: string, box: Box | null): void {
  let windowId = "";
  try {
    windowId =
      execFileSync("xdotool", ["search", "--name", APP_WINDOW_TITLE], { encoding: "utf8" }).trim().split("\n").pop() ||
      "";
  } catch {
    // xdotool missing / no match — fall back to the whole X root.
  }
  const target = windowId ? ["-window", windowId] : ["-window", "root"];
  const crop =
    box && box.width > 0 && box.height > 0
      ? [
          "-crop",
          `${Math.round(box.width)}x${Math.round(box.height)}+${Math.round(box.x)}+${Math.round(box.y)}`,
          "+repage",
        ]
      : [];
  execFileSync("import", [...target, ...crop, path], { stdio: "ignore" });
}

export function createWailsMcpDriver(client: WailsMcpClient): CaptureDriver {
  let lastPointer = { x: 0, y: 0 };

  const measure = (selector: string, nth: Nth, scroll: boolean): Promise<Box | null> =>
    client.evalPage<Box | null>(
      ([sel, nthArg, doScroll]: [string, Nth, boolean]) => {
        const nodes = document.querySelectorAll(sel);
        const element =
          nthArg === "last" ? nodes[nodes.length - 1] : typeof nthArg === "number" ? nodes[nthArg] : nodes[0];
        if (!element) {
          return null;
        }
        if (doScroll) {
          element.scrollIntoView({ block: "center", inline: "center" });
        }
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      },
      [selector, nth, scroll],
    );

  return {
    async evaluate(fn, arg) {
      return client.evalPage(fn, arg);
    },

    async evaluateAsync(fn, arg) {
      // js_eval already awaits the body's return, so evalPage (which awaits __fn) covers the async case too.
      return client.evalPage(fn, arg);
    },

    async waitForFunction(fn, arg, opts) {
      const timeout = opts?.timeout ?? 30_000;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try {
          // Pass the caller's predicate STRAIGHT to the page (evalPage serializes it) — never wrap it in
          // another closure, or the inner `fn` becomes an undefined reference in the app realm.
          if (await client.evalPage<boolean>(fn, arg)) {
            return;
          }
        } catch {
          // context torn down mid-navigation — treat as not-yet
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("waitForFunction timed out");
    },

    async pause(ms) {
      await new Promise((r) => setTimeout(r, ms));
    },

    async waitForLoadState(state = "load") {
      const start = Date.now();
      while (Date.now() - start < 15_000) {
        try {
          const ready = await client.evalPage<string>(() => document.readyState, undefined);
          if (state === "domcontentloaded" ? ready !== "loading" : ready === "complete") {
            return;
          }
        } catch {
          // ignore
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    },

    async injectScript(source) {
      await client.evalPage((src: string) => {
        const element = document.createElement("script");
        element.textContent = src;
        document.head.appendChild(element);
        element.remove();
        return null;
      }, source);
    },

    async injectStyle(css) {
      await client.evalPage((content: string) => {
        const element = document.createElement("style");
        element.textContent = content;
        document.head.appendChild(element);
        return null;
      }, css);
    },

    async waitForSelector(selector, opts) {
      const timeout = opts?.timeout ?? 30_000;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const visible = await client
          .evalPage<boolean>((sel: string) => {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (!el) {
              return false;
            }
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }, selector)
          .catch(() => false);
        if (visible) {
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`waitForSelector timed out: ${selector}`);
    },

    async boundingBox(selector, opts): Promise<Box | null> {
      return measure(selector, opts?.nth ?? "first", Boolean(opts?.scrollIntoView));
    },

    async getAttribute(selector, name, opts) {
      return client.evalPage<string | null>(
        ([sel, attr, nthArg]: [string, string, Nth]) => {
          const nodes = document.querySelectorAll(sel);
          const element =
            nthArg === "last" ? nodes[nodes.length - 1] : typeof nthArg === "number" ? nodes[nthArg] : nodes[0];
          return element ? element.getAttribute(attr) : null;
        },
        [selector, name, opts?.nth ?? "first"],
      );
    },

    async innerText(selector, opts) {
      return client.evalPage<string>(
        ([sel, nthArg]: [string, Nth]) => {
          const nodes = document.querySelectorAll(sel);
          const element: any =
            nthArg === "last" ? nodes[nodes.length - 1] : typeof nthArg === "number" ? nodes[nthArg] : nodes[0];
          return element ? element.innerText || element.textContent || "" : "";
        },
        [selector, opts?.nth ?? "first"],
      );
    },

    async fill(selector, value, opts) {
      await client.evalPage(
        ([sel, val, nthArg]: [string, string, Nth]) => {
          const nodes = document.querySelectorAll(sel);
          const element: any =
            nthArg === "last" ? nodes[nodes.length - 1] : typeof nthArg === "number" ? nodes[nthArg] : nodes[0];
          if (!element) {
            return null;
          }
          const proto =
            element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          setter?.call(element, val);
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return null;
        },
        [selector, value, opts?.nth ?? "first"],
      );
    },

    async click(selector, opts) {
      await client.evalPage(
        ([sel, nthArg]: [string, Nth]) => {
          const nodes = document.querySelectorAll(sel);
          const element: any =
            nthArg === "last" ? nodes[nodes.length - 1] : typeof nthArg === "number" ? nodes[nthArg] : nodes[0];
          element?.click();
          return null;
        },
        [selector, opts?.nth ?? "first"],
      );
    },

    async pointerMove(x, y) {
      lastPointer = { x: Math.round(x), y: Math.round(y) };
      await client.callTool("mouse_move", { x: lastPointer.x, y: lastPointer.y }).catch(() => {});
    },

    async pointerDown() {
      // No-op: a down+up at one spot is emitted as a single mouse_click on pointerUp (the only usage is
      // openRowActions clicking a row's action-menu button).
    },

    async pointerUp() {
      await client.callTool("mouse_click", { x: lastPointer.x, y: lastPointer.y }).catch(() => {});
    },

    async pressKey(key) {
      await client.callTool("keyboard_press", { key }).catch(() => {});
    },

    async screenshotElement(selector, path) {
      const box = await measure(selector, "first", false).catch(() => null);
      captureWindow(path, box);
    },

    async screenshotViewport(path) {
      captureWindow(path, null);
    },

    async url() {
      return client.evalPage<string>(() => window.location.href, undefined);
    },

    async viewportSize(): Promise<Viewport> {
      return client.evalPage<Viewport>(() => ({ width: window.innerWidth, height: window.innerHeight }), undefined);
    },
  };
}
