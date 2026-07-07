package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// ShellService is the native-shell integration — open external URLs / the storage folder / the log file, toggle
// devtools, and launch a per-OS terminal. The Go analog of src-tauri/src/shell.rs. The renderer reaches these
// through MessageBus channels; open_external is urlPolicy-gated JS-side before invoking.
type ShellService struct{}

type openExternalRequest struct {
	URL string `json:"url"`
}

// OpenExternal opens a vetted URL in the OS browser (the webview gates it with urlPolicy before invoking).
func (s *ShellService) OpenExternal(req openExternalRequest) error {
	return application.Get().Browser.OpenURL(req.URL)
}

// OpenStorageFolder reveals the user-data dir (the shared config location) in the OS file manager.
func (s *ShellService) OpenStorageFolder() error {
	dir, err := userDataPath()
	if err != nil {
		return err
	}
	_ = os.MkdirAll(dir, 0o755)
	return openInShell(dir)
}

// ToggleDevtools opens the webview devtools. Wails' Go window API exposes only OpenDevTools (no close/toggle), so
// this degrades a toggle to open. mainWindow is the window created in main.go.
func (s *ShellService) ToggleDevtools() {
	if mainWindow != nil {
		mainWindow.OpenDevTools()
	}
}

// Relaunch restarts the app — start a fresh instance, then quit this one. The Wails analog of Electron's
// app.relaunch() and Tauri's tauri-plugin-process relaunch (Wails v3 has no App.Restart()). Backs the renderer's
// application.relaunch app-control channel + the recovery "Reload" choice. The successor is spawned only after
// teardown (main.go, once app.Run returns) to avoid the single-instance handoff race — see relaunch.go.
func (s *ShellService) Relaunch() {
	requestRelaunch()
}

// LaunchResult mirrors env/Types.ts CommandExecutionResult so the renderer's `output.success` checks work unchanged.
type LaunchResult struct {
	Pid     *int   `json:"pid"`
	Code    *int   `json:"code"`
	Success bool   `json:"success"`
	Stdout  string `json:"stdout"`
	Stderr  string `json:"stderr"`
	Command string `json:"command"`
}

type terminalLaunchRequest struct {
	Payload terminalLaunch `json:"payload"`
}

type terminalLaunch struct {
	Launcher string   `json:"launcher"`
	Args     []string `json:"args"`
	Title    string   `json:"title"`
}

// LaunchTerminal opens a system terminal running `launcher args…` (per-OS — terminal_{linux,darwin,windows}.go).
func (s *ShellService) LaunchTerminal(req terminalLaunchRequest) LaunchResult {
	title := req.Payload.Title
	if title == "" {
		title = "Container Desktop"
	}
	return launchTerminal(req.Payload.Launcher, req.Payload.Args, title)
}

// spawnDetached runs `program args…` detached (returns immediately, reaps in the background) and returns a
// LaunchResult. Mirrors shell.rs spawn_detached.
func spawnDetached(program string, args []string) LaunchResult {
	command := strings.TrimSpace(program + " " + strings.Join(args, " "))
	cmd := exec.Command(program, args...)
	if err := cmd.Start(); err != nil {
		return LaunchResult{Success: false, Stderr: err.Error(), Command: command}
	}
	pid := cmd.Process.Pid
	code := 0
	go func() { _ = cmd.Wait() }() // reap when the terminal closes; never block the caller
	return LaunchResult{Pid: &pid, Code: &code, Success: true, Command: command}
}

// logging (logging:apply / open / reveal — loggingIpc.ts return shapes)

func logFilePath() (string, error) {
	dir, err := userDataPath()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "logs", "container-desktop.log"), nil
}

// Persistent file sink — the Wails analog of tauri-plugin-log's webview-target file. The renderer's
// @/platform/logger façade forwards each already level-gated record here (wails/log/wailsLog.ts → logging_write),
// and LogWrite appends it to the SAME file LoggingOpen/LoggingReveal reveal. Serialized (logMu) since concurrent
// Call.ByName invocations run on separate goroutines; rotated at ~1 MiB to one .old file, like electron-log.
const logMaxBytes = 1 << 20

var logMu sync.Mutex

// LogWriteRequest carries one record: the level and the "[scope] body" line the façade already formatted.
type LogWriteRequest struct {
	Level   string `json:"level"`
	Message string `json:"message"`
}

func (s *ShellService) LogWrite(req LogWriteRequest) {
	appendLogLine(req.Level, req.Message)
}

func appendLogLine(level, message string) {
	path, err := logFilePath()
	if err != nil {
		return
	}
	logMu.Lock()
	defer logMu.Unlock()
	if os.MkdirAll(filepath.Dir(path), 0o755) != nil {
		return
	}
	if info, statErr := os.Stat(path); statErr == nil && info.Size() >= logMaxBytes {
		_ = os.Rename(path, path+".old") // keep one previous file, like electron-log's .old rotation
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer func() { _ = file.Close() }()
	level = strings.ToUpper(strings.TrimSpace(level))
	if level == "" {
		level = "INFO"
	}
	_, _ = file.WriteString("[" + time.Now().Format(time.RFC3339) + "] [" + level + "] " + message + "\n")
}

// LogApplyResult / LogOpResult mirror electronLogMain.ts return shapes.
type LogApplyResult struct {
	LogFile string `json:"logFile"`
}

// LoggingApply — the log level is applied renderer-side (the in-realm logger); this returns the file path. The
// file itself is written by the LogWrite sink above (the façade forwards each record), so it exists to open/reveal.
func (s *ShellService) LoggingApply() LogApplyResult {
	path, _ := logFilePath()
	return LogApplyResult{LogFile: path}
}

type LogOpResult struct {
	OK     bool   `json:"ok"`
	Reason string `json:"reason,omitempty"`
	Detail string `json:"detail,omitempty"`
}

// LoggingOpen opens the log file in the default viewer (missing → {ok:false, reason:"missing"}).
func (s *ShellService) LoggingOpen() LogOpResult {
	path, err := logFilePath()
	if err != nil || !fileExists(path) {
		return LogOpResult{OK: false, Reason: "missing"}
	}
	if openErr := openInShell(path); openErr != nil {
		return LogOpResult{OK: false, Reason: "error", Detail: openErr.Error()}
	}
	return LogOpResult{OK: true}
}

// LoggingReveal reveals the log file in the OS file manager.
func (s *ShellService) LoggingReveal() LogOpResult {
	path, err := logFilePath()
	if err != nil || !fileExists(path) {
		return LogOpResult{OK: false, Reason: "missing"}
	}
	if revealErr := revealInShell(path); revealErr != nil {
		return LogOpResult{OK: false, Reason: "error", Detail: revealErr.Error()}
	}
	return LogOpResult{OK: true}
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
