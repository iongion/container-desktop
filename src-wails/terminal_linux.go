//go:build !darwin && !windows

package main

import (
	"os"
	"path/filepath"
)

// launchTerminal opens a Linux terminal emulator running `launcher args…`. Probes $TERMINAL then a candidate
// list, resolves the executable on PATH, and applies the per-emulator arg template. Mirrors shell.rs
// launch_terminal_linux (a port of node.ts:279-323).
func launchTerminal(launcher string, args []string, title string) LaunchResult {
	candidates := []string{}
	if pref := os.Getenv("TERMINAL"); pref != "" {
		candidates = append(candidates, pref)
	}
	candidates = append(candidates,
		"ptyxis", "gnome-terminal", "kgx", "konsole", "kitty", "alacritty", "wezterm", "x-terminal-emulator", "xterm")

	for _, candidate := range candidates {
		resolved := resolveExecutable(candidate)
		if resolved == "" {
			continue
		}
		return spawnDetached(resolved, linuxTerminalArgs(realBasename(resolved), title, launcher, args))
	}
	code := -2
	return LaunchResult{Code: &code, Success: false, Stderr: "No supported terminal emulator found on PATH"}
}

// resolveExecutable: absolute → check executable; else walk PATH (node.ts resolveExecutable).
func resolveExecutable(cmd string) string {
	if filepath.IsAbs(cmd) {
		if isExecutable(cmd) {
			return cmd
		}
		return ""
	}
	for _, dir := range filepath.SplitList(os.Getenv("PATH")) {
		if dir == "" {
			continue
		}
		candidate := filepath.Join(dir, cmd)
		if isExecutable(candidate) {
			return candidate
		}
	}
	return ""
}

func isExecutable(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Mode().Perm()&0o111 != 0
}

// realBasename resolves symlinks (so the arg template matches the real binary) then takes the basename.
func realBasename(path string) string {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		resolved = path
	}
	return filepath.Base(resolved)
}

// linuxTerminalArgs is the per-emulator arg template (node.ts linuxTerminalArgs).
func linuxTerminalArgs(name, title, launcher string, params []string) []string {
	var base []string
	switch name {
	case "ptyxis":
		base = []string{"--new-window", "-T", title, "--", launcher}
	case "gnome-terminal", "kgx":
		base = []string{"--title", title, "--", launcher}
	case "konsole":
		base = []string{"--new-tab", "--title", title, "-e", launcher}
	case "kitty":
		base = []string{"--title", title, launcher}
	case "alacritty":
		base = []string{"--title", title, "-e", launcher}
	case "wezterm":
		base = []string{"start", "--", launcher}
	case "xterm":
		base = []string{"-T", title, "-e", launcher}
	default:
		base = []string{"-e", launcher}
	}
	return append(base, params...)
}
