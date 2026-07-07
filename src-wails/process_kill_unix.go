//go:build !windows

package main

import (
	"os"
	"syscall"
)

// deliverSignal sends a POSIX signal to the process (Linux/macOS) — the analog of process.rs deliver_signal's
// libc::kill arm. A no-op error (e.g. ESRCH when the child already exited) is ignored.
func deliverSignal(process *os.Process, sig int) {
	_ = process.Signal(syscall.Signal(sig))
}
