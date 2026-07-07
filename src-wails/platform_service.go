package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

// PlatformService backs the renderer's IPlatform port — the Go analog of src-tauri/src/host.rs. The
// wails invoke shim maps the Tauri command names onto these methods (get_os_type -> GetOsType, ...).
// Node-style OS/arch strings are returned so shared code sees identical values across all backends.
type PlatformService struct{}

// GetOsType returns the Node os.type() value: "Linux" | "Darwin" | "Windows_NT".
func (s *PlatformService) GetOsType() string {
	switch runtime.GOOS {
	case "windows":
		return "Windows_NT"
	case "darwin":
		return "Darwin"
	default:
		return "Linux"
	}
}

// GetOsArch returns the Node process.arch value: "x64" | "arm64" | "ia32" | ...
func (s *PlatformService) GetOsArch() string {
	switch runtime.GOARCH {
	case "amd64":
		return "x64"
	case "386":
		return "ia32"
	default:
		return runtime.GOARCH // arm64 already matches Node naming
	}
}

// GetEnvVarRequest mirrors the Tauri get_env_var payload so the invoke shim passes { name } verbatim.
type GetEnvVarRequest struct {
	Name string `json:"name"`
}

func (s *PlatformService) GetEnvVar(req GetEnvVarRequest) string {
	return os.Getenv(req.Name)
}

func (s *PlatformService) GetHomeDir() (string, error) {
	return os.UserHomeDir()
}

// GetDarwinMajor returns the Darwin kernel major version on macOS (uname -r), or nil elsewhere. Mirrors the
// Tauri get_darwin_major command feeding the renderer's CURRENT_DARWIN_MAJOR (Apple-Container network gating).
func (s *PlatformService) GetDarwinMajor() *int {
	if runtime.GOOS != "darwin" {
		return nil
	}
	out, err := exec.Command("uname", "-r").Output()
	if err != nil {
		return nil
	}
	major, err := strconv.Atoi(strings.SplitN(strings.TrimSpace(string(out)), ".", 2)[0])
	if err != nil {
		return nil
	}
	return &major
}

// IsFlatpak reports whether the app runs inside a Flatpak sandbox (mirrors host.rs is_flatpak).
func (s *PlatformService) IsFlatpak() bool {
	if _, ok := os.LookupEnv("FLATPAK_ID"); ok {
		return true
	}
	_, err := os.Stat("/.flatpak-info")
	return err == nil
}

// GetUserDataPath returns the per-OS config dir + "container-desktop", honoring the
// CONTAINER_DESKTOP_USER_DATA_DIR override (mirrors host.rs get_user_data_path). NOTE: must resolve
// to the SAME path Electron/Tauri use so all backends share one config — cross-checked in Phase 1.
func (s *PlatformService) GetUserDataPath() (string, error) {
	return userDataPath()
}

// userDataPath is the shared resolver (ShellService reads it too) — the per-OS config dir + "container-desktop",
// honoring CONTAINER_DESKTOP_USER_DATA_DIR.
func userDataPath() (string, error) {
	if override := os.Getenv("CONTAINER_DESKTOP_USER_DATA_DIR"); override != "" {
		return override, nil
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "container-desktop"), nil
}
