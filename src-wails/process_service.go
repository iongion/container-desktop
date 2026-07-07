package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"sync/atomic"
)

// ProcessService is the streaming process port — the Go side of ICommand.ExecuteStreaming +
// ExecuteAsBackgroundService (and the kill registry), the analog of src-tauri/src/process.rs. ONE command,
// process_spawn, backs both (the difference is JS-side in exec/commander.ts). A spawned child streams its raw
// stdout/stderr/exit/close events to "stream://<channel>" over Wails Events (text — no binary), and a registry
// lets the renderer kill it by a generated processId token.
type ProcessService struct {
	mu       sync.Mutex
	children map[string]*os.Process
	counter  atomic.Uint64
	// emit: test override, else the live Wails app emitter (see events.go).
	emit func(name string, data any)
}

// SpawnPayload mirrors the Tauri SpawnPayload (exec/process-utils.ts processSpawnPayload builds it).
type SpawnPayload struct {
	Launcher string   `json:"launcher"`
	Args     []string `json:"args"`
	Cwd      string   `json:"cwd"`
	// Overrides layered onto the inherited parent env (matches the TS-side merge).
	Env map[string]string `json:"env"`
}

type processSpawnArgs struct {
	Payload SpawnPayload `json:"payload"`
	// The JS WailsChannel serializes (toJSON) to its numeric id; events are emitted to "stream://<channel>".
	Channel uint64 `json:"channel"`
}

// SpawnResult matches src-tauri/src/process.rs SpawnResult.
type SpawnResult struct {
	ProcessID string `json:"processId"`
	Pid       *int   `json:"pid"`
}

type processKillArgs struct {
	Payload KillPayload `json:"payload"`
}

// KillPayload mirrors the Tauri KillPayload ({ processId, signal? }).
type KillPayload struct {
	ProcessID string `json:"processId"`
	Signal    string `json:"signal"`
}

// processEvent mirrors exec/process-utils.ts ProcessEventMessage: data → {from,data}; exit → {code,signal};
// close → {code}; error → {errorType,error}.
type processEvent struct {
	ProcessID string `json:"processId"`
	Type      string `json:"type"`
	From      string `json:"from,omitempty"`
	Data      string `json:"data,omitempty"`
	Code      *int   `json:"code,omitempty"`
	Signal    string `json:"signal,omitempty"`
	ErrorType string `json:"errorType,omitempty"`
	Error     string `json:"error,omitempty"`
}

// Spawn starts a child, streams stdout/stderr/exit/close to "stream://<channel>", and registers it for kill.
// Returns the processId token + pid immediately (before the process finishes). Mirrors process.rs process_spawn.
func (s *ProcessService) Spawn(args processSpawnArgs) (SpawnResult, error) {
	payload := args.Payload
	cmd := exec.Command(payload.Launcher, payload.Args...)
	if payload.Cwd != "" {
		cmd.Dir = payload.Cwd
	}
	cmd.Env = os.Environ()
	for key, value := range payload.Env {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	configureHiddenWindow(cmd) // Windows: no console flash for a streamed child (build-tagged); no-op else.

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return SpawnResult{}, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return SpawnResult{}, err
	}
	if err := cmd.Start(); err != nil {
		return SpawnResult{}, err
	}

	pid := cmd.Process.Pid
	processID := fmt.Sprintf("proc-%d", s.counter.Add(1))
	eventName := fmt.Sprintf("stream://%d", args.Channel)
	s.register(processID, cmd.Process)

	// Drain both pipes concurrently; wait for BOTH to hit EOF before cmd.Wait() (Go closes the pipes on Wait, so
	// reading after Wait would race — the documented StdoutPipe/StderrPipe ordering).
	var drained sync.WaitGroup
	drained.Add(2)
	go func() { defer drained.Done(); s.drain(stdout, "stdout", eventName, processID) }()
	go func() { defer drained.Done(); s.drain(stderr, "stderr", eventName, processID) }()
	go func() {
		drained.Wait()
		waitErr := cmd.Wait()
		code := exitCode(cmd, waitErr)
		s.emitProcess(eventName, processEvent{ProcessID: processID, Type: "exit", Code: code})
		s.emitProcess(eventName, processEvent{ProcessID: processID, Type: "close", Code: code})
		s.unregister(processID)
	}()

	pidValue := pid
	return SpawnResult{ProcessID: processID, Pid: &pidValue}, nil
}

// Kill signals a registered process by token (default SIGTERM; SIGKILL/SIGINT accepted). No-op if it already
// exited. Signal delivery is platform-specific (process_kill_{unix,windows}.go). Mirrors process.rs process_kill.
func (s *ProcessService) Kill(args processKillArgs) {
	s.mu.Lock()
	process, ok := s.children[args.Payload.ProcessID]
	s.mu.Unlock()
	if ok {
		deliverSignal(process, parseSignal(args.Payload.Signal))
	}
}

func (s *ProcessService) drain(reader io.Reader, from, eventName, processID string) {
	// Raw chunks (not line-split) to mirror Node's stream "data" — preserves \r progress updates in build output.
	buf := make([]byte, 8192)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			s.emitProcess(eventName, processEvent{ProcessID: processID, Type: "data", From: from, Data: string(buf[:n])})
		}
		if err != nil {
			return // EOF or read error → this pipe is done
		}
	}
}

func (s *ProcessService) emitProcess(name string, event processEvent) {
	emitToRenderer(s.emit, name, event)
}

func (s *ProcessService) register(id string, process *os.Process) {
	s.mu.Lock()
	if s.children == nil {
		s.children = map[string]*os.Process{}
	}
	s.children[id] = process
	s.mu.Unlock()
}

func (s *ProcessService) unregister(id string) {
	s.mu.Lock()
	delete(s.children, id)
	s.mu.Unlock()
}

// exitCode returns the child's exit code, or nil when it was terminated by a signal (ExitCode() == -1) — the TS
// side maps a missing code to null, matching process.rs's Option<i32>.
func exitCode(cmd *exec.Cmd, _ error) *int {
	if cmd.ProcessState == nil {
		return nil
	}
	if code := cmd.ProcessState.ExitCode(); code >= 0 {
		return &code
	}
	return nil
}

// parseSignal maps a signal name/number to its POSIX number (default SIGTERM). On Windows the number is ignored
// (deliverSignal terminates the tree by pid). Mirrors process.rs parse_signal.
func parseSignal(signal string) int {
	switch signal {
	case "SIGKILL", "KILL", "9":
		return 9
	case "SIGINT", "INT", "2":
		return 2
	case "":
		return 15
	default:
		if n, err := strconv.Atoi(signal); err == nil {
			return n
		}
		return 15
	}
}
