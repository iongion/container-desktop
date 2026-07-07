//go:build darwin

package main

import "strings"

// launchTerminal opens Terminal.app running `launcher args…` via osascript. Mirrors shell.rs launch_terminal_macos.
func launchTerminal(launcher string, args []string, _ string) LaunchResult {
	command := strings.Join(append([]string{launcher}, args...), " ")
	// escapeAppleScriptString (node.ts): \ → \\, " → \"
	escaped := strings.ReplaceAll(strings.ReplaceAll(command, `\`, `\\`), `"`, `\"`)
	script := "tell app \"Terminal\" to do script \"" + escaped + "\""
	return spawnDetached("osascript", []string{"-e", script})
}
