// Tauri backend entry. Registers the native host-I/O commands (the Rust side of the ICommand/IPlatform/
// IFileSystem port) and runs the single frameless window that loads the shared renderer. The renderer's
// Tauri binding (src/platform/tauri/) calls these over `invoke` and exposes them as the same window.* globals
// the Electron preload provides, so nothing above the port changes.

mod bridge;
mod host;
mod keychain;
mod process;
mod provider_transport;
mod proxy;
mod shell;
mod spawn_hidden;
mod ssh_config;
mod tray;

use tauri::{Manager, WindowEvent};
use tauri_plugin_window_state::StateFlags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Dev parity with Electron's `yarn dev`: start from the project root so RELATIVE paths — e.g. the
    // ./support/image-builders sample build context, or a "." build context — resolve against the sources dir,
    // not the src-tauri/ dir where `tauri dev` / `cargo run` launches the binary. Without this an image build's
    // relative context is spawned with the wrong cwd and fails (it works under Electron, whose dev cwd is the
    // repo root). CARGO_MANIFEST_DIR is src-tauri/ at compile time; its parent is the repo root. Compiled out of
    // release builds — packaged apps use absolute, user-picked context paths.
    #[cfg(debug_assertions)]
    {
        if let Some(root) = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent() {
            let _ = std::env::set_current_dir(root);
        }
    }

    let mut builder = tauri::Builder::default();
    // single-instance MUST be registered first (desktop only): a second launch focuses the running window
    // (un-hides it from the tray) instead of starting a rival process + rival engine connections.
    #[cfg(desktop)]
    {
        // A WebDriver (e2e) run launches its own instance beside the developer's app; single-instance would make
        // it forward-and-exit. Skip the plugin when the harness sets CONTAINER_DESKTOP_E2E so the test instance
        // runs standalone. No effect on normal/production launches.
        if std::env::var_os("CONTAINER_DESKTOP_E2E").is_none() {
            builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }));
        }
    }
    builder
        // Persistent file logging: forward the renderer's already level-gated records (@tauri-apps/plugin-log)
        // to userData/logs/container-desktop.log — the SAME path logging_open / logging_reveal use. Registered
        // first so it also captures other plugins' init logs; level Trace because the @/platform/logger
        // façade already gates by the user's level before forwarding (the file transport must not filter again).
        .plugin(
            tauri_plugin_log::Builder::new()
                // Replace the plugin defaults ([Stdout, LogDir]): the default LogDir would write a SECOND file at
                // a DIFFERENT path capturing all Rust-internal logs. We want ONE persistent file that matches
                // logging_open / logging_reveal and holds only the app's own records.
                .targets([
                    // The persistent app log: ONLY webview (renderer) records — the ones the
                    // @/platform/logger façade forwards, already gated to the user's level. Filtering to
                    // WEBVIEW_TARGET keeps reqwest/hyper/tokio Rust-internal spam OUT of the user's file (parity
                    // with the Electron electron-log file, which logs app records, not the HTTP client's guts).
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                        path: std::path::PathBuf::from(host::get_user_data_path()).join("logs"),
                        file_name: Some("container-desktop".into()),
                    })
                    .filter(|metadata| metadata.target().starts_with(tauri_plugin_log::WEBVIEW_TARGET)),
                    // Dev convenience: unfiltered console stream (no persistent file; a packaged app has no console).
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                // Level Trace because the façade already gates webview records by the user's level before
                // forwarding (the file transport must not filter them again).
                .level(tauri_plugin_log::log::LevelFilter::Trace)
                .build(),
        )
        // Native-shell plugins (Phase D): dialogs, opener (external links + reveal), process (relaunch/exit),
        // window-state (persist + restore bounds across launches).
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        // Persist/restore window bounds across launches, but NOT visibility: the window starts hidden
        // (tauri.conf.json visible:false) and the webview reveals it only after the themed boot splash has
        // painted (bridge.ts). Restoring a saved VISIBLE=true would re-show it before first paint — the white
        // flash we are eliminating — so drop that one flag.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        // Live-stream registry for the engine-API proxy (ProxyRequest streaming teardown).
        .manage(proxy::ProxyState::default())
        // Live-process registry for ExecuteStreaming / ExecuteAsBackgroundService (kill by processId).
        .manage(process::ProcessState::default())
        // Live-stream registry for the native AI provider transport (teardown by streamId).
        .manage(provider_transport::ProviderTransportState::default())
        // Persistent SSH/WSL dial-stdio bridge registry (survives webview reloads; keyed per connection).
        .manage(bridge::BridgeState::default())
        // The single native tray icon (built on first tray_update from the webview's projected menu).
        .manage(tray::TrayState::default())
        // Hide-to-tray: while the tray is up, closing the window HIDES it (keeps the webview + the in-realm
        // engine hub alive), matching Electron's default. A true quit goes through application.exit
        // (process.exit) or the tray's Quit item — both terminate without firing this.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<tray::TrayState>().is_active() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            host::get_os_type,
            host::get_os_arch,
            host::get_darwin_major,
            host::get_env_var,
            host::get_home_dir,
            host::get_picker_base_dir,
            host::is_flatpak,
            host::get_user_data_path,
            host::fs_read_text_file,
            host::fs_write_text_file,
            host::fs_write_private_text_file,
            host::fs_is_file_present,
            host::fs_mkdir,
            host::fs_rename,
            host::command_execute,
            host::dns_lookup,
            host::workspace_root,
            host::workspace_read,
            host::workspace_write,
            host::workspace_edit,
            host::workspace_list,
            host::workspace_stat,
            host::workspace_remove,
            host::workspace_glob,
            host::workspace_grep,
            host::workspace_exec,
            ssh_config::get_ssh_config,
            proxy::proxy_request,
            proxy::proxy_request_stream,
            proxy::proxy_stream_destroy,
            proxy::proxy_test_connectivity,
            provider_transport::provider_transport_request,
            provider_transport::provider_transport_destroy,
            process::process_spawn,
            process::process_kill,
            bridge::proxy_bridge_stop,
            shell::open_storage_folder,
            shell::open_external,
            shell::toggle_devtools,
            shell::launch_terminal,
            shell::logging_apply,
            shell::logging_open,
            shell::logging_reveal,
            keychain::keychain_status,
            keychain::keychain_has,
            keychain::keychain_set,
            keychain::keychain_clear,
            tray::tray_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Container Desktop Tauri shell");
}
