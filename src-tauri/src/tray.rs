// The native system tray (Phase D). The MENU is projected in the webview from the SHARED buildTrayMenuTemplate
// (src/platform/tauri/trayController.ts) fed by the in-realm EngineDataService, and pushed here as a serializable node
// tree. This builds the native Menu and (re)sets it on a single persistent TrayIcon. A menu click emits
// `tray://action` with the clicked item's id back to the webview, which invokes the matching closure →
// EngineDataService.performAction. The icon is the connected engine's brand mark (podman/docker/unified) in a
// light/dark variant chosen from the OS theme so it contrasts with the tray/menu-bar background — parity with
// Electron's TrayController. Rebuilds are driven + JSON-deduped on the JS side.

use std::sync::Mutex;

use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{IsMenuItem, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, Theme, Wry};

pub const TRAY_ACTION_EVENT: &str = "tray://action";

// Matches src/platform/tauri/trayController.ts TrayMenuNode: a separator; a submenu (items); a clickable leaf (id); or
// a disabled label (no id, enabled:false).
#[derive(Deserialize)]
pub struct MenuNode {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    label: String,
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default)]
    separator: bool,
    #[serde(default)]
    items: Option<Vec<MenuNode>>,
}
fn default_true() -> bool {
    true
}

#[derive(Default)]
pub struct TrayState {
    icon: Mutex<Option<TrayIcon>>,
    // Last engine key applied to the native icon. Re-applying the SAME icon via set_icon on every menu refresh
    // blanks the tray on some Linux SNI hosts, so we only call set_icon when the engine key actually changes.
    icon_key: Mutex<Option<String>>,
}
impl TrayState {
    /// Whether the tray is up — drives hide-to-tray-on-close (lib.rs CloseRequested).
    pub fn is_active(&self) -> bool {
        self.icon.lock().unwrap().is_some()
    }
}

/// (Re)build the native tray menu from the projected node tree, creating the single TrayIcon on first call.
/// Sync so it runs on the main thread (tray/menu construction requires it).
#[tauri::command]
pub fn tray_update(
    app: AppHandle,
    items: Vec<MenuNode>,
    tooltip: Option<String>,
    icon: Option<String>,
    state: tauri::State<'_, TrayState>,
) -> Result<(), String> {
    let menu = build_menu(&app, &items).map_err(|e| e.to_string())?;
    let mut guard = state.icon.lock().unwrap();
    match guard.as_ref() {
        Some(tray) => {
            tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
            if let Some(tip) = tooltip {
                let _ = tray.set_tooltip(Some(tip));
            }
            // Only re-apply the native icon when the engine key actually changes — re-setting the same icon on
            // every menu refresh blanks the tray on some Linux SNI hosts (the icon is fine at creation).
            let mut key = state.icon_key.lock().unwrap();
            if *key != icon {
                if let Some(image) = tray_icon_image(&app, icon.as_deref()) {
                    let _ = tray.set_icon(Some(image));
                    *key = icon.clone();
                }
            }
        }
        None => {
            let mut builder = TrayIconBuilder::new().menu(&menu).show_menu_on_left_click(true).on_menu_event(
                |app: &AppHandle, event| {
                    let _ = app.emit(TRAY_ACTION_EVENT, event.id.0.clone());
                },
            );
            if let Some(image) = tray_icon_image(&app, icon.as_deref()) {
                builder = builder.icon(image);
            } else if let Some(default_icon) = app.default_window_icon() {
                builder = builder.icon(default_icon.clone());
            }
            if let Some(tip) = tooltip {
                builder = builder.tooltip(tip);
            }
            let tray = builder.build(&app).map_err(|e| e.to_string())?;
            *guard = Some(tray);
            *state.icon_key.lock().unwrap() = icon.clone();
        }
    }
    Ok(())
}

// Pick the tray icon: the connected engine's brand mark, in a light/dark variant matching the OS theme so it
// contrasts with the tray/menu-bar background (parity with Electron's nativeTheme.shouldUseDarkColors gate).
// Icons are embedded at compile time (image-png feature); an unknown/absent engine falls back to unified.
fn tray_icon_image(app: &AppHandle, engine: Option<&str>) -> Option<Image<'static>> {
    let dark = app
        .get_webview_window("main")
        .and_then(|w| w.theme().ok())
        .map(|theme| theme == Theme::Dark)
        .unwrap_or(true);
    let bytes: &[u8] = match (dark, engine) {
        (true, Some("docker")) => include_bytes!("../../src/resources/icons/trayIcon-dark-docker.png"),
        (true, Some("podman")) => include_bytes!("../../src/resources/icons/trayIcon-dark-podman.png"),
        (true, _) => include_bytes!("../../src/resources/icons/trayIcon-dark-unified.png"),
        (false, Some("docker")) => include_bytes!("../../src/resources/icons/trayIcon-light-docker.png"),
        (false, Some("podman")) => include_bytes!("../../src/resources/icons/trayIcon-light-podman.png"),
        (false, _) => include_bytes!("../../src/resources/icons/trayIcon-light-unified.png"),
    };
    Image::from_bytes(bytes).ok()
}

fn build_menu(app: &AppHandle, nodes: &[MenuNode]) -> tauri::Result<Menu<Wry>> {
    let mut builder = MenuBuilder::new(app);
    for node in nodes {
        builder = builder.item(build_item(app, node)?.as_ref());
    }
    builder.build()
}

fn build_item(app: &AppHandle, node: &MenuNode) -> tauri::Result<Box<dyn IsMenuItem<Wry>>> {
    if node.separator {
        return Ok(Box::new(PredefinedMenuItem::separator(app)?));
    }
    if let Some(items) = &node.items {
        let mut submenu = SubmenuBuilder::new(app, &node.label);
        for child in items {
            submenu = submenu.item(build_item(app, child)?.as_ref());
        }
        return Ok(Box::new(submenu.build()?));
    }
    let mut item = MenuItemBuilder::new(&node.label).enabled(node.enabled);
    if let Some(id) = &node.id {
        item = item.id(id.clone());
    }
    Ok(Box::new(item.build(app)?))
}
