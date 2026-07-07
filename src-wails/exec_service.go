package main

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"sort"
	"strings"
	"time"
)

// ExecService is the buffered process primitive + host DNS capability — the Go analog of src-tauri/src/host.rs
// (command_execute + dns_lookup). The wails invoke shim maps command_execute → Execute, dns_lookup → DNSLookup.
// Streaming process I/O lives in ProcessService; SSH/WSL bridge I/O in BridgeService/ProxyService.
type ExecService struct{}

// CommandExecuteRequest mirrors the Tauri command_execute payload (src/platform/wails/exec/commander.ts builds it).
type CommandExecuteRequest struct {
	Launcher  string            `json:"launcher"`
	Args      []string          `json:"args"`
	Cwd       string            `json:"cwd"`
	Env       map[string]string `json:"env"`
	Isolate   bool              `json:"isolate"`
	TimeoutMs uint64            `json:"timeoutMs"`
}

// CommandExecutionResult mirrors src-tauri/src/host.rs CommandExecutionResult (and @/env/Types) field-for-field.
type CommandExecutionResult struct {
	Pid     *int   `json:"pid"`
	Code    *int   `json:"code"`
	Success bool   `json:"success"`
	Stdout  string `json:"stdout"`
	Stderr  string `json:"stderr"`
	Command string `json:"command"`
}

// Execute runs `launcher args…` to completion and captures stdout/stderr/exit. isolate=true empties the inherited
// environment before applying Env (sandbox); false layers Env onto it (Command.Execute). timeoutMs>0 caps
// wall-clock — on timeout the child is killed and a failed result returned. Mirrors host.rs run_command.
func (s *ExecService) Execute(req CommandExecuteRequest) CommandExecutionResult {
	command := strings.TrimSpace(req.Launcher + " " + strings.Join(req.Args, " "))

	ctx := context.Background()
	if req.TimeoutMs > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(req.TimeoutMs)*time.Millisecond)
		defer cancel()
	}

	cmd := exec.CommandContext(ctx, req.Launcher, req.Args...)
	if req.Cwd != "" {
		cmd.Dir = req.Cwd
	}
	if req.Isolate {
		cmd.Env = []string{}
	} else {
		cmd.Env = os.Environ()
	}
	for key, value := range req.Env {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	configureHiddenWindow(cmd) // Windows: no console flash per CLI call (build-tagged); no-op elsewhere.

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()

	if ctx.Err() == context.DeadlineExceeded {
		return CommandExecutionResult{
			Success: false,
			Stderr:  fmt.Sprintf("command timed out after %dms", req.TimeoutMs),
			Command: command,
		}
	}

	result := CommandExecutionResult{Stdout: stdout.String(), Stderr: stderr.String(), Command: command}
	if cmd.ProcessState != nil {
		// ExitCode() is -1 when the child was killed by a signal — map that to null (Rust's Option::None).
		if code := cmd.ProcessState.ExitCode(); code >= 0 {
			result.Code = &code
		}
		result.Success = cmd.ProcessState.Success()
	} else if err != nil {
		// Spawn failure (e.g. launcher not found) — no exit code, surface the error (mirrors run_command's Err arm).
		result.Success = false
		result.Stderr = err.Error()
	}
	return result
}

// DNSLookupRequest carries the hostname to resolve.
type DNSLookupRequest struct {
	Hostname string `json:"hostname"`
}

// DNSLookup resolves a hostname to its sorted, deduped IPs (host.rs dns_lookup) — a generic host DNS capability
// the AI web-search SSRF guard consumes to reject private/loopback targets.
func (s *ExecService) DNSLookup(req DNSLookupRequest) ([]string, error) {
	ips, err := net.LookupIP(req.Hostname)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]struct{}, len(ips))
	out := make([]string, 0, len(ips))
	for _, ip := range ips {
		text := ip.String()
		if _, ok := seen[text]; !ok {
			seen[text] = struct{}{}
			out = append(out, text)
		}
	}
	sort.Strings(out)
	return out, nil
}
