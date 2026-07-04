# Platform Ports

`src/platform/` has two runtime implementations:

- `platform/electron/` — Electron main/preload plus the Node-backed host capabilities.
- `platform/tauri/` — Tauri webview bridge plus Rust-backed host capabilities.

Shared platform services and ports live directly at `platform/*.ts` (for example `engineDataService.ts`,
`resourceSyncBroker.ts`, `trayMenu.ts`, `logger/`). Do not create a third runtime-like bucket for shared code.

Concept names are intentionally aligned across the two folders. If a high-level capability exists in one runtime,
the same file name should normally exist in the other runtime. The folder name carries the runtime; module names
carry the concept.

## Aligned Concepts

| Concept                        | Electron                | Tauri                   |
| ------------------------------ | ----------------------- | ----------------------- |
| AI broker host                 | `aiSystemHost.ts`       | `aiSystemHost.ts`       |
| AI capability assembler        | `aiSystem.ts`           | `aiSystem.ts`           |
| AI client bridge               | `aiClient.ts`           | `aiClient.ts`           |
| AI receive bus                 | `aiBus.ts`              | `aiBus.ts`              |
| Command facade                 | `command.ts`            | `command.ts`            |
| Command implementation modules | `exec/`                 | `exec/`                 |
| Engine API proxy client        | `commandProxyClient.ts` | `commandProxyClient.ts` |
| Host OS / FS / path ports      | `host.ts`               | `host.ts`               |
| Logging adapters               | `log/`                  | `log/`                  |
| Message bus                    | `messageBus.ts`         | `messageBus.ts`         |
| Recovery                       | `recovery.ts`           | `recovery.ts`           |
| Resource receive bus           | `resourceBus.ts`        | `resourceBus.ts`        |
| Resource sync host             | `resourceSyncHost.ts`   | `resourceSyncHost.ts`   |
| Runtime detection              | `detect.ts`             | `detect.ts`             |
| Runtime shell helpers          | `runtime.ts`            | `runtime.ts`            |
| Security/AI capabilities       | `capabilities/`         | `capabilities/`         |
| Startup proxy env bootstrap    | `proxyBootstrap.ts`     | `proxyBootstrap.ts`     |
| Tray controller                | `trayController.ts`     | `trayController.ts`     |
| Tray receive bus               | `trayBus.ts`            | `trayBus.ts`            |
| Window controls                | `windowManager.ts`      | `windowManager.ts`      |

## Intentional Asymmetries

| Runtime               | Module                                                 | Why it is one-sided                                                                                         |
| --------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Electron              | `main.ts`, `preload.ts`                                | Electron has explicit main/preload entrypoints. Tauri's entrypoints are Rust plus `bridge.ts`.              |
| Electron              | `contextMenu.ts`                                       | Electron owns the renderer context-menu integration through Electron APIs.                                  |
| Electron capabilities | `credentialsFs.ts`                                     | Electron's keychain fallback stores encrypted provider credentials in a Node FS file.                       |
| Electron exec         | `api-driver.ts`, `ssh-stdio-bridge.ts`, `wsl-relay.ts` | Electron can run Node HTTP and local bridge servers directly. Tauri's engine API data plane is Rust-backed. |
| Tauri                 | `inRealmBus.ts`                                        | Tauri runs several broker/client pairs in one webview realm, so it needs an in-memory invoke/send bus.      |
| Tauri                 | `linkPolicy.ts`                                        | Tauri link handling must account for the webview origin and Tauri opener behavior.                          |
| Tauri capabilities    | `invoke.ts`                                            | Tauri capabilities cross into Rust through `invoke`.                                                        |

The layout is enforced by [`platformLayout.test.ts`](../../src/platform/platformLayout.test.ts). If a new
one-sided module is legitimate, add it to that test with the reason documented here. Otherwise, align the concept
instead of creating another runtime-specific name for the same thing.
