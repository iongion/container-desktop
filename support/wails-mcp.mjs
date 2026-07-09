#!/usr/bin/env node
// Wails remote-control / E2E driver — the Wails analog of support/cdp.mjs (Electron, Chrome DevTools Protocol)
// and webdriver/wdio.conf.js (Tauri, W3C WebDriver via tauri-driver). Wails has NEITHER: WebKit2GTK (Linux) and
// WKWebView (macOS) expose no CDP, and Wails ships no WebDriver/automation shim. Its cross-platform control
// surface is instead Wails v3's built-in MCP server (Model Context Protocol), which starts when the app is built
// with the `mcp` tag and serves JSON-RPC 2.0 over HTTP at http://127.0.0.1:<WAILS_MCP_PORT>/mcp.
//
// Enable it with:  WAILS_MCP=1 CONTAINER_DESKTOP_MOCK=1 yarn wails:dev   (support/wails-dev.mjs adds -tags mcp)
// or a self-contained build:  go -C src-wails build -tags production,gtk3,mcp -o bin/cd && WAILS_MCP_PORT=9099 bin/cd
//
// Usage (mirrors cdp.mjs):
//   node support/wails-mcp.mjs                          # handshake + app_info + windows_list snapshot
//   EVAL='return location.href' node support/wails-mcp.mjs   # run JS (async fn body), print the result
//   node support/wails-mcp.mjs app.png '#/screens/containers'  # navigate, then write a PNG screenshot
// Env: WAILS_MCP_HOST (127.0.0.1), WAILS_MCP_PORT (9099).
//
// Screenshots: WebKitGTK/Wails expose NO pixel capture (MCP's screenshot_dom is a structural snapshot only), so
// a `.png` arg grabs the native window's pixels over X11 with ImageMagick `import`. Needs an X server (real or
// xvfb) and the app launched with GDK_BACKEND=x11 so the window is X11-visible (Wayland-native windows are not).

import { execFileSync } from "node:child_process";

const HOST = process.env.WAILS_MCP_HOST || "127.0.0.1";
const PORT = process.env.WAILS_MCP_PORT || "9099";
const ENDPOINT = `http://${HOST}:${PORT}/mcp`;

let sessionId = null;
let nextId = 1;

// One JSON-RPC round trip. Captures/echoes the Mcp-Session-Id header, and tolerates a Streamable-HTTP
// (SSE `data:` framed) response as well as a plain application/json body.
async function rpc(method, params, { notification = false } = {}) {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const body = { jsonrpc: "2.0", method };
  if (!notification) body.id = nextId++;
  if (params !== undefined) body.params = params;
  const res = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body) });
  const sid = res.headers.get("Mcp-Session-Id");
  if (sid) sessionId = sid;
  const text = await res.text();
  if (notification || !text.trim()) return null;
  const json = text.includes("data:")
    ? text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("")
    : text;
  const parsed = JSON.parse(json);
  if (parsed.error) throw new Error(`MCP ${method}: ${JSON.stringify(parsed.error)}`);
  return parsed.result;
}

// tools/call → flattened text of the returned content blocks; throws on isError.
async function callTool(name, args) {
  const result = await rpc("tools/call", { name, arguments: args || {} });
  const text = (result?.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  if (result?.isError) throw new Error(`tool ${name} failed: ${text}`);
  return text;
}

// Grab the native window's pixels to `pngPath` over X11 (ImageMagick `import`) — the only route to a real
// screenshot, since WebKitGTK/Wails/MCP offer none. Finds the window by its title; falls back to the X root.
function captureScreenshot(pngPath) {
  let windowId = "";
  try {
    windowId =
      execFileSync("xdotool", ["search", "--name", "Container Desktop"], { encoding: "utf8" })
        .trim()
        .split("\n")
        .pop() || "";
  } catch {
    // xdotool missing or no match — fall back to the whole X root below.
  }
  const target = windowId ? ["-window", windowId] : ["-window", "root"];
  execFileSync("import", [...target, pngPath], { stdio: "inherit" });
  console.log(`screenshot → ${pngPath}${windowId ? ` (window ${windowId})` : " (X root)"}`);
}

async function main() {
  const args = process.argv.slice(2);
  const pngPath = args.find((a) => a.endsWith(".png"));
  const route = args.find((a) => a.startsWith("#"));

  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "wails-mcp.mjs", version: "1.0.0" },
  });
  await rpc("notifications/initialized", undefined, { notification: true }).catch(() => {});

  if (route) {
    await callTool("js_eval", { js: `window.location.hash = ${JSON.stringify(route)}; return window.location.href;` });
    await new Promise((r) => setTimeout(r, 600));
  }

  if (process.env.EVAL) {
    console.log(await callTool("js_eval", { js: process.env.EVAL }));
    return;
  }

  if (pngPath) {
    captureScreenshot(pngPath);
    return;
  }

  console.log("=== app_info ===");
  console.log(await callTool("app_info", {}).catch((e) => e.message));
  console.log("=== windows_list ===");
  console.log(await callTool("windows_list", {}).catch((e) => e.message));
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
