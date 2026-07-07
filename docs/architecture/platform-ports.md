# Platform Ports

`src/platform/` has three runtime implementations:

- `platform/electron/` — Electron main/preload plus the Node-backed host capabilities.
- `platform/tauri/` — Tauri webview bridge plus Rust-backed host capabilities.
- `platform/wails/` — Wails v3 (Go) webview bridge plus Go-backed host capabilities.

Shared platform services and ports live directly at `platform/*.ts` (for example `engineDataService.ts`,
`resourceSyncBroker.ts`, `trayMenu.ts`, `logger/`). Do not create a fourth runtime-like bucket for shared code.

Concept names are intentionally aligned across the three folders. If a high-level capability exists in one runtime,
the same file name should normally exist in the others. The folder name carries the runtime; module names carry the
concept. Wails is architecturally a twin of Tauri (a system webview hosting the same renderer, native code reached
over a JS↔native call/event bridge), so `platform/wails/` mirrors `platform/tauri/` file-for-file — the only
difference is the bridge seam: Tauri's `@tauri-apps/api` `invoke`/`Channel` vs Wails' `@wailsio/runtime`
`Call.ByName`/`Events`, both isolated in `bridge.ts`.

## Aligned Concepts

| Concept                        | Electron                | Tauri                   | Wails                   |
| ------------------------------ | ----------------------- | ----------------------- | ----------------------- |
| AI broker host                 | `aiSystemHost.ts`       | `aiSystemHost.ts`       | `aiSystemHost.ts`       |
| AI capability assembler        | `aiSystem.ts`           | `aiSystem.ts`           | `aiSystem.ts`           |
| AI client bridge               | `aiClient.ts`           | `aiClient.ts`           | `aiClient.ts`           |
| AI receive bus                 | `aiBus.ts`              | `aiBus.ts`              | `aiBus.ts`              |
| Command facade                 | `command.ts`            | `command.ts`            | `command.ts`            |
| Command implementation modules | `exec/`                 | `exec/`                 | `exec/`                 |
| Engine API proxy client        | `commandProxyClient.ts` | `commandProxyClient.ts` | `commandProxyClient.ts` |
| Host OS / FS / path ports      | `host.ts`               | `host.ts`               | `host.ts`               |
| Logging adapters               | `log/`                  | `log/`                  | `log/`                  |
| Message bus                    | `messageBus.ts`         | `messageBus.ts`         | `messageBus.ts`         |
| Recovery                       | `recovery.ts`           | `recovery.ts`           | `recovery.ts`           |
| Resource receive bus           | `resourceBus.ts`        | `resourceBus.ts`        | `resourceBus.ts`        |
| Resource sync host             | `resourceSyncHost.ts`   | `resourceSyncHost.ts`   | `resourceSyncHost.ts`   |
| Runtime detection              | `detect.ts`             | `detect.ts`             | `detect.ts`             |
| Runtime shell helpers          | `runtime.ts`            | `runtime.ts`            | `runtime.ts`            |
| Security/AI capabilities       | `capabilities/`         | `capabilities/`         | `capabilities/`         |
| Startup proxy env bootstrap    | `proxyBootstrap.ts`     | `proxyBootstrap.ts`     | `proxyBootstrap.ts`     |
| Tray controller                | `trayController.ts`     | `trayController.ts`     | `trayController.ts`     |
| Tray receive bus               | `trayBus.ts`            | `trayBus.ts`            | `trayBus.ts`            |
| Window controls                | `windowManager.ts`      | `windowManager.ts`      | `windowManager.ts`      |

## Intentional Asymmetries

The two webview backends (Tauri, Wails) share the same shape, so their one-sided modules sit opposite Electron.

| Runtime               | Module                                                 | Why it is one-sided                                                                                              |
| --------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Electron              | `main.ts`, `preload.ts`                                | Electron has explicit main/preload entrypoints. Tauri's are Rust + `bridge.ts`; Wails' are Go + `bridge.ts`.    |
| Electron              | `contextMenu.ts`                                       | Electron owns the renderer context-menu integration through Electron APIs.                                      |
| Electron capabilities | `credentialsFs.ts`                                     | Electron's keychain fallback stores encrypted provider credentials in a Node FS file.                           |
| Electron exec         | `api-driver.ts`, `ssh-stdio-bridge.ts`, `wsl-relay.ts` | Electron runs Node HTTP + local bridge servers directly. Tauri's data plane is Rust-backed, Wails' is Go-backed. |
| Tauri, Wails          | `inRealmBus.ts`                                         | The webview backends run several broker/client pairs in one webview realm, so they need an in-memory bus.        |
| Tauri, Wails          | `linkPolicy.ts`                                         | Webview link handling must account for the webview origin and opener behavior.                                   |
| Tauri, Wails          | `capabilities/invoke.ts`                               | Webview capabilities cross into native code through an `invoke` shim (Tauri → Rust, Wails → Go).                 |

The layout is enforced by [`platformLayout.test.ts`](../../src/platform/platformLayout.test.ts), which asserts the
three folders stay aligned (Wails mirrors Tauri). If a new one-sided module is legitimate, add it to that test with
the reason documented here. Otherwise, align the concept instead of creating another runtime-specific name for the
same thing.
