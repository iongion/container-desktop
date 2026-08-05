# Deferred verification

Known, unbuilt, and not bugs. Each says what has to be confirmed before it is acted on.

## Two-shell cleanup

- Go terminal argv — `src-wails/terminal_linux.go` (`linuxTerminalArgs`, `resolveExecutable`) has no test file. The Rust half is covered by `src-tauri/src/shell.rs` tests; port the same per-emulator table to a new `src-wails/terminal_linux_test.go`.
- `platform/commandProxyBroker.ts` + the `COMMAND_PROXY` channel names in `container-client/commandProxyProtocol.ts` have **no consumer but their own tests** — both shells invoke their native proxy directly (`{tauri,wails}/exec/proxy-request.ts`). Decide: delete the broker + channel constants, or keep them as the seam for a future shell whose engine HTTP crosses a process boundary. Do not delete before confirming no forwarding path is meant to route through it.
- `platform/appConfig.ts` likewise has **no consumer but its own test**. Window geometry is now native (`tauri_plugin_window_state`, `src-wails/window_state.go`), so `get/setWindowConfig` is superseded. Before deleting, confirm `isHideToTrayOnClose`'s `minimizeToSystemTray || trayWidgetEnabled` semantics still hold: the native close hooks arm hide-to-tray on **tray presence** alone (`src-tauri/src/lib.rs` `TrayState`, `src-wails/tray_service.go` `trayActive`), and the Settings → Startup toggle writes `minimizeToSystemTray`.
- Docs and a few comments still cite **pre-monorepo paths** (`src/platform/…`, `src/container-client/…`, `src/env/Types.ts`) instead of `src/packages/<pkg>/src/…`. Worth one mechanical sweep.

## AI subsystem

- **`addAutocompleteProvider` is still a no-op.** pi lets an extension supply completions for the composer; honouring it means a bridge round trip per keystroke for a list redrawn on every one. It belongs with the composer's own completion work, not with the surfaces.
- **A workspace target has no picker beyond a typed reference.** The start form asks for a container by name or id and a sandbox by image reference, in an `InputGroup`. A select of the connection's running containers would be better; it needs a containers-per-connection read the drawer does not have today.
- **Only OpenRouter can be signed into.** pi carries OAuth flows for Anthropic, GitHub Copilot, Kimi, xAI, Radius and openai-codex, and every one of them returns a token that expires with a refresh token beside it. This app hands the gateway ONE static secret, so those are refused with the reason rather than stored. Offering them needs a credential store that can refresh — pi's own `CredentialStore` contract is the shape, and the gateway would have to read it rather than an env file.
- **How the AI subsystem is tested** — the two lenses (hermetic Vitest, and live specs against a real model and a real engine) are documented in [`testing.md`](testing.md), which is authoritative. This file does not restate them.
