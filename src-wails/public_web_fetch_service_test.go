package main

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"
)

func TestIsPublicAddress(t *testing.T) {
	public := []string{"1.1.1.1", "140.82.121.4", "2606:4700:4700::1111"}
	for _, a := range public {
		if !isPublicAddress(a) {
			t.Fatalf("expected %s public", a)
		}
	}
	blocked := []string{
		"127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254",
		"0.0.0.0", "100.64.0.1", "198.18.0.1", "240.0.0.1",
		"::1", "::ffff:10.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "not-an-ip",
	}
	for _, a := range blocked {
		if isPublicAddress(a) {
			t.Fatalf("expected %s blocked", a)
		}
	}
}

// TestPublicWebFetchPinsAndStreams starts an httptest server (bound to 127.0.0.1, which the real classifier
// blocks), injects an allow-all classifier, and asserts Request pins to the server address, keeps the URL Host,
// follows no redirect, and streams the body back over the emit() Wails-event contract as base64 binary frames.
func TestPublicWebFetchPinsAndStreams(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("hello"))
	}))
	defer server.Close()

	u, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parse server url: %v", err)
	}

	var mu sync.Mutex
	captured := map[string][]streamEvent{}
	svc := newPublicWebFetchService(func(string) bool { return true })
	svc.emit = func(name string, data any) {
		mu.Lock()
		defer mu.Unlock()
		captured[name] = append(captured[name], data.(streamEvent))
	}

	args := publicFetchArgs{
		Payload: publicFetchPayload{URL: server.URL, Addresses: []string{u.Hostname()}, Method: "GET"},
		Channel: 7,
	}
	handle, err := svc.Request(args)
	if err != nil {
		t.Fatalf("Request: %v", err)
	}
	if handle.Status != 200 {
		t.Fatalf("status = %d", handle.Status)
	}
	if handle.StreamID == "" {
		t.Fatalf("missing streamId")
	}

	deadline := time.Now().Add(3 * time.Second)
	var body []byte
	sawEnd := false
	for time.Now().Before(deadline) && !sawEnd {
		mu.Lock()
		events := append([]streamEvent(nil), captured["stream://7"]...)
		mu.Unlock()
		body = nil
		for _, e := range events {
			switch {
			case e.Type == "data" && e.Binary:
				chunk, decErr := base64.StdEncoding.DecodeString(e.Payload.(string))
				if decErr != nil {
					t.Fatalf("base64 decode: %v", decErr)
				}
				body = append(body, chunk...)
			case e.Type == "end":
				sawEnd = true
			case e.Type == "error":
				t.Fatalf("unexpected error event: %+v", e.Payload)
			}
		}
		if !sawEnd {
			time.Sleep(10 * time.Millisecond)
		}
	}
	if !sawEnd {
		t.Fatalf("timed out waiting for end")
	}
	if string(body) != "hello" {
		t.Fatalf("body = %q", string(body))
	}
}

// TestPublicWebFetchRefusesNonPublic verifies the real classifier drops every private address before dialing.
func TestPublicWebFetchRefusesNonPublic(t *testing.T) {
	svc := newPublicWebFetchService(isPublicAddress)
	svc.emit = func(string, any) {}
	_, err := svc.Request(publicFetchArgs{
		Payload: publicFetchPayload{URL: "https://example.com", Addresses: []string{"10.0.0.1", "127.0.0.1"}, Method: "GET"},
		Channel: 1,
	})
	if err == nil {
		t.Fatalf("expected refusal for all-private addresses")
	}
}
