package main

import (
	"bytes"
	"io"
	"net"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// writeCloserBuf is an io.WriteCloser backed by a buffer, recording Close().
type writeCloserBuf struct {
	mu     sync.Mutex
	buf    bytes.Buffer
	closed bool
}

func (w *writeCloserBuf) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.buf.Write(p)
}

func (w *writeCloserBuf) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.closed = true
	return nil
}

func (w *writeCloserBuf) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.buf.String()
}

// TestBridgeRoundTrip starts a unix-socket "engine" that upper-cases whatever it
// receives, then verifies the bridge forwards stdin->socket and socket->stdout
// with correct half-close framing.
func TestBridgeRoundTrip(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "engine.sock")
	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		data, _ := io.ReadAll(c) // returns once the bridge half-closes its write side
		_, _ = c.Write(bytes.ToUpper(data))
		if uc, ok := c.(*net.UnixConn); ok {
			_ = uc.CloseWrite()
		}
	}()

	conn, err := dialWithRetry(sockPath, 20, 10*time.Millisecond)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	out := &writeCloserBuf{}
	bridge(conn, bytes.NewBufferString("ping-from-client"), out)

	if got := out.String(); got != "PING-FROM-CLIENT" {
		t.Fatalf("round-trip mismatch: got %q, want %q", got, "PING-FROM-CLIENT")
	}
	if !out.closed {
		t.Fatal("expected bridge to close the output stream")
	}
}

// TestDialWithRetryFails ensures a missing socket returns an error rather than
// blocking forever.
func TestDialWithRetryFails(t *testing.T) {
	if _, err := dialWithRetry(filepath.Join(t.TempDir(), "nope.sock"), 3, time.Millisecond); err == nil {
		t.Fatal("expected error dialing a non-existent socket")
	}
}
