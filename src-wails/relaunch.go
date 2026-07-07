package main

import (
	"os"
	"os/exec"
	"strconv"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Process relaunch — the Wails analog of Electron's app.relaunch() and Tauri's tauri-plugin-process relaunch
// (a true process restart), which Wails v3 lacks (no App.Restart()). The renderer's shared recovery flow calls
// relaunch() then exit(0), and the application.relaunch app-control channel calls relaunch(); both map to
// ShellService.Relaunch → requestRelaunch here.
//
// To restart WITHOUT tripping the single-instance guard (a successor started while we still hold the lock would
// forward-and-exit instead of taking over), we spawn the successor only AFTER this instance has fully stopped:
// requestRelaunch just records intent + quits, and main() spawns the successor once app.Run() returns. The
// successor is tagged with our PID and blocks at startup (awaitPredecessorExit) until we are gone — the same
// "restart on exit" ordering Electron gives for free.

const relaunchWaitEnv = "CONTAINER_DESKTOP_RELAUNCH_WAIT"

// relaunchPending is read by main() after app.Run() returns; when set, a fresh instance is spawned.
var relaunchPending bool

// requestRelaunch records the restart intent and asks the app to quit. Safe to call from a service goroutine.
func requestRelaunch() {
	relaunchPending = true
	application.Get().Quit()
}

// spawnSuccessor starts a detached copy of this executable with the same args, tagged with our PID so the child
// waits for us to exit (releasing the OS single-instance lock) before it initializes.
func spawnSuccessor() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, os.Args[1:]...)
	cmd.Env = append(os.Environ(), relaunchWaitEnv+"="+strconv.Itoa(os.Getpid()))
	detachProcess(cmd) // per-OS: new session / process group so the successor outlives us
	return cmd.Start()
}

// awaitPredecessorExit, called first thing in main(), blocks a relaunched child until the previous instance
// (whose PID is in relaunchWaitEnv) has exited — so the single-instance lock is free before app.Run's check.
// A normal (non-relaunch) launch has no such env and returns immediately.
func awaitPredecessorExit() {
	raw := os.Getenv(relaunchWaitEnv)
	if raw == "" {
		return
	}
	_ = os.Unsetenv(relaunchWaitEnv)
	pid, err := strconv.Atoi(raw)
	if err != nil {
		return
	}
	waitForProcessExit(pid) // per-OS (relaunch_unix.go / relaunch_windows.go)
}
