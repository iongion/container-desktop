//go:build !linux && !windows

package main

import "os/exec"

// configureDeathWithParent is a no-op off Linux and Windows — the analog of src-tauri/src/child_guard.rs, which draws
// the same line for the same reason: macOS has no mechanism at all. Both shells are deliberately aligned here, so
// neither reads as having been forgotten.
func configureDeathWithParent(_ *exec.Cmd) {}

// adoptIntoAppJob is a no-op for the same reason: there is no job object, and nothing to adopt a child into.
func adoptIntoAppJob(_ *exec.Cmd) {}
