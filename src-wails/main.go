// Command container-desktop is the Wails v3 host shell — the Go analog of src-tauri. It embeds the
// shared renderer (built into frontend/dist) and exposes the native host ports (Platform, Fs, ...)
// as Wails services the renderer reaches through the wails invoke bridge. See
// docs/architecture/platform-ports.md.
package main

import (
	"embed"
	"log/slog"
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// The shared renderer is built DIRECTLY into frontend/dist by `yarn wails:renderer` (Vite with
// --outDir src-wails/frontend/dist — the identical bundle Electron/Tauri build, just emitted here
// instead of copied). go:embed cannot traverse ".." (and does not follow symlinks), so the bundle
// must live inside this package; building it in place avoids a second copy of build/<version>. It is
// served from the binary over AssetFileServerFS — mirroring Tauri's frontendDist.
//
//go:embed all:frontend/dist
var assets embed.FS

// mainWindow is the single app window, stored so ShellService.ToggleDevtools can reach it (Wails' App has no
// CurrentWindow() accessor).
var mainWindow *application.WebviewWindow

// devMode enables the WebKitGTK inspector / WebView2 DevTools (and the WebDriver automation path)
// outside production, matching the Electron/Tauri dev experience.
func devMode() bool {
	return os.Getenv("ENVIRONMENT") != "production"
}

func main() {
	// A relaunched child (ShellService.Relaunch) blocks here until the previous instance has exited, so the
	// single-instance lock is free before we take it below. A normal launch returns immediately (see relaunch.go).
	awaitPredecessorExit()

	app := application.New(application.Options{
		Name:        "Container Desktop",
		Description: "Manage container engines — Podman, Docker, Apple Container",
		Services: []application.Service{
			application.NewService(&PlatformService{}),
			application.NewService(&FsService{}),
			application.NewService(&KeychainService{}),
			application.NewService(&ExecService{}),
			application.NewService(&ProxyService{}),
			application.NewService(&ProcessService{}),
			application.NewService(&BridgeService{}),
			application.NewService(&ShellService{}),
			application.NewService(&TrayService{}),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		// A second launch focuses the running window instead of starting a rival process — disabled under
		// CONTAINER_DESKTOP_E2E so the capture/WebDriver harness runs standalone (mirrors src-tauri/src/lib.rs).
		SingleInstance: singleInstanceOptions(),
	})

	// Frameless window matching src-tauri/tauri.conf.json (1280x800, min 960x718, decorations off,
	// resizable, centered). Custom drag/resize + window controls are JS-driven in the renderer's
	// wails/windowManager.ts via @wailsio/runtime, exactly as the Tauri chrome works.
	//
	// Start HIDDEN and reveal only when the renderer signals ready (App.tsx AppBootstrapReadySignal →
	// messageBus.showWindow → appWindow.Show()), exactly like Tauri (tauri.conf.json visible:false) and
	// Electron (show-on-ready). Otherwise a frameless webview maps INSTANTLY as a blank window and the real
	// UI only paints ~0.7s later — the "slow startup" flash. The error path still reveals it (bridge.ts catch
	// → Window.Show()) so a failed boot never leaves an invisible window.
	windowOptions := application.WebviewWindowOptions{
		Title:            "Container Desktop",
		Width:            1280,
		Height:           800,
		MinWidth:         960,
		MinHeight:        718,
		Frameless:        true,
		Hidden:           true,
		InitialPosition:  application.WindowCentered, // match tauri.conf.json center:true (explicit now the window is hidden→shown)
		BackgroundColour: application.NewRGB(26, 5, 28),
		// Always the Wails origin — NEVER an external URL: the @wailsio/runtime JS↔Go transport is only wired
		// on the Wails-served origin (loading http://localhost:3000 directly breaks Call.ByName). Hot-reload dev
		// still works: `yarn wails:dev` sets FRONTEND_DEVSERVER_URL=http://localhost:3000 and the AssetServer
		// (application_dev.go, //go:build !production) PROXIES to Vite — same :3000 server as Electron/Tauri,
		// but the window stays on the Wails origin. Production (-tags production) serves the embedded bundle.
		URL: "/",
		// App-owned detection marker: Wails v3's @wailsio/runtime no longer publishes window.wails,
		// so the renderer's isWailsRuntime() checks this deterministic global (set at document start).
		JS:              "window.__CONTAINER_DESKTOP_WAILS__ = true;",
		DevToolsEnabled: devMode(),
	}
	// Restore the saved position + size (NOT visibility — the window stays hidden until the renderer signals
	// ready, like Tauri's window-state plugin with !VISIBLE); absent/corrupt state keeps the centered defaults.
	if bounds, ok := loadWindowState(); ok {
		windowOptions.X, windowOptions.Y = bounds.X, bounds.Y
		windowOptions.Width, windowOptions.Height = bounds.Width, bounds.Height
		windowOptions.InitialPosition = application.WindowXY
	}
	mainWindow = app.Window.NewWithOptions(windowOptions)
	installWindowBehaviours(mainWindow)

	runErr := app.Run()
	// Honor a relaunch request here — once the app has fully stopped and released the single-instance lock — so
	// the successor starts cleanly instead of forwarding to the exiting instance (see relaunch.go).
	if relaunchPending {
		if err := spawnSuccessor(); err != nil {
			slog.Error("container-desktop wails relaunch failed", "error", err)
		}
	}
	if runErr != nil {
		slog.Error("container-desktop wails shell exited", "error", runErr)
		os.Exit(1)
	}
}

// singleInstanceOptions guards against a second running copy: a 2nd launch focuses the running window (un-hiding
// it from the tray) instead of starting a rival process + rival engine connections. Disabled under
// CONTAINER_DESKTOP_E2E so the capture/WebDriver harness can launch its own instance beside the dev app. UniqueID
// mirrors the Wails bundle identifier (distinct from the Tauri build, so their locks never collide).
func singleInstanceOptions() *application.SingleInstanceOptions {
	if _, e2e := os.LookupEnv("CONTAINER_DESKTOP_E2E"); e2e {
		return nil
	}
	return &application.SingleInstanceOptions{
		UniqueID: "com.iongion.container-desktop.wails",
		OnSecondInstanceLaunch: func(application.SecondInstanceData) {
			// Runs on the FIRST instance (a background goroutine). Reveal + focus the window the 2nd launch meant
			// to open, matching src-tauri/src/lib.rs's single-instance callback.
			if mainWindow != nil {
				mainWindow.UnMinimise()
				mainWindow.Show()
				mainWindow.Focus()
			}
		},
	}
}

// installWindowBehaviours wires the two native window behaviours that mirror the Tauri shell:
//   - Hide-to-tray: while the tray is up, the window's close button HIDES it (keeping the webview + the in-realm
//     engine hub alive) instead of destroying it — Electron's default and src-tauri/src/lib.rs. It must be a
//     RegisterHook (not OnWindowEvent): a cancelled hook stops Wails' default destroy listener (HandleWindowEvent
//     returns on a cancelled hook). A true quit (tray Quit → Application.Quit → impl.destroy) bypasses
//     WindowClosing, so it is unaffected.
//   - Window-state persistence: save position + size on move/resize (debounced ~50ms on Linux). The events carry
//     no geometry, so read it off the window. Mirrors tauri-plugin-window-state.
func installWindowBehaviours(window *application.WebviewWindow) {
	window.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if trayActive.Load() {
			e.Cancel()
			window.Hide()
		}
	})
	persist := func(*application.WindowEvent) {
		rect := window.Bounds()
		saveWindowState(windowBounds{X: rect.X, Y: rect.Y, Width: rect.Width, Height: rect.Height})
	}
	window.OnWindowEvent(events.Common.WindowDidMove, persist)
	window.OnWindowEvent(events.Common.WindowDidResize, persist)
}
