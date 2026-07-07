import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { PROJECT_HOME } from "@/cli/lib/paths";
import { RUNTIME_NAME_SHIM } from "../drivers/runtimeShim";
import type { CaptureApp, CaptureBackend, LaunchOptions } from "../drivers/types";
import { createWailsMcpDriver, WailsMcpClient } from "../drivers/wailsMcpDriver";

// Wails capture lifecycle: a self-contained production binary built with `-tags production,gtk3,mcp` (its
// built-in MCP server is the control surface — Wails has no CDP/WebDriver). We launch it, wait for the MCP
// HTTP server + the renderer, then drive it through wailsMcpDriver (js_eval + MCP mouse + X11 screenshots).
// Mirrors backends/tauriBackend.ts. Per-engine mock is set on the launched app's env (CONTAINER_DESKTOP_MOCK,
// read at runtime via get_env_var). GDK_BACKEND=x11 makes the window X11-visible so ImageMagick `import` and
// xdotool can see it; CONTAINER_DESKTOP_E2E gates single-instance OFF so this runs standalone.

const ROOT = PROJECT_HOME;
const DEFAULT_MCP_PORT = 9099;

const APP_BINARY =
  process.env.CONTAINER_DESKTOP_E2E_APP ?? path.join(ROOT, "src-wails", "bin", "container-desktop-mcp");

function assertPrereqs() {
  if (!existsSync(APP_BINARY)) {
    throw new Error(
      `Wails MCP app binary not found: ${APP_BINARY}\n` +
        "Build it first:  yarn wails:build:mcp   (or set CONTAINER_DESKTOP_E2E_APP to a `-tags production,gtk3,mcp` binary)",
    );
  }
}

function wailsEnv(engine: string, port: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CONTAINER_DESKTOP_E2E: "1",
    CONTAINER_DESKTOP_MOCK: engine,
    CONTAINER_DESKTOP_DISABLE_EXTERNAL_OPEN: "1",
    ENVIRONMENT: "production",
    NODE_ENV: "production",
    CI: process.env.CI || "true",
    // The MCP server binds here; X11 backend so the window is grabbable by `import`/xdotool.
    WAILS_MCP_HOST: "127.0.0.1",
    WAILS_MCP_PORT: String(port),
    GDK_BACKEND: "x11",
  };
}

async function waitForMcpServer(endpointRoot: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(endpointRoot, { method: "GET" });
      if (res.ok || res.status === 405 || res.status === 400) {
        return; // server is answering (the status endpoint / method-not-allowed both prove it is up)
      }
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Wails MCP server did not come up at ${endpointRoot} within ${timeoutMs}ms`);
}

// Wait until js_eval reaches the loaded renderer realm (not about:blank), then for the preload bridge.
async function waitForRenderer(client: WailsMcpClient, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const state = await client.evalPage<{ href: string; ready: string; preloaded: boolean }>(
        () => ({
          href: window.location.href,
          ready: document.readyState,
          preloaded: (globalThis as any).Preloaded === true,
        }),
        undefined,
      );
      if (state?.preloaded && state.ready === "complete" && state.href.startsWith("wails://")) {
        return;
      }
    } catch {
      // webview not ready to eval yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Wails renderer / preload bridge did not initialize");
}

export const wailsBackend: CaptureBackend = {
  kind: "wails",

  async launch(opts: LaunchOptions): Promise<CaptureApp> {
    assertPrereqs();
    const port = opts.port || DEFAULT_MCP_PORT;
    const endpointRoot = `http://127.0.0.1:${port}/`;
    const app = spawn(APP_BINARY, [], {
      stdio: ["ignore", "inherit", "inherit"],
      env: wailsEnv(opts.engine, port),
    });
    const kill = () => {
      try {
        app.kill("SIGTERM");
      } catch {
        // already gone
      }
    };
    try {
      await waitForMcpServer(endpointRoot);
      const client = new WailsMcpClient(`${endpointRoot}mcp`);
      await client.initialize();
      await waitForRenderer(client);
      // Install esbuild's __name shim in the app realm before any driver.evaluate (tsx-transpiled page
      // functions reference it). Injected as a string — a function literal would be esbuild-rewritten.
      await client.callTool("js_eval", { js: `${RUNTIME_NAME_SHIM}; return null;` });
      return {
        driver: createWailsMcpDriver(client),
        async close() {
          kill();
        },
      };
    } catch (error) {
      kill();
      throw error;
    }
  },

  async killStray(): Promise<void> {
    await new Promise((resolve) => {
      const child = spawn("pkill", ["-f", "container-desktop-mcp"], { stdio: "ignore" });
      child.once("exit", resolve);
      child.once("error", resolve);
    });
  },
};
