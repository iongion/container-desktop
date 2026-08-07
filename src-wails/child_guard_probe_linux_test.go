//go:build linux

package main

import "syscall"

// Signal 0 delivers nothing and only asks whether the process is there to receive one.
func processAlive(pid int) bool {
	return syscall.Kill(pid, 0) == nil
}

func endProcess(pid int) {
	_ = syscall.Kill(pid, syscall.SIGKILL)
}
