//go:build windows

package main

// launchTerminal opens Windows Terminal (`wt`) running `launcher args…` in a Command Prompt tab. Mirrors
// shell.rs launch_terminal_windows.
func launchTerminal(launcher string, args []string, title string) LaunchResult {
	wtArgs := []string{"-w", "nt", "--title", title, "-p", "Command Prompt", "-d", ".", "cmd", "/k", launcher}
	wtArgs = append(wtArgs, args...)
	return spawnDetached("wt", wtArgs)
}
