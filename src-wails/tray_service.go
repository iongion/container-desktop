package main

import (
	"embed"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// trayActive reports whether the system tray has been built. main()'s hide-to-tray close hook reads it: while the
// tray is up, closing the window hides it instead of quitting (parity with src-tauri/src/lib.rs TrayState).
var trayActive atomic.Bool

// Tray icons (engine brand marks, light+dark). go:embed can't traverse "..", so they are staged into
// src-wails/assets/tray by `yarn wails:assets` from the single source src/resources/icons.
//
//go:embed assets/tray/*.png
var trayIcons embed.FS

// TrayService builds + updates the native system tray. The MENU is projected in the webview (trayController.ts)
// and pushed here as a serializable node tree; this builds a native Menu on a single persistent SystemTray, and a
// menu click emits "tray://action" with the clicked item's id back to the webview. The icon is the connected
// engine's brand mark (light+dark variants — Wails picks by OS theme). The Go analog of src-tauri/src/tray.rs.
type TrayService struct {
	mu      sync.Mutex
	tray    *application.SystemTray
	iconKey string
	iconSet bool
}

// trayMenuNode matches src/platform/wails/trayController.ts TrayMenuNode: a separator; a submenu (items); a
// clickable leaf (id); or a disabled label (no id, enabled:false).
type trayMenuNode struct {
	ID        string         `json:"id"`
	Label     string         `json:"label"`
	Enabled   *bool          `json:"enabled"`
	Separator bool           `json:"separator"`
	Items     []trayMenuNode `json:"items"`
}

type trayUpdateArgs struct {
	Items   []trayMenuNode `json:"items"`
	Tooltip string         `json:"tooltip"`
	Icon    string         `json:"icon"`
}

const trayActionEvent = "tray://action"

// Update (re)builds the native tray menu from the projected node tree, creating the SystemTray on first call.
func (s *TrayService) Update(args trayUpdateArgs) {
	s.mu.Lock()
	defer s.mu.Unlock()

	menu := application.NewMenu()
	buildTrayMenu(menu, args.Items)
	if s.tray == nil {
		s.tray = application.Get().SystemTray.New()
		trayActive.Store(true) // the window's close button now hides-to-tray instead of quitting (main.go hook)
	}
	s.tray.SetMenu(menu)
	if args.Tooltip != "" {
		s.tray.SetTooltip(args.Tooltip)
	}
	// Only re-apply the icon when the engine key changes — re-setting the same icon on every refresh can blank the
	// tray on some Linux SNI hosts (mirrors tray.rs). Wails picks the light/dark variant by OS theme.
	if !s.iconSet || s.iconKey != args.Icon {
		if light, dark, ok := trayIconBytes(args.Icon); ok {
			s.tray.SetIcon(light).SetDarkModeIcon(dark)
			s.iconKey = args.Icon
			s.iconSet = true
		}
	}
}

func buildTrayMenu(menu *application.Menu, nodes []trayMenuNode) {
	for _, node := range nodes {
		switch {
		case node.Separator:
			menu.AddSeparator()
		case node.Items != nil:
			buildTrayMenu(menu.AddSubmenu(node.Label), node.Items)
		default:
			item := menu.Add(node.Label)
			if node.Enabled != nil && !*node.Enabled {
				item.SetEnabled(false)
			}
			if node.ID != "" {
				id := node.ID // capture per item — the click emits this id back to the webview
				item.OnClick(func(*application.Context) {
					emitToRenderer(nil, trayActionEvent, id)
				})
			}
		}
	}
}

// trayIconBytes returns the light + dark PNG bytes for the engine (docker/podman, else unified).
func trayIconBytes(engine string) (light, dark []byte, ok bool) {
	key := engine
	if key != "docker" && key != "podman" {
		key = "unified"
	}
	light, lightErr := trayIcons.ReadFile("assets/tray/trayIcon-light-" + key + ".png")
	dark, darkErr := trayIcons.ReadFile("assets/tray/trayIcon-dark-" + key + ".png")
	if lightErr != nil || darkErr != nil {
		return nil, nil, false
	}
	return light, dark, true
}
