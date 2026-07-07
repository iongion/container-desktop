package main

import "testing"

// Window bounds must round-trip through window-state.json, and a below-minimum (corrupt) size must be rejected so
// the app keeps usable defaults — the Go analog of tauri-plugin-window-state's persist/restore. userDataPath
// honors CONTAINER_DESKTOP_USER_DATA_DIR, so point it at a temp dir for a hermetic check.
func TestWindowStateRoundTripAndRejectsDegenerate(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONTAINER_DESKTOP_USER_DATA_DIR", dir)

	if _, ok := loadWindowState(); ok {
		t.Fatal("expected no saved window state initially")
	}

	want := windowBounds{X: 100, Y: 120, Width: 1400, Height: 900}
	saveWindowState(want)
	got, ok := loadWindowState()
	if !ok || got != want {
		t.Fatalf("round-trip = %+v, ok=%v; want %+v, ok=true", got, ok, want)
	}

	// A below-minimum saved size is rejected (main() then keeps the centered defaults).
	saveWindowState(windowBounds{X: 0, Y: 0, Width: 10, Height: 10})
	if _, ok := loadWindowState(); ok {
		t.Fatal("expected below-minimum bounds to be rejected")
	}
}
