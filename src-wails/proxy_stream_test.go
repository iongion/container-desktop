package main

import (
	"bytes"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// Hermetic proxy-streaming test (no real engine): a unix-socket HTTP server streams a JSON /events line and a
// BINARY /logs frame; the test asserts RequestStream opens, pumps a text data event + end for /events, and a
// base64 binary data event whose decoded bytes are byte-identical for /logs — proving binary log frames survive
// the JSON-only Wails Events transport intact (docker's multiplexed frame header preserved).
func TestProxyRequestStreamTextAndBinary(t *testing.T) {
	dir := t.TempDir()
	socket := filepath.Join(dir, "engine.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatalf("listen unix: %v", err)
	}
	defer func() { _ = listener.Close() }()

	// A docker multiplexed log frame: 8-byte header (stream=stdout, size=5) + "hello". Byte 0 is 0x01 and byte 7
	// is 0x05 — both invalid mid-UTF8, so a utf8-lossy string round-trip WOULD corrupt them (the bug base64 fixes).
	logFrame := []byte{0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05, 'h', 'e', 'l', 'l', 'o'}

	mux := http.NewServeMux()
	mux.HandleFunc("/events", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"Type":"container","Action":"start"}`)
	})
	mux.HandleFunc("/containers/abc/logs", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(logFrame)
	})
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = server.Serve(listener) }()
	defer func() { _ = server.Close() }()

	var mu sync.Mutex
	captured := map[string][]streamEvent{}
	svc := &ProxyService{emit: func(name string, data any) {
		mu.Lock()
		defer mu.Unlock()
		captured[name] = append(captured[name], data.(streamEvent))
	}}

	waitForEnd := func(t *testing.T, event string) []streamEvent {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			mu.Lock()
			events := append([]streamEvent(nil), captured[event]...)
			mu.Unlock()
			for _, e := range events {
				if e.Type == "end" {
					return events
				}
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatalf("timed out waiting for end on %s", event)
		return nil
	}

	// Text stream (/events) → channel 1.
	textHandle, err := svc.RequestStream(newStreamArgs(socket, "/events", 1))
	if err != nil {
		t.Fatalf("RequestStream /events: %v", err)
	}
	if !textHandle.Stream || textHandle.Status != 200 || textHandle.StreamID == "" {
		t.Fatalf("bad text handle: %+v", textHandle)
	}
	textEvents := waitForEnd(t, "stream://1")
	var sawText bool
	for _, e := range textEvents {
		if e.Type == "data" && !e.Binary {
			if s, ok := e.Payload.(string); ok && bytes.Contains([]byte(s), []byte(`"Action":"start"`)) {
				sawText = true
			}
		}
	}
	if !sawText {
		t.Fatalf("no text data event for /events: %+v", textEvents)
	}

	// Binary stream (/logs) → channel 2.
	logHandle, err := svc.RequestStream(newStreamArgs(socket, "/containers/abc/logs", 2))
	if err != nil {
		t.Fatalf("RequestStream /logs: %v", err)
	}
	logEvents := waitForEnd(t, "stream://2")
	var decoded []byte
	for _, e := range logEvents {
		if e.Type == "data" && e.Binary {
			b64, ok := e.Payload.(string)
			if !ok {
				t.Fatalf("binary payload not a string: %T", e.Payload)
			}
			chunk, decErr := base64.StdEncoding.DecodeString(b64)
			if decErr != nil {
				t.Fatalf("base64 decode: %v", decErr)
			}
			decoded = append(decoded, chunk...)
		}
	}
	if !bytes.Equal(decoded, logFrame) {
		t.Fatalf("binary log frame corrupted: got %v want %v", decoded, logFrame)
	}
	_ = logHandle
}

func newStreamArgs(socket, path string, channel uint64) proxyStreamArgs {
	args := proxyStreamArgs{Payload: proxyRequestPayload{Req: proxyReq{Method: "GET", URL: path}}, Channel: channel}
	args.Payload.Connection.Settings.API.Connection.URI = "unix://" + socket
	return args
}
