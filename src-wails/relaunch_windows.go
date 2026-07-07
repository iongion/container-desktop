//go:build windows

package main

import (
	"os/exec"
	"syscall"
	"time"
)

// detachProcess starts the successor detached (its own process group, no inherited console) so it outlives the
// exiting parent and shows no console window. Mirrors spawn_hidden_windows.go's CreationFlags approach.
func detachProcess(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	// DETACHED_PROCESS (0x00000008) | CREATE_NEW_PROCESS_GROUP (0x00000200).
	cmd.SysProcAttr.CreationFlags |= 0x00000008 | 0x00000200
}

// waitForProcessExit: the Windows single-instance mutex releases when our process handle closes on exit; a short
// bounded wait covers that gap (Windows has no cheap kill(0) liveness probe without extra syscalls).
func waitForProcessExit(_ int) {
	time.Sleep(1200 * time.Millisecond)
}
