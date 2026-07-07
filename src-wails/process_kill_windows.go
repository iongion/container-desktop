//go:build windows

package main

import (
	"os"
	"os/exec"
	"strconv"
)

// deliverSignal terminates the process tree by pid on Windows — there are no POSIX signals, so the number is
// ignored (mirrors process.rs deliver_signal's taskkill arm). configureHiddenWindow keeps taskkill's own console
// from flashing.
func deliverSignal(process *os.Process, _ int) {
	cmd := exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(process.Pid))
	configureHiddenWindow(cmd)
	_ = cmd.Start()
}
