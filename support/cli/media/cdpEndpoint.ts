// Shared CDP-endpoint discovery for the offscreen Electron capture scripts (screenshots / demo
// replay). In `dev` mode they spawn `yarn dev` → support/watch.mjs, which PREFERS the requested
// CONTAINER_DESKTOP_REMOTE_DEBUGGING_PORT but auto-falls-back to an OS-assigned free port when it is
// busy (e.g. an orphaned Electron from a previous crashed run squatting it) and publishes the port it
// actually bound to a handshake file. Reading that file — instead of assuming the requested port —
// keeps connectOverCDP off the wrong/dead port (otherwise it races it and times out). Mirrors the
// discovery in support/cdp.mjs so both sides agree on the endpoint without hardcoding a port.
import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const CDP_ENDPOINT_FILE = path.join(os.tmpdir(), "container-desktop-cdp.json");

// Remove a stale handshake file so we never read a previous run's endpoint before watch.mjs rewrites it.
export function clearCdpEndpointFile() {
  rmSync(CDP_ENDPOINT_FILE, { force: true });
}

// Resolve the CDP endpoint to attach to. `built` mode launches Electron directly on the exact port,
// so it is deterministic; `dev` mode reads watch.mjs's handshake file to learn the real (possibly
// fallback) port, polling until it appears and degrading to the requested port if it never does.
export async function resolveCdpEndpoint(mode, port, timeoutMs = 30_000) {
  const fallback = `http://localhost:${port}`;
  if (mode !== "dev") {
    return fallback;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (existsSync(CDP_ENDPOINT_FILE)) {
        const { cdpUrl } = JSON.parse(readFileSync(CDP_ENDPOINT_FILE, "utf8"));
        if (cdpUrl) {
          return cdpUrl;
        }
      }
    } catch {
      // file mid-write or malformed — retry until the deadline
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return fallback;
}
