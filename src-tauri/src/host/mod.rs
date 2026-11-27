// Native host-I/O commands for the Tauri shell, split by concern into submodules:
//   platform  — os/arch/env/home/user-data/flatpak/darwin-major, the IPlatform host port
//   fs        — the IFileSystem host port (read/write/private-write/mkdir/rename/present)
//   command   — the buffered process primitive (run_command / command_execute) used by exec/commander.ts
//   user_path — the startup PATH a Finder/Dock launch lacks (login-shell PATH + install dirs), unix only
//
// Streaming process I/O lives in process.rs; SSH/WSL bridge I/O in bridge.rs/proxy.rs; terminal/window/logging
// shell actions in shell.rs. Each submodule owns its own commands; lib.rs registers them by their full path
// (host::platform::get_os_type, …) — no re-export facade, single origin per command.

pub mod command;
pub mod fs;
pub mod platform;
#[cfg(unix)]
pub mod user_path;
