//go:build linux || windows

package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Set by the test on the copy it spawns; that copy takes the helper branch instead of asserting anything.
const childGuardHelperEnv = "CD_CHILD_GUARD_HELPER"

// Kernel behaviour, measured rather than assumed — the whole point of the guard is what happens when NO code of ours
// runs, so a test that stubs the kill has tested nothing. Proving it needs three processes: this test, a parent it can
// kill, and the guarded grandchild that must not survive. The parent is a second copy of the test binary, which is the
// cheapest process that can call the code under test. Twin of the Rust test in src-tauri/src/child_guard.rs, and it
// runs on both platforms that have a mechanism: `go test` here for Linux, and the same binary cross-built with
// GOOS=windows and run on a real Windows host for the job object.
func TestAGuardedChildDoesNotOutliveTheProcessThatSpawnedIt(t *testing.T) {
	if os.Getenv(childGuardHelperEnv) != "" {
		cmd := longLivedCommand()
		if err := startBoundToApp(cmd); err != nil {
			t.Fatalf("the long-lived child did not start: %v", err)
		}
		// Printed straight to os.Stdout, which is unbuffered in Go and bypasses testing's per-test capture — so it
		// arrives while this process is still alive. (The Rust twin has to flush; a Go *os.File does not.)
		fmt.Printf("GRANDCHILD %d\n", cmd.Process.Pid)
		// Deliberately never waited for and never killed: this process is about to be killed outright, so anything
		// after this line would be cleanup the real case does not get either.
		time.Sleep(10 * time.Minute)
		return
	}

	grandchild := 0
	// A name PREFIX, which -test.run matches as a regexp against the full test name. The Rust twin has the opposite
	// trap: libtest matches the full module path, so an --exact filter of the bare function name selects nothing.
	parent := exec.Command(os.Args[0], "-test.run", "TestAGuardedChildDoesNotOutlive")
	parent.Env = append(os.Environ(), childGuardHelperEnv+"=1")
	stdout, err := parent.StdoutPipe()
	if err != nil {
		t.Fatalf("stdout: %v", err)
	}
	if err := parent.Start(); err != nil {
		t.Fatalf("spawn the parent under test: %v", err)
	}
	// Neither may survive this test, whichever way it ends — a red run must not leave the very kind of orphan it was
	// measuring. Both are already gone on the passing path, where these are no-ops.
	t.Cleanup(func() {
		_ = parent.Process.Kill()
		if grandchild != 0 {
			endProcess(grandchild)
		}
	})

	const marker = "GRANDCHILD "
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		at := strings.Index(line, marker)
		if at < 0 {
			continue
		}
		pid, convErr := strconv.Atoi(strings.TrimSpace(line[at+len(marker):]))
		if convErr != nil {
			t.Fatalf("not a pid in %q: %v", line, convErr)
		}
		grandchild = pid
		break
	}
	if grandchild == 0 {
		t.Fatal("the parent never named its child")
	}
	// Without this the assertion below is vacuous: "the child is gone" says nothing unless it was ever there.
	if !processAlive(grandchild) {
		t.Fatal("the guarded child never started")
	}

	// Killed, not asked to stop — SIGKILL on Linux, TerminateProcess on Windows. The case this exists for is the app
	// getting no chance to clean up after itself.
	if err := parent.Process.Kill(); err != nil {
		t.Fatalf("kill the parent under test: %v", err)
	}
	_ = parent.Wait()

	deadline := time.Now().Add(5 * time.Second)
	for processAlive(grandchild) && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if processAlive(grandchild) {
		t.Fatal("the child outlived the process that spawned it — the kernel was never asked to end it")
	}
}

// The longest-lived process available from a stock host, with no console and no stdin of its own.
func longLivedCommand() *exec.Cmd {
	if runtime.GOOS == "windows" {
		return exec.Command("ping", "-t", "127.0.0.1")
	}
	return exec.Command("/bin/sleep", "600")
}
