//go:build unix

package main

import (
	"os/exec"
	"syscall"
	"time"
)

// detachProcess puts the successor in its own session so it is not torn down together with the exiting parent.
func detachProcess(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setsid = true
}

// waitForProcessExit polls until pid is gone (signal 0 → ESRCH/EPERM), bounded (~5s) so a stuck predecessor can
// never hang the relaunched instance's startup.
func waitForProcessExit(pid int) {
	for range 100 {
		if err := syscall.Kill(pid, 0); err != nil {
			return // process gone
		}
		time.Sleep(50 * time.Millisecond)
	}
}
