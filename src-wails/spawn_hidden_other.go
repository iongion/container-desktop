//go:build !windows

package main

import "os/exec"

// configureHiddenWindow is a no-op off Windows — the analog of src-tauri/src/spawn_hidden.rs. On Windows the
// build-tagged counterpart sets CREATE_NO_WINDOW so a GUI app never flashes a console per engine CLI call.
func configureHiddenWindow(_ *exec.Cmd) {}
