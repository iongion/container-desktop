package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Window-state persistence — restore the window's position + size across launches, but NOT its visibility: the
// window starts hidden and is revealed only after the renderer's boot splash paints, so a restored "visible"
// would reintroduce the white flash we eliminate. The Go analog of Tauri's tauri-plugin-window-state configured
// with StateFlags::all() & !VISIBLE (src-tauri/src/lib.rs). Stored as window-state.json under the shared
// userData dir (userDataPath), so all backends resolve the same location.

const windowStateFile = "window-state.json"

// Never restore a window below the enforced minimums — a corrupt/tiny saved size would be unusable. Matches the
// MinWidth/MinHeight in main.go (and tauri.conf.json).
const (
	minWindowWidth  = 960
	minWindowHeight = 718
)

// windowBounds is the persisted geometry (position + size). Kept application-free so it is hermetically testable.
type windowBounds struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

func windowStatePath() (string, error) {
	dir, err := userDataPath()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, windowStateFile), nil
}

// loadWindowState reads the saved bounds. Returns ok=false when absent, unreadable, corrupt, or degenerate
// (below the minimum size) — so main() falls back to the centered defaults.
func loadWindowState() (windowBounds, bool) {
	path, err := windowStatePath()
	if err != nil {
		return windowBounds{}, false
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		return windowBounds{}, false
	}
	var bounds windowBounds
	if json.Unmarshal(contents, &bounds) != nil {
		return windowBounds{}, false
	}
	if bounds.Width < minWindowWidth || bounds.Height < minWindowHeight {
		return windowBounds{}, false
	}
	return bounds, true
}

// saveWindowState best-effort persists the bounds; a failure must never disrupt the app (it is called from
// debounced window move/resize handlers).
func saveWindowState(bounds windowBounds) {
	path, err := windowStatePath()
	if err != nil {
		return
	}
	if os.MkdirAll(filepath.Dir(path), 0o755) != nil {
		return
	}
	contents, err := json.Marshal(bounds)
	if err != nil {
		return
	}
	_ = os.WriteFile(path, contents, 0o644)
}
