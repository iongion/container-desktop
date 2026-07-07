package main

import (
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// Execute pipes Input to the child's stdin (the registry `login --password-stdin` path) and never leaks the
// secret into argv/command. `cat` echoes only what it reads from stdin.
func TestExecuteStdinInputStaysOutOfArgv(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses cat")
	}
	secret := "s3cr3t-token"
	res := (&ExecService{}).Execute(CommandExecuteRequest{Launcher: "cat", Input: secret})
	if !res.Success {
		t.Fatalf("execute failed: %s", res.Stderr)
	}
	if res.Stdout != secret {
		t.Errorf("stdout = %q, want %q (stdin not delivered to child)", res.Stdout, secret)
	}
	if strings.Contains(res.Command, secret) {
		t.Errorf("secret leaked into command/argv: %q", res.Command)
	}
}

// Hermetic ProcessService test: spawn a shell that writes stdout+stderr and exits 3, assert the streamed
// data/exit/close events over "stream://<channel>". emit is injected (no running webview).
func TestProcessSpawnStreamsAndExits(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses sh")
	}
	var mu sync.Mutex
	captured := map[string][]processEvent{}
	svc := &ProcessService{emit: func(name string, data any) {
		mu.Lock()
		defer mu.Unlock()
		captured[name] = append(captured[name], data.(processEvent))
	}}

	res, err := svc.Spawn(processSpawnArgs{
		Payload: SpawnPayload{Launcher: "sh", Args: []string{"-c", "printf hello; printf oops 1>&2; exit 3"}},
		Channel: 7,
	})
	if err != nil {
		t.Fatalf("spawn: %v", err)
	}
	if res.ProcessID == "" || res.Pid == nil {
		t.Fatalf("bad spawn result: %+v", res)
	}

	events := waitForProcessClose(t, &mu, captured, "stream://7")
	var stdout, stderr string
	var exit *int
	var sawClose bool
	for _, e := range events {
		switch e.Type {
		case "data":
			switch e.From {
			case "stdout":
				stdout += e.Data
			case "stderr":
				stderr += e.Data
			}
		case "exit":
			exit = e.Code
		case "close":
			sawClose = true
		}
	}
	if stdout != "hello" {
		t.Errorf("stdout = %q, want %q", stdout, "hello")
	}
	if stderr != "oops" {
		t.Errorf("stderr = %q, want %q", stderr, "oops")
	}
	if exit == nil || *exit != 3 {
		t.Errorf("exit code = %v, want 3", exit)
	}
	if !sawClose {
		t.Error("no close event")
	}
}

// Kill terminates a long-running child (SIGKILL) → the pump emits exit+close.
func TestProcessKill(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses sh")
	}
	var mu sync.Mutex
	captured := map[string][]processEvent{}
	svc := &ProcessService{emit: func(name string, data any) {
		mu.Lock()
		defer mu.Unlock()
		captured[name] = append(captured[name], data.(processEvent))
	}}

	// Spawn `sleep` DIRECTLY (not `sh -c`): the app streams engine binaries directly, and killing a shell's pid
	// would leave the forked child holding the pipe (process.rs kills by pid too — no process-group semantics).
	res, err := svc.Spawn(processSpawnArgs{
		Payload: SpawnPayload{Launcher: "sleep", Args: []string{"10"}},
		Channel: 8,
	})
	if err != nil {
		t.Fatalf("spawn: %v", err)
	}
	time.Sleep(100 * time.Millisecond) // let it start
	svc.Kill(processKillArgs{Payload: KillPayload{ProcessID: res.ProcessID, Signal: "SIGKILL"}})

	events := waitForProcessClose(t, &mu, captured, "stream://8")
	var sawClose bool
	for _, e := range events {
		if e.Type == "close" {
			sawClose = true
		}
	}
	if !sawClose {
		t.Fatal("kill did not terminate the process (no close event)")
	}
}

func waitForProcessClose(t *testing.T, mu *sync.Mutex, captured map[string][]processEvent, event string) []processEvent {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		events := append([]processEvent(nil), captured[event]...)
		mu.Unlock()
		for _, e := range events {
			if e.Type == "close" {
				return events
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for close on %s", event)
	return nil
}
