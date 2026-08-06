//go:build !linux

package main

import "os/exec"

// configureDeathWithParent is a no-op off Linux — the analog of src-tauri/src/child_guard.rs, which draws the same
// line for the same reason. Windows could hold its children in a Job object and does not yet; macOS has no mechanism
// at all. Both shells are deliberately aligned here, so neither reads as having been forgotten.
func configureDeathWithParent(_ *exec.Cmd) {}
