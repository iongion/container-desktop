//go:build !windows

package main

import (
	"io"
	"net"
	"os"
	"path/filepath"
	"testing"
)

// Ported from src-tauri/src/bridge.rs: verify the stdio bridge end-to-end WITHOUT ssh/docker — `cat` stands in
// for the dial-stdio process (echoes stdin→stdout), proving accept → spawn → raw bidirectional byte-shuttle +
// half-close teardown, plus cache reuse + stop cleanup.
func TestStdioBridgeRoundTrip(t *testing.T) {
	manager := &bridgeManager{}
	socket := filepath.Join(t.TempDir(), "cd-bridge.sock")
	spec := bridgeSpec{Kind: "stdio", Key: "conn-1", LocalAddress: socket, Launcher: "cat"}

	addr, err := manager.ensure(spec)
	if err != nil || addr != socket {
		t.Fatalf("ensure: addr=%q err=%v", addr, err)
	}
	// Same key ⇒ reuse (no re-bind; a rebind would fail with EADDRINUSE).
	if addr2, err := manager.ensure(spec); err != nil || addr2 != socket {
		t.Fatalf("reuse: addr=%q err=%v", addr2, err)
	}

	conn, err := net.Dial("unix", socket)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	if _, err := conn.Write([]byte("hello dial-stdio")); err != nil {
		t.Fatalf("write: %v", err)
	}
	_ = conn.(*net.UnixConn).CloseWrite() // half-close → cat sees EOF, flushes, exits
	echoed, err := io.ReadAll(conn)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(echoed) != "hello dial-stdio" {
		t.Fatalf("echoed = %q, want %q", echoed, "hello dial-stdio")
	}

	manager.stop("conn-1")
	if _, err := os.Stat(socket); !os.IsNotExist(err) {
		t.Fatalf("socket still present after stop: %v", err)
	}
}
