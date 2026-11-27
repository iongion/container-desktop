// Tauri backend entry. Registers the native host-I/O commands (the Rust side of the ICommand/IPlatform/
// IFileSystem port) and runs the single frameless window that loads the shared renderer. The renderer's
// Tauri binding (src/platform/tauri/) calls these over `invoke` and exposes them as the same window.* globals
// the host bridge provides, so nothing above the port changes.

mod bridge;
mod child_guard;
mod host;
mod keychain;
mod mcp;
mod process;
mod proxy;
mod shell;
mod spawn_hidden;
mod ssh_config;
mod tray;

use tauri::webview::PageLoadEvent;
use tauri::{Manager, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_window_state::StateFlags;

const MAIN_WINDOW: &str = "main";

// The main window is tauri.conf.json's, built here (it is `create: false` there) only so an isolated run can give
// the webview its own storage: the config's dataDirectory takes relative paths only, and the override is absolute.
fn create_main_window(app: &tauri::App) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW)
        .expect("tauri.conf.json declares the main window");
    let mut builder = WebviewWindowBuilder::from_config(app.handle(), config)?;
    // Linux and Windows get a frameless window and the header draws its own window controls. macOS keeps Apple's
    // traffic lights, overlaid on the header and centred in its 50px height (Electron's "hiddenInset").
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .decorations(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(18.0, 18.0));
    }
    if let Some(dir) = host::platform::webview_data_dir() {
        builder = builder.data_directory(dir);
    }
    builder.build()?;
    Ok(())
}

/// `container-desktop --mcp-stdio`: relay MCP between stdin/stdout and the running app's loopback endpoint. Nothing
/// of the GUI starts. Returns the process exit code.
pub fn run_mcp_stdio() -> i32 {
    mcp::stdio::run()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // First, before any thread or command: a Finder/Dock launch has launchd's bare PATH, which hides every engine CLI.
    #[cfg(unix)]
    host::user_path::extend_process_path();

    // Dev ergonomics: start from the project root so RELATIVE paths — e.g. the
    // ./support/image-builders sample build context, or a "." build context — resolve against the sources dir,
    // not the src-tauri/ dir where `tauri dev` / `cargo run` launches the binary. Without this an image build's
    // relative context is spawned with the wrong cwd and fails (the dev cwd must be the
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
                if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
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
                    // with the app log file, which logs app records, not the HTTP client's guts).
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                        path: std::path::PathBuf::from(host::platform::get_user_data_path())
                            .join("logs"),
                        file_name: Some("container-desktop".into()),
                    })
                    .filter(|metadata| {
                        metadata
                            .target()
                            .starts_with(tauri_plugin_log::WEBVIEW_TARGET)
                    }),
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
        // Persistent SSH/WSL dial-stdio bridge registry (survives webview reloads; keyed per connection).
        .manage(bridge::BridgeState::default())
        // The single native tray icon (built on first tray_update from the webview's projected menu).
        .manage(tray::TrayState::default())
        // The MCP server's listener and the requests waiting for the webview's answers.
        .manage(mcp::commands::McpState::default())
        .setup(|app| {
            exit_on_termination_signals(app.handle().clone());
            Ok(create_main_window(app)?)
        })
        // A reload drops the MCP requests the old page was answering; their clients get a 504 now, not after the
        // reply timeout.
        .on_page_load(|webview, payload| {
            if webview.label() == MAIN_WINDOW && payload.event() == PageLoadEvent::Started {
                webview.state::<mcp::commands::McpState>().abandon_pending();
            }
        })
        // Hide-to-tray: while the tray is up, closing the window HIDES it (keeps the webview + the in-realm
        // engine hub alive). A true quit goes through application.exit
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
            host::platform::get_os_type,
            host::platform::get_os_arch,
            host::platform::get_darwin_major,
            host::platform::get_env_var,
            host::platform::get_home_dir,
            host::platform::get_picker_base_dir,
            host::platform::is_flatpak,
            host::platform::get_user_data_path,
            host::fs::fs_read_text_file,
            host::fs::fs_write_text_file,
            host::fs::fs_write_private_text_file,
            host::fs::fs_is_file_present,
            host::fs::fs_mkdir,
            host::fs::fs_rename,
            host::command::command_execute,
            ssh_config::get_ssh_config,
            proxy::proxy_request,
            proxy::proxy_request_stream,
            proxy::proxy_stream_destroy,
            proxy::connectivity::proxy_test_connectivity,
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
            mcp::commands::mcp_start,
            mcp::commands::mcp_stop,
            mcp::commands::mcp_status,
            mcp::commands::mcp_reply,
            mcp::commands::mcp_token,
            mcp::commands::mcp_regenerate_token,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the Container Desktop Tauri shell")
        .run(|app, event| {
            // Every exit, a Quit or a termination signal, stops the children this app started (socktainer, forwards).
            if let tauri::RunEvent::Exit = event {
                app.state::<process::ProcessState>().kill_all();
            }
        });
}

/// SIGTERM, SIGINT or SIGHUP exit the app the way Quit does, so the children it started are stopped too; the default
/// action would end the process at once and leave them running (macOS has no parent-death hook, see child_guard).
#[cfg(unix)]
fn exit_on_termination_signals(app: tauri::AppHandle) {
    use tokio::signal::unix::{signal, SignalKind};
    tauri::async_runtime::spawn(async move {
        let (Ok(mut term), Ok(mut int), Ok(mut hup)) =
            (signal(SignalKind::terminate()), signal(SignalKind::interrupt()), signal(SignalKind::hangup()))
        else {
            return;
        };
        tokio::select! {
            _ = term.recv() => {}
            _ = int.recv() => {}
            _ = hup.recv() => {}
        }
        app.exit(0);
    });
}

#[cfg(not(unix))]
fn exit_on_termination_signals(_app: tauri::AppHandle) {}
