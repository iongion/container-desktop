# System tray — native menu (C4 L2/L3)

The tray is a **native OS menu** (Electron `Tray` + `Menu`) built and rebuilt in the **main process**, so it
keeps working whether or not the main application window is open. It is not a second copy of the app: the
main process is the single engine authority — it owns the connection, the data, and command execution (see
[backend.md](backend.md)) — and the menu is just a projection of that one source. There is **no tray
renderer**: nothing to bootstrap, no second window, no extra IPC.

## How the menu is built (in main, no renderer)

`TrayController` builds the menu from `EngineDataService` — the same main-owned data the app window mirrors:

- **Lists + connection** come from `engineDataService.getSyncSnapshot()` (containers/pods + the current
  connector + the configured connections).
- **Machines** come from a small cache (`getMachines()`), refreshed on connect and after a machine action —
  so a frequently-rebuilt menu costs no engine call.

`main.ts` projects those into a lean `TrayMenuData` and hands it to the pure
[`buildTrayMenuTemplate()`](../../src/platform/trayMenu.ts), which returns an Electron-style menu template.
The projection is deliberately lean (container state from `Computed.DecodedState`, no Blueprint/grouping
import) so the main bundle stays free of renderer/UI code.

**Rebuild on change.** `engineDataService.subscribe(() => trayController.refreshMenu())` rebuilds the template
and calls `setContextMenu` again on every data change (connection, lists, machine action). Re-applying the
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

## Actions run in main

The menu never holds an engine connection and never calls adapters. A click — start / stop / pause / restart
a container, pod or machine — calls `engineDataService.performAction(kind, id)`, which executes against
main's **own** connection through the container-client adapters. This is what lets the tray act with the main
window closed.

A **connection switch** is the one action an open main window should follow: main forwards it to the app
window (`tray:switch-connection`), which re-runs its normal `startApplication` path; with no window open,
main simply switches its own data connection.

## Runtime shape

```mermaid
flowchart TB
  user([Developer / Operator]):::person

  subgraph main[Electron main process]
    direction TB
    appMain["main.ts<br/>composition root · TrayMenuData projection"]:::component
    engine["EngineDataService<br/>one connection · data · actions · machines cache"]:::component
    trayController["TrayController<br/>Electron Tray + Menu<br/>refreshMenu on change"]:::component
    builder["buildTrayMenuTemplate<br/>pure data → menu template"]:::component
  end

  appWin["Main app window<br/>screens mirror main's data"]:::component

  user -->|click / right-click tray icon| trayController
  appMain --> trayController
  appMain --> engine
  engine -.->|"subscribe → refreshMenu()"| trayController
  trayController -->|getMenuData · run action| engine
  trayController --> builder
  trayController -.->|tray:switch-connection (on switch)| appWin
  engine -.->|ResourceSync snapshot| appWin

  classDef person fill:#08427b,color:#fff,stroke:#052e56;
  classDef component fill:#85bbf0,color:#000,stroke:#5d82a8;
```

`TrayController` owns the Electron `Tray` and its context menu and nothing else — no window, no positioning,
no timers. The menu's click handlers call straight into main (`performAction` / `showMainWindow` /
`quitApplication`); there is no tray IPC round-trip.

## Platform behavior

| Platform / shell                           | Tray                                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS                                      | Electron tray icon; left-click pops the menu; the menu is the full UI.                                                                          |
| Windows                                    | Electron tray icon; left-click pops the menu, right-click shows it.                                                                             |
| Linux (StatusNotifierItem / AppIndicator)  | The context menu is the contract — activation shows it. This is the reliable cross-platform path and the main reason the tray is a native menu. |

The tray is a normal Electron `Tray` on every platform; there is no GNOME Shell extension or external shell
bridge, and no separate tray window.

## The one surviving tray IPC

The menu acts in-process, so the only tray channel left is the **follow** signal:

- `tray:switch-connection` — main → app window: an open main window follows a tray-initiated connection
  switch (re-runs `startApplication`). Subscribed in `appStore` via the allowlisted `TrayBus`.

## Design constraints

- Keep `main.ts` a composition root; tray behavior lives in `TrayController`, menu shape in `trayMenu.ts`.
- Keep the menu builder **pure** (data in, template out) and free of renderer/UI imports, so it unit-tests
  without Electron and the main bundle stays lean.
- The tray is a **consumer, not an authority**: it never opens its own engine connection and never imports
  engine adapters — it reads main's data and asks main to act.

## Source map

| Piece                                   | Path                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Menu builder (pure)                     | [`src/platform/trayMenu.ts`](../../src/platform/trayMenu.ts) · [`trayMenu.test.ts`](../../src/platform/trayMenu.test.ts)                  |
| Tray controller                         | [`src/platform/electron/trayController.ts`](../../src/platform/electron/trayController.ts) |
| Receive bridge (follow signal)          | [`src/platform/electron/trayBus.ts`](../../src/platform/electron/trayBus.ts)          |
| Runtime data / actions / machines       | [`src/platform/engineDataService.ts`](../../src/platform/engineDataService.ts)                                                                   |
| TrayMenuData projection + wiring        | [`src/platform/electron/main.ts`](../../src/platform/electron/main.ts)                  |
| Follow-the-switch in the app            | [`src/web-app/stores/appStore.ts`](../../src/web-app/stores/appStore.ts)                                                                                       |
