//go:build linux

package main

import (
	"os/exec"
	"syscall"
)

// configureDeathWithParent asks the kernel to kill this child when the app dies — the Wails twin of
// src-tauri/src/child_guard.rs, and the same decision: only Linux has a kernel mechanism this app can reach, so only
// Linux gets one. See that file for why Windows is not done and why macOS never will be.
//
// It matters because a KILLED app runs none of this program's own cleanup: an `ssh -NL` forward it spawned keeps a
// local port and an SSH connection to the remote for as long as the user is logged in, and the next forward quietly
// picks a different port, so nothing looks wrong until the ports run out.
//
// `Pdeathsig` is keyed to the spawning THREAD, not the process, and Go's runtime may retire an idle OS thread — so
// this is best effort by construction rather than a guarantee.
func configureDeathWithParent(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Pdeathsig = syscall.SIGKILL
}
