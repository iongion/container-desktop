package main

import "os/exec"

// startBoundToApp starts a child this app is responsible for and ties it to the app's own lifetime by the kernel,
// wherever the kernel offers that. The Wails twin of src-tauri/src/child_guard.rs — read that file for the platform
// table, why macOS never gets one, and the caveats on each mechanism, including why this app does NOT put itself in
// its own Windows job.
//
// It owns the Start because the two mechanisms attach on OPPOSITE sides of it: Linux arms the child before it execs,
// Windows can only adopt a process that already exists. A call site that did one and forgot the other would be
// silently unguarded on that platform, and nothing would say so until the ports ran out.
func startBoundToApp(cmd *exec.Cmd) error {
	configureDeathWithParent(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	adoptIntoAppJob(cmd)
	return nil
}
