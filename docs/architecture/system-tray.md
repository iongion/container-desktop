# System tray — native menu (C4 L2/L3)

The tray is a **native OS menu** — a Rust `TrayIcon` under Tauri, a Go `SystemTray` under Wails — so it keeps
working whether or not the main application window is open. It is not a second copy of the app: the
`EngineDataService` is the single engine authority — it owns the connection, the data, and command execution
(see [backend.md](backend.md)) — and the menu is just a projection of that one source. There is **no tray
renderer**: nothing to bootstrap, no second window.

## How the menu is built (projected in the webview, rendered natively)

`TrayController` builds the menu from `EngineDataService` — the same data the app screens read:

- **Lists + connection** come from `engineDataService.getSyncSnapshot()` (containers/pods + the current
  connector + the configured connections).
- **Machines** come from a small cache (`getMachines()`), refreshed on connect and after a machine action —
  so a frequently-rebuilt menu costs no engine call.

`engineDataService.getTrayMenuData()` projects those into a lean `TrayMenuData` and hands it to the pure
[`buildTrayMenuTemplate()`](../../src/packages/platform/src/trayMenu.ts), which returns a shell-neutral menu
template. The projection is deliberately lean (container state from `Computed.DecodedState`, no
Blueprint/grouping import) so the tray path pulls in no UI code.

**The closure problem, and the id registry.** The template carries click **closures**, which cannot cross into
Rust or Go. So `projectTrayMenu()` splits it in two: a **serializable node tree** the native side builds the
real menu from, and a **registry** mapping generated ids (`tray:<n>`) to those closures, kept in the webview
realm. A native menu click emits its id back over the shell's event channel, and the controller invokes the
matching closure. The icon variant is chosen natively (the backend reads the OS theme).

**Rebuild on change.** `engineDataService.subscribe(...)` re-projects and re-applies the menu on every data
change (connection, lists, machine action), deduped by a JSON signature of the tree. Re-applying the whole
menu is the documented way to update a tray on Linux; native menus snapshot at open, so this is how the next
open reflects fresh state.

## What the menu can and can't do

Native menus have no inline widgets, no progress bars, and can't update while open — so per-item actions are
**fly-out submenus**, not inline buttons, and there are **no live stats**. The structure:

- a disabled header (`● <connection> — <engine>`),
- a **radio** `Connection ▸` submenu when more than one connection is configured (checked = current),
- `Running (N) ▸` / `Stopped (N) ▸` container groups — each running container a `name ▸` action submenu, each
  stopped one a flat `Start "name"` — **capped** with a `Show all N in app…` escape, since native menus have
  no scrollview,
- `Pods ▸` / `Machines ▸` submenus when present,
- `Open main window` and `Quit`.

## Actions run through the engine service

The menu never holds an engine connection and never calls adapters. A click — start / stop / pause / restart
a container, pod or machine — resolves to `engineDataService.performAction(kind, id, connectionId)`, which
executes against the service's **own** connection through the container-client adapters. Every action carries
its connection id, so it routes to the owning host in a merged multi-engine workspace. This is what lets the
tray act with the main window closed.

A **connection switch** is the one action an open window should follow: the controller emits
`tray:switch-connection`, and the app re-runs its normal `startApplication` path; with the window closed, the
service simply switches its own data connection.

## Runtime shape

```mermaid
flowchart TB
  user([Developer / Operator]):::person

  subgraph realm[Webview realm]
    direction TB
    engine["EngineDataService<br/>one connection · data · actions · machines cache"]:::component
    builder["buildTrayMenuTemplate<br/>pure data → menu template"]:::component
    trayController["TrayController<br/>projects template → node tree<br/>+ id→closure registry"]:::component
    appWin["App screens<br/>read the same service"]:::component
  end

  native["Native tray<br/>tray.rs (Rust) · tray_service.go (Go)<br/>builds the real Menu on one TrayIcon"]:::component

  user -->|click / right-click tray icon| native
  engine -.->|"subscribe → re-project (JSON-deduped)"| trayController
  trayController -->|getTrayMenuData · performAction| engine
  trayController --> builder
  trayController -->|"invoke: serializable node tree + icon"| native
  native -.->|"tray://action (clicked id)"| trayController
  trayController -.->|tray:switch-connection (on switch)| appWin
  engine -.->|ResourceSync snapshot| appWin

  classDef person fill:#08427b,color:#fff,stroke:#052e56;
  classDef component fill:#85bbf0,color:#000,stroke:#5d82a8;
```

`TrayController` owns the projection and the id registry and nothing else — no window, no positioning, no
timers. The native side owns only the widget: it builds the menu it is handed and reports which id was
clicked.

## Platform behavior

| Platform / shell                           | Tray                                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS                                      | Native menu-bar item; left-click pops the menu; the menu is the full UI.                                                                        |
| Windows                                    | Native notification-area icon; left-click pops the menu, right-click shows it.                                                                  |
| Linux (StatusNotifierItem / AppIndicator)  | The context menu is the contract — activation shows it. This is the reliable cross-platform path and the main reason the tray is a native menu. |

The tray is the shell's own native tray widget on every platform; there is no GNOME Shell extension, no
external shell bridge, and no separate tray window.

## The tray's two channels

- `tray://action` — native → webview: the clicked menu item's generated id, which the controller maps back to
  the closure that runs the action.
- `tray:switch-connection` — controller → app screens: an open window follows a tray-initiated connection
  switch (re-runs `startApplication`). Subscribed in `appStore` via the allowlisted `TrayBus`.

## Design constraints

- Keep the menu builder **pure** (data in, template out) and free of renderer/UI imports, so it unit-tests as
  plain data and the tray path pulls in no UI code.
- Keep the native side dumb: a node tree in, a clicked id out. Menu *shape* lives in `trayMenu.ts`, menu
  *behavior* in `TrayController` — never in Rust or Go.
- Both shells must stay aligned; a tray change in one needs its peer.
- The tray is a **consumer, not an authority**: it never opens its own engine connection and never imports
  engine adapters — it reads the service's data and asks the service to act.

## Source map

| Piece                                   | Path                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Menu builder (pure)                     | [`platform/trayMenu.ts`](../../src/packages/platform/src/trayMenu.ts) · [`trayMenu.test.ts`](../../src/packages/platform/tests/trayMenu.test.ts)               |
| Tray controllers                        | [`tauri/trayController.ts`](../../src/packages/platform/src/tauri/trayController.ts) · [`wails/trayController.ts`](../../src/packages/platform/src/wails/trayController.ts) |
| Native tray widgets                     | [`src-tauri/src/tray.rs`](../../src-tauri/src/tray.rs) · [`src-wails/tray_service.go`](../../src-wails/tray_service.go)                                        |
| Receive bridge (follow signal)          | [`tauri/trayBus.ts`](../../src/packages/platform/src/tauri/trayBus.ts) · [`wails/trayBus.ts`](../../src/packages/platform/src/wails/trayBus.ts)                |
| Runtime data / actions / machines       | [`platform/engineDataService.ts`](../../src/packages/platform/src/engineDataService.ts)                                                                       |
| Follow-the-switch in the app            | [`src/web-app/stores/appStore.ts`](../../src/web-app/stores/appStore.ts)                                                                                       |
