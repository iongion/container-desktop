# Platform Ports

`src/packages/platform/src/` holds the shared platform services and ports at its root, and the Tauri shell's
webview side in `tauri/`.

- Shared, shell-neutral code lives directly at `platform/*.ts`: `engineDataService.ts`, `resourceSyncBroker.ts`,
  `trayMenu.ts`, `engineOpsAdapter.ts`, and the IPC registrars (`appControlIpc.ts`, `loggingIpc.ts`, `mcpIpc.ts`)
  whose transport and controller are injected.
- `platform/tauri/` binds those ports to Rust through `@tauri-apps/api` `invoke`/`Channel`, isolated in `bridge.ts`.
  The folder name carries the runtime; module names carry the concept, so a future shell would mirror these names.

## The Tauri modules

| Concept                         | Module                  |
| ------------------------------- | ----------------------- |
| Host bridge (installs globals)  | `bridge.ts`             |
| Command facade                  | `command.ts`            |
| Command implementation modules  | `exec/`                 |
| Engine API proxy client         | `commandProxyClient.ts` |
| Host OS / FS / path ports       | `host.ts`               |
| Keychain capability             | `capabilities/`         |
| Link policy                     | `linkPolicy.ts`         |
| Logging adapters                | `log/`                  |
| MCP server, webview half        | `mcpHost.ts`            |
| Message bus                     | `messageBus.ts`         |
| Recovery                        | `recovery.ts`           |
| Resource receive bus            | `resourceBus.ts`        |
| Resource sync host              | `resourceSyncHost.ts`   |
| Runtime detection               | `detect.ts`             |
| Runtime shell helpers           | `runtime.ts`            |
| Startup proxy env bootstrap     | `proxyBootstrap.ts`     |
| Tray controller                 | `trayController.ts`     |
| Tray receive bus                | `trayBus.ts`            |
| Window controls                 | `windowManager.ts`      |

## Shared modules that exist because of the webview realm

| Module          | Why                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------- |
| `inRealmBus.ts` | Several broker/client pairs run in one webview realm, so they need an in-memory bus.        |
| `urlPolicy.ts`  | Webview link handling must account for the webview origin and opener behavior.              |

Nothing above the port knows which shell answers: keep shell-specific code in `tauri/`, and shared code at the root.
