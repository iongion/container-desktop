# Deferred verification

Known, unbuilt, and not bugs. Each says what has to be confirmed before it is acted on.

## Two-shell cleanup

- Go terminal argv — `src-wails/terminal_linux.go` (`linuxTerminalArgs`, `resolveExecutable`) has no test file. The Rust half is covered by `src-tauri/src/shell.rs` tests; port the same per-emulator table to a new `src-wails/terminal_linux_test.go`.
- `platform/commandProxyBroker.ts` + the `COMMAND_PROXY` channel names in `container-client/commandProxyProtocol.ts` have **no consumer but their own tests** — both shells invoke their native proxy directly (`{tauri,wails}/exec/proxy-request.ts`). Decide: delete the broker + channel constants, or keep them as the seam for a future shell whose engine HTTP crosses a process boundary. Do not delete before confirming no forwarding path is meant to route through it.
- `platform/appConfig.ts` likewise has **no consumer but its own test**. Window geometry is now native (`tauri_plugin_window_state`, `src-wails/window_state.go`), so `get/setWindowConfig` is superseded. Before deleting, confirm `isHideToTrayOnClose`'s `minimizeToSystemTray || trayWidgetEnabled` semantics still hold: the native close hooks arm hide-to-tray on **tray presence** alone (`src-tauri/src/lib.rs` `TrayState`, `src-wails/tray_service.go` `trayActive`), and the Settings → Startup toggle writes `minimizeToSystemTray`.
- Docs and a few comments still cite **pre-monorepo paths** (`src/platform/…`, `src/container-client/…`, `src/env/Types.ts`) instead of `src/packages/<pkg>/src/…`. Worth one mechanical sweep.

## AI subsystem

- **Off-host execution has a capability but no consumer.** `platform/src/capabilities/{connectionExec,execWorkspaceAccess,executionSelector}.ts` implement the host / remote / container / sandbox backends and are injected into the broker, but the assistant runs its tools inside the agent container, so nothing selects a target. They survive as a capability plus the mock-only `__aiOffHostProbe` seam that `webdriver/specs/off-host-exec.e2e.js` drives. Decide: bind them to something real, or delete them with their specs.
- **Five prompt templates have no loader.** `src/resources/prompts/{thread-compaction,thread-compaction-context,thread-compaction-request,knowledge-bank}.md` belonged to the app's own compaction and troubleshooting paths, which the container session replaced (pi owns compaction), and `workspace-tool-descriptions.md` belongs to the workspace toolset above. Delete them with the capability, or wire them back when it is bound.
- **How the AI subsystem is tested** — the two lenses (hermetic Vitest, and live specs against a real model and a real engine) are documented in [`testing.md`](testing.md), which is authoritative. This file does not restate them.
