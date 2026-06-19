# MCP Server support — implementation plan

## Why

Let LLMs drive container-desktop. Two MCP servers — one for **engine operations** (containers,
images, volumes, networks, pods — every engine, every transport, simultaneously) and one for **app
navigation** (screenshots, navigation, UI inspection). The LLM never knows whether a container
lives in Podman/Docker/Apple, native/SSH/WSL — the existing `HostClientFacade` and multi-connection
data layer already erase those differences. MCP makes that surface available to any MCP-compatible
client over the industry-standard **stdio** transport.

## What the industry does (and what we follow)

| Precedent | Approach |
|---|---|
| `@anthropic/mcp-server-docker` | stdio MCP server wrapping `docker` CLI. One tool per operation (`docker-ps`, `docker-run`, …). |
| `@anthropic/mcp-server-kubernetes` | Same pattern for `kubectl`. |
| `puppeteer-mcp-server` / `browser-mcp` | CDP-driven browser MCP: navigate, screenshot, click, evaluate JS. |
| Podman Desktop extension API | Not MCP — exposes a provider interface, not a general-purpose LLM surface. |
| VS Code MCP + GitHub Copilot | MCP as the universal extension surface for LLM tools. |

**Common patterns we adopt:**
- **stdio transport** — the LLM client spawns the server as a child process; messages are JSON-RPC
  over stdin/stdout. No network port, no auth, trivial to configure (`claude mcp add … -- node
  mcp/engine-server.mjs`).
- **Tools over raw schema** — each operation is a named tool (e.g. `listContainers`) with a
  JSON Schema `inputSchema` describing its parameters. The LLM calls the tool; the MCP server
  calls the engine facade; the result is returned as structured JSON.
- **Resources for live state** — the MCP `resources/list` capability pushes the current
  multi-connection snapshot (`ResourceSyncSnapshot`), so the LLM sees what the app sees without
  polling.
