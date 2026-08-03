# Platform Ports

`src/packages/platform/src/` has two runtime implementations:

- `platform/tauri/` — Tauri webview bridge plus Rust-backed host capabilities.
- `platform/wails/` — Wails v3 (Go) webview bridge plus Go-backed host capabilities.

Shared platform services and ports live directly at `platform/*.ts` (for example `engineDataService.ts`,
`resourceSyncBroker.ts`, `trayMenu.ts`, and the AI client/bus in `webviewAI.ts` — both shells host the AI
subsystem in the webview realm, so neither needs its own). Do not create a third runtime-like bucket for
shared code.

Concept names are intentionally aligned across both folders. If a high-level capability exists in one runtime,
the same file name should normally exist in the others. The folder name carries the runtime; module names carry the
concept. Wails is architecturally a twin of Tauri (a system webview hosting the same renderer, native code reached
over a JS↔native call/event bridge), so `platform/wails/` mirrors `platform/tauri/` file-for-file — the only
difference is the bridge seam: Tauri's `@tauri-apps/api` `invoke`/`Channel` vs Wails' `@wailsio/runtime`
`Call.ByName`/`Events`, both isolated in `bridge.ts`.

## Aligned Concepts

| Concept                        | Tauri                   | Wails                   |
| ------------------------------ | ----------------------- | ----------------------- |
| AI broker host                 | `aiSystemHost.ts`       | `aiSystemHost.ts`       |
| AI capability assembler        | `aiSystem.ts`           | `aiSystem.ts`           |
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

Tauri and Wails are architectural twins, so the folders mirror each other almost exactly. What differs is
only ever the bridge seam.

| Runtime      | Module                   | Why it is one-sided                                                                                       |
| ------------ | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| Tauri        | `providerTransport.ts`   | Tauri routes keyed provider requests through Rust so the secret never enters the webview realm.            |
| Tauri, Wails | `inRealmBus.ts`          | Both run several broker/client pairs in one webview realm, so they need an in-memory bus.                  |
| Tauri, Wails | `linkPolicy.ts`          | Webview link handling must account for the webview origin and opener behavior.                             |
| Tauri, Wails | `capabilities/invoke.ts` | Webview capabilities cross into native code through an `invoke` shim (Tauri → Rust, Wails → Go).           |

Keeping the two folders aligned is a **review rule, not a test** — a capability added to one shell usually needs
its peer. If a new one-sided module is legitimate, document the reason here. Otherwise, align the concept instead
of creating another runtime-specific name for the
same thing.
