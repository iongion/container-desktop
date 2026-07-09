// Wails dev launcher — the Wails analog of support/watch.mjs (Electron) and Tauri's beforeDevCommand.
// It starts the SHARED Vite renderer dev server on :3000 (hot reload — the same server Electron and Tauri use),
// waits for it to accept connections, then runs the Go shell (`go run`) with ENVIRONMENT=development so main.go's
// appURL() points the Wails window at http://localhost:3000 instead of the embedded bundle. CONTAINER_DESKTOP_MOCK
// (set by `yarn wails:dev:mock`) is inherited by the Go process. Ctrl-C / a child exit tears both down.
//
// No Taskfile / `wails3 dev` yet (deferred) — this is the minimal orchestration that gives Wails the same
// localhost:3000 dev experience as the other two shells without hand-running two terminals.

import { spawn } from "node:child_process";
import net from "node:net";

const HOST = "127.0.0.1";
const PORT = 3000;
const START_TIMEOUT_MS = 90_000;

const childEnv = { ...process.env, ENVIRONMENT: "development" };
const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // best-effort
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function waitForPort(port, host, timeoutMs) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, host);
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Vite dev server did not come up on ${host}:${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 250);
        }
      });
    };
    attempt();
  });
}

// The Vite renderer dev server (same command as `yarn wails:serve` / `yarn tauri:serve`).
const vite = spawn("yarn", ["wails:serve"], { stdio: "inherit", env: childEnv, shell: true });
children.push(vite);
vite.on("exit", (code) => shutdown(code ?? 0));

try {
  await waitForPort(PORT, HOST, START_TIMEOUT_MS);
} catch (error) {
  console.error(String(error?.message || error));
  shutdown(1);
}

// The Go shell (dev build — application_dev.go is //go:build !production). `-tags gtk3` selects Wails' STABLE
// GTK3 + webkit2gtk-4.1 Linux backend (Tauri's exact stack) where window drag works; the default GTK4 +
// WebKitGTK-6.0 path is experimental and its frameless window drag is unimplemented (wails #4957). The tag is
// inert off Linux. FRONTEND_DEVSERVER_URL makes the Wails AssetServer PROXY to the Vite dev server while the
// window stays on the Wails origin, so the JS↔Go transport stays wired. CONTAINER_DESKTOP_MOCK is inherited.
//
// WAILS_MCP=1 additionally builds with the `mcp` tag → Wails v3's built-in MCP server starts on
// WAILS_MCP_PORT (default 9099) at http://127.0.0.1:<port>/mcp. That is the cross-platform remote-control
// surface for Wails (WebKit2GTK/WKWebView have no CDP, and Wails has no WebDriver/automation), driven by
// support/wails-mcp.mjs — the Wails analog of support/cdp.mjs (Electron) / webdriver/wdio.conf.js (Tauri).
const mcpOn = ["1", "true", "yes"].includes(String(process.env.WAILS_MCP ?? "").toLowerCase());
const goTags = mcpOn ? "gtk3,mcp" : "gtk3";
const mcpEnv = mcpOn ? { WAILS_MCP_PORT: process.env.WAILS_MCP_PORT ?? "9099" } : {};
if (mcpOn) {
  console.log(
    `Wails MCP server enabled → http://127.0.0.1:${mcpEnv.WAILS_MCP_PORT}/mcp (drive with support/wails-mcp.mjs)`,
  );
}
const go = spawn("go", ["-C", "src-wails", "run", "-tags", goTags, "."], {
  stdio: "inherit",
  env: { ...childEnv, ...mcpEnv, FRONTEND_DEVSERVER_URL: `http://${HOST}:${PORT}` },
});
children.push(go);
go.on("exit", (code) => shutdown(code ?? 0));