- **Prompts for common workflows** — canned prompt templates (e.g. "troubleshoot this failing
  container") that the LLM can expand.
- **Single Node.js process** — no Python, no Go. The MCP server is a plain `.mjs` script that
  `import`s the MCP SDK + a thin IPC bridge to main. It runs as a child of the Electron main
  process (or standalone if the app is already running).

## Architecture — where the MCP servers sit

```
┌─ LLM client (Claude, Copilot, etc.) ─────────────────────────────┐
│  spawns two child processes over stdio                           │
│                                                                  │
│  ┌─ Engine MCP server (mcp/engine-server.mjs) ────────────────┐  │
│  │  · tools: listContainers, startContainer, pullImage, …     │  │
│  │  · resources: connections, per-domain counts               │  │
│  │  · prompts: troubleshoot, prune, security scan             │  │
│  │                                                            │  │
│  │  ── IPC bridge ──▶ Electron main process                  │  │
│  │      (app-specific channel: "mcp:invoke")                  │  │
│  │      carries tool name + params → result                   │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ App Navigation MCP server (mcp/navigation-server.mjs) ────┐  │
│  │  · tools: navigate, screenshot, click, readTable, eval     │  │
│  │                                                            │  │
│  │  ── CDP (Playwright) ──▶ Electron renderer :9222          │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

┌─ Electron main process ───────────────────────────────────────────┐
│  EngineDataService (owns connections + resource state)             │
│  MCP IPC handler: receives "mcp:invoke" → calls facade → returns  │
│  ResourceSyncBroker: pushes snapshots (also wired to MCP)         │
└───────────────────────────────────────────────────────────────────┘
```

**Why this split:**
- The engine server needs access to `EngineDataService` (host clients, resource snapshots,
  connection lifecycle) — all owned by main. The IPC bridge is thin: a single `invoke` channel
  that maps tool names to facade calls.
- The navigation server needs a browser automation surface. That's already available at
  `:9222` (Chrome DevTools Protocol). We reuse the existing Playwright-based `support/cdp.mjs`
  patterns.
- Both servers are **independent** — the LLM can use one, or both, or neither. They don't share
  process state and don't block each other.

## Phase 1 — Engine MCP server

### Transport

stdio (JSON-RPC 2.0 over stdin/stdout). The LLM client spawns:

```bash
node mcp/engine-server.mjs --app-pipe /tmp/container-desktop-mcp.sock
```

The `--app-pipe` is a Unix socket (or Windows named pipe) that main listens on. The server
connects to it and sends JSON-RPC invoke messages; main returns JSON-RPC results.

### Tool catalog (v1 — the high-value subset)

Every tool takes an optional `connectionId` parameter. When omitted, the tool operates on **all**
connected engines (multi-connection workspace). When provided, it targets one specific connection.

| Tool | Facade method(s) | Notes |
|---|---|---|
| `listConnections` | `EngineDataService.getAppRuntimeSnapshot()` | Which engines are up, their phase/running/version |
| `listContainers` | `ContainersAdapter.list()` per connection | Returns merged list with per-row `engine` + `connectionId` |
| `getContainer` | `ContainersAdapter.get(id)` | Full inspect (state, mounts, ports, env, …) |
| `containerLogs` | `ContainersAdapter.logs(id, {tail})` | Last N lines as plain text |
| `startContainer` | `ContainersAdapter.start(id)` | |
| `stopContainer` | `ContainersAdapter.stop(id)` | |
| `restartContainer` | `ContainersAdapter.restart(id)` | |
| `removeContainer` | `ContainersAdapter.remove(id)` | |
| `createContainer` | `ContainersAdapter.create(opts)` | Image, name, mounts, ports |
| `listImages` | `ImagesAdapter.list()` per connection | |
| `getImage` | `ImagesAdapter.get(id)` | Full inspect |
| `pullImage` | `Application.pullFromRegistry(opts)` | Progress reported as log entries in the response |
| `removeImage` | `ImagesAdapter.remove(id)` | |
| `searchImages` | `Application.searchRegistry(opts)` | |
| `listVolumes` | `VolumesAdapter.list()` per connection | |
| `createVolume` | `VolumesAdapter.create(opts)` | |
| `removeVolume` | `VolumesAdapter.remove(name)` | |
| `listNetworks` | `NetworksAdapter.list()` per connection | |
| `createNetwork` | `NetworksAdapter.create(opts)` | |
| `removeNetwork` | `NetworksAdapter.remove(name)` | |
| `listPods` | `PodsAdapter.list()` per connection | Podman-only; empty on Docker/Apple |
| `pruneSystem` | `pruneSystem()` | Docker `system prune`; Podman equivalent |

~20 tools covering the core surface. This is the **subset industry MCP servers ship** (Docker MCP
has ~12 tools). We don't expose every REST endpoint — we expose the **workflows** an operator
actually asks an LLM to perform.

**What we deliberately omit from v1:**
- Secrets management (low LLM demand)
- Machine lifecycle (host-specific, not engine-portable)
- Kube generation (Podman-only, niche)
- Swarm/Compose (Docker-only extensions, not unified)
- Container exec/terminal (streaming TTYs don't fit MCP's request/response model well)
- Events stream (push model; use resources snapshots instead)

### Resources

The MCP `resources/list` returns a live snapshot whenever the client re-reads:

```
resource://connections        → AppRuntimeSnapshot (JSON)
resource://containers/{connId} → Container[] (per-connection)
resource://images/{connId}    → Image[]
resource://summary             → { connections: N, containers: M, images: P, running: Q }
```

Resources are read via `resource:get-snapshot` over the existing preload bridge, not a separate
mechanism. They update on every engine `/events` push (the app's existing debounced refresh).

### Prompts

Canned prompt templates the LLM can expand:

| Prompt | Template |
|---|---|
| `troubleshoot-container` | "I have a container `{id}` on engine `{engine}`. Inspect it, check its logs, and tell me why it might be failing." |
| `prune-workspace` | "List all unused images, stopped containers, and dangling volumes across all engines. Ask before removing." |
| `security-scan` | "For image `{name}`, pull it and run a security scan. Report the top 3 vulnerabilities." |
| `port-map` | "List all running containers and the ports they expose. Identify any conflicts." |

### IPC bridge (main side)

A new `McpIpcServer` in `src/electron-shell/` listens on a Unix socket (or named pipe on
Windows). It receives `{tool, params}` JSON objects, calls the corresponding facade method via
`EngineDataService`, and returns `{result}` or `{error}`. This is the **only new main-process
code**. It reuses:
- `EngineDataService.getHost(connectionId)` — the per-connection host client
- `ContainersAdapter` / `ImagesAdapter` / etc. — constructed per-call with the right host
- `Application.getInstance()` — for connection lifecycle (connectAll on demand)

The bridge does NOT spawn the MCP server — that's the LLM client's job (stdio). The bridge
only accepts connections from the local MCP server process.

### Engine MCP server (standalone process)

`mcp/engine-server.mjs` — a ~200-line script:

```javascript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connectToApp } from "./ipc-client.mjs";

const app = await connectToApp(process.env.CD_APP_PIPE || "/tmp/container-desktop-mcp.sock");
const server = new Server({ name: "container-desktop-engine", version: "1.0.0" }, { capabilities: { tools: {}, resources: {}, prompts: {} } });

server.setRequestHandler("tools/list", async () => ({ tools: TOOL_DEFS }));
server.setRequestHandler("tools/call", async (req) => {
  const result = await app.invoke(req.params.name, req.params.arguments ?? {});
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});
// … resources, prompts similarly

const transport = new StdioServerTransport();
await server.connect(transport);
```

## Phase 2 — App Navigation MCP server

Reuses the existing CDP endpoint (`--remote-debugging-port=9222`). The LLM drives the
Electron renderer the same way `support/cdp.mjs` does — via Playwright's `connectOverCDP`.

### Tools

| Tool | CDP/Playwright operation |
|---|---|
| `navigate` | `page.evaluate(hash => location.hash = hash, route)`. Routes: `#/screens/containers`, `#/screens/images`, `#/screens/settings`, … |
| `screenshot` | `page.screenshot({path})`. Returns base64 PNG. Optional `selector` argument to capture a single element. |
| `readScreen` | Reads the current screen's table head + rows, footer engine inventory, and sidebar state. Same as `readInfo()` in cdp.mjs. |
| `readSnapshot` | Calls `resource:get-snapshot` over the preload bridge. Returns per-connection counts + runtime. |
| `click` | `page.click(selector)`. For buttons/links by their text or `data-testid`. |
| `eval` | `page.evaluate(expression)`. Arbitrary JS in the renderer. |
| `waitForReady` | Polls until `data-phase="ready"` on the document. |

### Tool definitions are deliberately coarse

The LLM shouldn't click raw CSS selectors — it should express intent ("start the container named
`nginx`") and let the navigation server map that to the UI. The `click` and `eval` tools are
escape hatches for unanticipated interactions; the primary surface is `navigate` + `readScreen` +
`readSnapshot`.

### What this enables

- **Screenshot verification**: "Show me the containers screen" → `navigate` + `screenshot`.
- **UI state queries**: "Are there any stopped containers?" → `readSnapshot` or `readScreen`.
- **Guided workflows**: The LLM navigates to a settings screen, reads the form, tells the user
  what to configure, and verifies the result with a screenshot.
- **Regression diffing**: Take a screenshot before and after a code change; the LLM compares.

## Phase 3 (post-v1) — polish

1. **`containerLogsStream` as MCP resources** — a `resource://containers/{id}/logs` that streams
   new log lines as resource updates (MCP supports subscription-based resources in the 2025 spec).
2. **Container exec** — limited, command-and-output only (no interactive TTY). `execContainer(id,
   ["ls", "-la"])` returns stdout.
3. **`composeUp` / `composeDown`** — for Docker Compose workflows once the facade supports them.
4. **`buildImage`** — `docker build` / `podman build` via the CLI runner.
5. **MCP server bundled inside the app** — the app ships the MCP server as an `extraResource`; a
   `container-desktop mcp` CLI subcommand starts it without spawning Electron.
6. **MCP registry entry** — publish a `container-desktop-mcp` npm package so `npx
   container-desktop-mcp` works without the app installed locally (connects over SSH to a remote
   instance).

## What we DON'T do

- **No REST API server inside the app.** stdio MCP is the universal interface. A REST wrapper
  can be a separate MCP client if anyone needs it, but it's not part of the app.
- **No per-engine MCP servers.** The unified facade already merges Docker/Podman/Apple. One
  MCP server, one surface.
- **No MCP-in-renderer.** The renderer has no engine authority (main owns it). The MCP server
  reaches main via IPC; it never touches the DOM or the renderer's Zustand stores.
- **No authentication.** The MCP server only accepts local connections from the same machine.
  Remote MCP is a post-v1 concern (SSH tunneling covers it trivially).

## Files touched (estimate)

| File | Purpose |
|---|---|
| `src/electron-shell/mcpIpcServer.ts` | **New.** Unix socket / named pipe listener in main. Receives `{tool, params}`, calls facade, returns `{result}`. |
| `src/electron-shell/main.ts` | Start the IPC server on app ready. |
| `mcp/engine-server.mjs` | **New.** Standalone MCP server process. Connects to main's IPC socket, exposes MCP tools/resources/prompts. |
| `mcp/navigation-server.mjs` | **New.** Standalone MCP server process. Connects to Electron's CDP endpoint, exposes navigation/screenshot tools. |
| `mcp/ipc-client.mjs` | **New.** Shared IPC client helper (connect to main's socket, send invoke, receive result). |
| `mcp/tool-defs.mjs` | **New.** JSON Schema tool definitions shared between engine + navigation servers. |
| `package.json` | Add `@modelcontextprotocol/sdk` + `playwright-core` as dependencies. |
| `support/cdp.mjs` | Refactor: extract `readInfo`/`readSnapshot` into a shared module the navigation MCP reuses. |

No changes to `container-client/` (facade, adapters, registry), `web-app/` (stores, screens), or
`src/env/Types.ts`. The MCP layer is purely additive — a new consumer of the existing facade.

## Verification

1. **Unit tests** (hermetic Vitest): MCP IPC server → mock EngineDataService → verify tool
   dispatch. Tool schema validation.
2. **Integration test**: Spawn `mcp/engine-server.mjs` → connect to a mock IPC socket → call
   `listContainers` → assert JSON result.
3. **Live smoke**: `CONTAINER_DESKTOP_MOCK=unified yarn dev` → start MCP server → use the MCP
   Inspector (`npx @modelcontextprotocol/inspector`) to call tools interactively.
4. **CDP smoke**: `yarn dev` → start navigation MCP → `navigate` + `screenshot` → verify PNG
   written.