// Native host-I/O commands for the Tauri shell, split by concern into submodules:
//   platform  — os/arch/env/home/user-data/flatpak/darwin-major, the IPlatform host port
//   fs        — the IFileSystem host port (read/write/private-write/mkdir/rename/present)
//   command   — the buffered process primitive (run_command / command_execute) used by exec/commander.ts
//   dns       — the host DNS-lookup capability the AI web-search SSRF guard consumes
//   workspace — the confined IWorkspaceAccess host port (read/write/edit/list/stat/glob/grep/exec)
//
// Streaming process I/O lives in process.rs; SSH/WSL bridge I/O in bridge.rs/proxy.rs; terminal/window/logging
// shell actions in shell.rs. Each submodule owns its own commands; lib.rs registers them by their full path
// (host::platform::get_os_type, …) — no re-export facade, single origin per command.

pub mod command;
pub mod dns;
pub mod fs;
pub mod platform;
pub mod workspace;
