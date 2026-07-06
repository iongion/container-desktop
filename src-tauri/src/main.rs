// Prevents an extra console window on Windows in release; harmless elsewhere.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Note: WEBKIT_DISABLE_COMPOSITING_MODE was tried for the Wayland fractional-scaling font softness and
    // made rendering WORSE, so it is intentionally NOT set. The residual difference from Chromium/Electron is
    // inherent to WebKitGTK's GTK3 backend; only wry on GTK4 (webkitgtk-6.0) would truly resolve it. NB
    // webkit2gtk-4.1 is NOT GTK4 — it is still GTK3, differing from 4.0 only in libsoup (2→3); the GTK4 port
    // (tao/wry → gtk4-rs + webkit6) is unreleased WIP, so this is not a flag we can flip today.
    container_desktop_lib::run()
}
