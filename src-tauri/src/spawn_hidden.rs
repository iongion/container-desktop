//! A Windows GUI app flashes a console window for every child process spawned without CREATE_NO_WINDOW. The
//! engine CLI calls (host::run_command), streamed processes (process::process_spawn), the ssh/wsl relays
//! (bridge) and taskkill all spawn children, so on Windows each would pop a console — a swarm of them while
//! the app polls engine status. These helpers set the flag on Windows and are a no-op on every other platform.
//! NB launch_terminal is intentionally NOT routed through here — opening a terminal must show its window.

// CREATE_NO_WINDOW: the child process gets no console window. (winbase.h)
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Suppress the child's console window on a tokio Command. No-op off Windows.
pub fn no_window_tokio(cmd: &mut tokio::process::Command) {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    #[cfg(not(windows))]
    let _ = cmd;
}

/// Suppress the child's console window on a std Command. Only needed by the Windows-only taskkill path.
#[cfg(windows)]
pub fn no_window_std(cmd: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW);
}
