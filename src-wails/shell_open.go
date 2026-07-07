package main

import (
	"os/exec"
	"path/filepath"
	"runtime"
)

// openInShell opens a path or URL in its default OS handler (the exec analog of tauri_plugin_opener's open_path /
// open_url). Detached — the caller doesn't wait.
func openInShell(target string) error {
	switch runtime.GOOS {
	case "darwin":
		return runDetached("open", target)
	case "windows":
		// `start` needs an (empty) title arg first; handles URLs, files, and folders.
		return runDetached("cmd", "/c", "start", "", target)
	default:
		return runDetached("xdg-open", target)
	}
}

// revealInShell reveals + selects a file in the OS file manager (tauri_plugin_opener's reveal_item_in_dir). Linux
// has no universal "select", so it opens the containing directory.
func revealInShell(path string) error {
	switch runtime.GOOS {
	case "darwin":
		return runDetached("open", "-R", path)
	case "windows":
		return runDetached("explorer", "/select,"+path)
	default:
		return runDetached("xdg-open", filepath.Dir(path))
	}
}

func runDetached(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	configureHiddenWindow(cmd) // Windows: no console flash (build-tagged); no-op elsewhere.
	return cmd.Start()
}
