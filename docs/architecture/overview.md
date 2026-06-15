# Overview — System Context & Containers (C4 L1 + L2)

container-desktop is a cross-platform Electron desktop app for managing container
engines (Podman / Docker), whether they run locally, inside a VM, inside WSL, or
on a remote host over SSH. This page is the big picture; [backend.md](backend.md)
and [frontend.md](frontend.md) zoom in.

## C4 L1 — System Context

Who uses the app and what it talks to.

```mermaid
flowchart TB
  dev([Developer / Operator]):::person

  cd[container-desktop<br/>Electron desktop app]:::system

  podman[(Podman engine<br/>API socket)]:::external
  docker[(Docker engine<br/>API socket)]:::external
  ssh[(Remote host<br/>over SSH)]:::external
  wsl[(WSL distribution<br/>Windows)]:::external
  vm[(Podman machine / Lima VM)]:::external
  registry[(Image registries)]:::external

  dev -->|views and controls<br/>containers, images, volumes…| cd
  cd -.->|HTTP over unix socket / npipe| podman
  cd -.->|HTTP over unix socket / npipe| docker
  cd -.->|SSH tunnel → engine socket| ssh
  cd -.->|wsl.exe + pipe/socket relay| wsl
  cd -.->|machine/limactl → VM socket| vm
  cd -.->|pull / search images| registry

  classDef person fill:#08427b,color:#fff,stroke:#052e56;
  classDef system fill:#1168bd,color:#fff,stroke:#0b4884;
  classDef external fill:#8a8a8a,color:#fff,stroke:#5e5e5e;
```

The app is a **client** of engine API sockets. It never reimplements the engine —
it discovers, starts, and proxies to the engine's REST API (the Podman/libpod or
Docker socket), then renders the results.

## C4 L2 — Containers (runnable pieces)

The app is **three runtimes** in one repo (see [`CLAUDE.md`](../../CLAUDE.md) for
the build model): a Node/TypeScript Electron app, a Go relay, and Python build
tooling (not shown — it builds, it doesn't run at app runtime).

The interesting and slightly unusual part is **where the engine logic runs**: the
`container-client` "backend" executes **in the renderer process**, not the main
process. Privileged Node I/O is injected into it from the **preload** through
Electron's `contextBridge`. The main process is the thin privileged shell.

```mermaid
flowchart TB
  dev([Developer / Operator]):::person

  subgraph app[container-desktop]
    direction TB

    main["Electron Main process<br/>(electron-shell/main.ts)<br/>window &amp; app lifecycle, terminal,<br/>file dialogs, owns userConfiguration"]:::container

    subgraph rp[Renderer process]
      direction TB
      web["Web-app world<br/>(web-app/ + container-client/)<br/>React UI + engine orchestration"]:::container
      preload["Preload bridge — Node world<br/>(electron-shell/preload.ts,<br/>platform/node-executor.ts)<br/>Command · FS · Platform · Path · MessageBus"]:::container
    end

    relay["Go relay<br/>(support/container-desktop-relay)<br/>SSH ↔ unix-socket / named-pipe bridge"]:::container
  end

  engines[(Container engine sockets:<br/>Podman / Docker · local · VM ·<br/>WSL · remote SSH)]:::external

  dev -->|interacts| web
  web -->|"window.Command / FS / Platform / Path<br/>(contextBridge, in-process)"| preload
  web -.->|"window.MessageBus (IPC):<br/>window, terminal, dialogs"| main
  preload -->|spawns CLIs, HTTP-over-socket,<br/>SSH; spawns relay| engines
  preload -->|launch / supervise| relay
  relay -.->|forwards socket traffic| engines

  classDef person fill:#08427b,color:#fff,stroke:#052e56;
  classDef container fill:#438dd5,color:#fff,stroke:#2e6295;
  classDef external fill:#8a8a8a,color:#fff,stroke:#5e5e5e;
```

### The pieces

- **Electron Main process** — `src/electron-shell/main.ts`. Creates the
  `BrowserWindow`, handles app/window lifecycle and a small set of IPC channels
  (`window.*`, `application.*`, `openTerminal`, `openFileSelector`, `notify`), and
  owns `userConfiguration` (settings persistence). It does **not** broker engine
  calls.
- **Renderer process** — one OS process, two JavaScript worlds kept apart by
  `contextIsolation`:
  - **Web-app world** — `src/web-app/` (React UI) plus the bundled
    `src/container-client/` engine logic. This is where a connection is composed
    and driven (see [backend.md](backend.md)). It has no direct Node access.
  - **Preload bridge** — `src/electron-shell/preload.ts` exposes the real
    Node-side primitives from `src/platform/` via `contextBridge`:
    `Command` (process spawn, `ProxyRequest` = HTTP over a unix socket / named
    pipe, `StartSSHConnection`), `FS`, `Platform`, `Path`, and `MessageBus`.
    Engine I/O physically happens here, in Node.
- **Go relay** — `support/container-desktop-relay/`. A spawned helper that bridges a
  Windows named pipe to a Unix socket — inside **WSL** via a stdio bridge (no SSH server in
  the distro), or to a **remote host over SSH** on Windows. Linux/macOS remote SSH uses the
  native `ssh` client instead. See [connection-startup.md](connection-startup.md).
- **External engines** — Podman/Docker REST sockets, reachable directly (native),
  through a VM (machine/Lima), through WSL, or across SSH.

### Build/runtime note (don't relearn the hard way)

Source is ESM/TypeScript, but **main and preload are bundled to CommonJS** —
Electron's API only links via the CJS `require` hook — while the **renderer stays
ESM**. Production needs `ENVIRONMENT=production`. Full details live in
[`CLAUDE.md`](../../CLAUDE.md) → *Build / runtime model*; they are not repeated
here.

## Source map

| Piece | Path |
| --- | --- |
| Main process | [`src/electron-shell/main.ts`](../../src/electron-shell/main.ts) |
| Preload bridge | [`src/electron-shell/preload.ts`](../../src/electron-shell/preload.ts) |
| Node primitives (`Command`) | [`src/platform/node-executor.ts`](../../src/platform/node-executor.ts) · [`src/platform/node.ts`](../../src/platform/node.ts) |
| IPC bus | [`src/electron-shell/shared.ts`](../../src/electron-shell/shared.ts) |
| Engine logic (backend) | [`src/container-client/`](../../src/container-client/) |
| React renderer (frontend) | [`src/web-app/`](../../src/web-app/) |
| Go relay | [`support/container-desktop-relay/`](../../support/container-desktop-relay/) |
