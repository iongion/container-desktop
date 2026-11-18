# Deferred verification

Known, unbuilt, and not bugs. Each says what has to be confirmed before it is acted on.

## Shell cleanup

- `platform/commandProxyBroker.ts` + the `COMMAND_PROXY` channel names in `container-client/commandProxyProtocol.ts` have **no consumer but their own tests** — the shell invokes its native proxy directly (`tauri/exec/proxy-request.ts`). Decide: delete the broker + channel constants, or keep them as the seam for a future shell whose engine HTTP crosses a process boundary. Do not delete before confirming no forwarding path is meant to route through it.
- `platform/appConfig.ts` likewise has **no consumer but its own test**. Window geometry is now native (`tauri_plugin_window_state`), so `get/setWindowConfig` is superseded. Before deleting, confirm `isHideToTrayOnClose`'s `minimizeToSystemTray || trayWidgetEnabled` semantics still hold: the native close hooks arm hide-to-tray on **tray presence** alone (`src-tauri/src/lib.rs` `TrayState`), and the Settings → Startup toggle writes `minimizeToSystemTray`.
- Docs and a few comments still cite **pre-monorepo paths** (`src/platform/…`, `src/container-client/…`, `src/env/Types.ts`) instead of `src/packages/<pkg>/src/…`. Worth one mechanical sweep.

## MCP server

- **No consent for storing the token outside an OS keychain.** The controller takes `allowDegraded`, but no setting persists it, so the boot start cannot use it. A machine without a keychain cannot run the server; the status says why. Adding it means an `mcp.allowDegradedToken` setting the boot `apply()` reads, and a checkbox shown when the keychain is degraded.
- **In-app approvals (`ask` / `remember`)** were deferred by D6: only `read-only` and `allow` ship.
