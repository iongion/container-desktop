# System tray — independent popover (C4 L2/L3)

The tray widget is a compact React popover that mirrors the **main process's** engine data, so it keeps
working whether or not the main application window is open. It is not a second copy of the app: the main
process is the single engine authority — it owns the connection, the data, and command execution (see
[backend.md](backend.md)) — and every window, the app and the tray popover alike, is a thin consumer of that
one source.

## How the popover gets its data (no second pipeline)

The popover does **not** build or receive a bespoke "tray snapshot". It consumes the SAME data main already
shares with every window:

- **Standing data — container/pod lists + current connection:** the popover reads the main-owned
  `ResourceSyncSnapshot` over the resource-sync channel — the exact push the main app's screens mirror (see
  [backend.md → Main-owned data layer](backend.md#main-owned-data-layer)). Each window keeps its own copy,
  synced by main's pushes; the popover gets the read-only snapshot pull plus every change push.
- **Tray-only live extras — theme, machines, per-container stats:** these are not shareable standing data
  (stats especially are transient and only wanted while the popover is visible). So `TrayController` fetches
  them from main on a small **active-gated** timer — only while the popover is shown — and pushes them over a
  single `tray:live` channel. The popover formats stats locally (keeping the cross-ping CPU delta).

From those two inputs the popover projects its view-model with `buildTraySnapshot()` **locally**
([snapshot.ts](../../src/web-app/tray/snapshot.ts) +
[grouping.ts](../../src/web-app/screens/Container/grouping.ts)), reusing the **main Containers screen's
grouping** so the tray tree matches the main list (compose-project / name-prefix groups, "Pod
infrastructure" pinned on top). The projection runs in the renderer where it belongs — the main process
never imports renderer/UI code.

## Actions run in main

The popover never holds an engine connection of its own and never calls adapters. An action — start / stop /
pause / restart a container, pod or machine — is an invoke to main, which executes it against its **own**
connection through the container-client adapters. This is precisely what lets the tray act with the main
window closed.

A **connection switch** is the one action an open main window should follow: main forwards it to the
authority window (`tray:switch-connection`), which re-runs its normal `startApplication` path (full connector
and capabilities); with no main window, main simply switches its own data connection.

## Runtime shape

```mermaid
flowchart TB
  user([Developer / Operator]):::person

  subgraph main[Electron main process]
    direction TB
    appMain["main.ts<br/>composition root"]:::component
    engine["EngineDataService<br/>one connection · data · actions · tray-live"]:::component
    trayController["TrayController<br/>Electron Tray · popover window<br/>tray:live timer · action executor"]:::component
  end

  subgraph renderer[Renderer processes]
    direction TB
    appWin["Main app window<br/>screens mirror main's data"]:::component
    popover["Tray popover<br/>index.html#tray → TrayApp"]:::component
  end

  user -->|click tray icon / menu| trayController
  appMain --> trayController
  appMain --> engine
  trayController -->|fetch tray-live · run action| engine
  engine -.->|ResourceSync snapshot (every window)| appWin
  engine -.->|ResourceSync snapshot| popover
  trayController -.->|tray:live (active-gated)| popover
  popover -.->|tray:action / resize / show / quit| trayController

  classDef person fill:#08427b,color:#fff,stroke:#052e56;
  classDef component fill:#85bbf0,color:#000,stroke:#5d82a8;
```

`TrayController` is the main-process broker: it owns the Electron `Tray`, the frameless popover
`BrowserWindow`, popover positioning, the active-gated `tray:live` timer, and the action executor. It only
accepts popover messages from the tray `BrowserWindow`.

## Platform behavior

| Platform / shell                                  | Tray                                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| macOS                                             | Electron tray icon; click toggles the React popover; native menu fallback (Open widget / Quit). |
| Windows                                           | Electron tray icon; click toggles the React popover; native menu fallback.                      |
| Linux where Electron tray click events work       | Electron tray click toggles the React popover; native tray menu.                                |
| Linux AppIndicator / StatusNotifier-only desktops | Native menu is the reliable contract (Open widget / Quit).                                      |

The tray is a normal Electron `Tray` on every platform; there is no GNOME Shell extension or external shell
bridge.

## Tray IPC protocol

Two parties:

| Party                          | Role                                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main broker (`TrayController`) | Owns the Electron Tray, the popover window, positioning, and the active-gated `tray:live` timer. Executes popover actions against main's connection. Validates message origin. |
| Popover renderer (`TrayApp`)   | Mirrors main's shared `ResourceSyncSnapshot` + the `tray:live` push, projects the compact UI locally, and sends actions / resize / show-main / quit. Holds no repeating timer.  |

Channels ([protocol.ts](../../src/web-app/tray/protocol.ts)):

- `tray:action` — popover → main (invoke): main executes it (container/pod/machine lifecycle, or
  `connection.switch`) and replies with the outcome.
- `tray:live` — main → popover (push, active-gated): theme + machines + raw container stats, only while
  visible.
- `tray:switch-connection` — main → authority: an open main window follows a tray-initiated connection switch.
- `tray:resize` / `tray:show-app` / `tray:quit` — popover → main.

The only repeating tray work is main's `tray:live` fetch, and it exists **only while the popover is visible**
— so the tray never becomes a second background poller.

## Design constraints

- Keep `main.ts` a composition root. Tray behavior belongs in `TrayController`.
- Keep the React tray UI platform-neutral. Platform-specific behavior stops at window creation and
  positioning.
- Keep `TrayBus` allowlisted: a renderer subscribes only to tray channels, and the raw Electron event never
  crosses into the renderer world.
- The popover is a **consumer, not an authority**: it never opens its own engine connection and never imports
  engine adapters — it reads main's data and asks main to act.

## Source map

| Piece                           | Path                                                                                                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Popover UI                      | [`src/web-app/tray/TrayApp.tsx`](../../src/web-app/tray/TrayApp.tsx) · [`tray.css`](../../src/web-app/tray/tray.css)                                                                                   |
| Local projection                | [`src/web-app/tray/snapshot.ts`](../../src/web-app/tray/snapshot.ts) · [`screens/Container/grouping.ts`](../../src/web-app/screens/Container/grouping.ts)                                              |
| Stats formatter                 | [`src/web-app/tray/stats-format.ts`](../../src/web-app/tray/stats-format.ts)                                                                                                                           |
| Tray protocol / types           | [`src/web-app/tray/protocol.ts`](../../src/web-app/tray/protocol.ts)                                                                                                                                   |
| Tray controller / broker        | [`src/electron-shell/trayController.ts`](../../src/electron-shell/trayController.ts)                                                                                                                   |
| Tray positioning                | [`src/electron-shell/trayPositioner.ts`](../../src/electron-shell/trayPositioner.ts)                                                                                                                   |
| Preload receive bridge          | [`src/electron-shell/trayBus.ts`](../../src/electron-shell/trayBus.ts)                                                                                                                                 |
| Main-side data / actions / live | [`src/electron-shell/engineDataService.ts`](../../src/electron-shell/engineDataService.ts)                                                                                                            |
| Renderer split                  | [`src/web-app/index.tsx`](../../src/web-app/index.tsx) · [`src/web-app/App.render.tsx`](../../src/web-app/App.render.tsx) · [`src/web-app/tray/renderTray.tsx`](../../src/web-app/tray/renderTray.tsx) |
| Main composition root           | [`src/electron-shell/main.ts`](../../src/electron-shell/main.ts)                                                                                                                                       |
