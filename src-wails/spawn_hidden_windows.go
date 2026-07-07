//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// configureHiddenWindow prevents a console window from flashing when a GUI app spawns an engine CLI on Windows
// (mirrors src-tauri/src/spawn_hidden.rs). CREATE_NO_WINDOW (0x08000000) + HideWindow on the process attributes.
func configureHiddenWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= 0x08000000 // CREATE_NO_WINDOW
}
