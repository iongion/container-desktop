package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Streaming (responseType == "stream", e.g. /events or logs?follow) — the analog of proxy.rs proxy_request_stream.
// Only the OPEN is time-bounded; the stream itself is not. Chunks are pushed to the renderer over Wails Events at
// "stream://<channel>" as { streamId, type: "data" | "end" | "error", binary?, payload? } — the WailsChannel shim
// in bridge.ts listens there and feeds applyStreamEvent, mirroring commandProxyProtocol.CommandProxyStreamEvent.
//
// Binary container-log frames: Tauri sent them as raw bytes over its native Channel, but Wails Events are
// JSON-only. So a /logs stream base64-encodes each chunk with binary:true; the WailsChannel decodes it back to a
// Uint8Array before applyStreamEvent, which then sees the SAME bytes Tauri delivered (docker's multiplexed 8-byte
// frame headers survive intact — no utf8-lossy corruption). /events (JSON text) stays on the plain string path.

// ProxyStreamHandle matches src-tauri/src/proxy.rs ProxyStreamHandle.
type ProxyStreamHandle struct {
	Stream   bool              `json:"stream"`
	StreamID string            `json:"streamId"`
	Status   int               `json:"status"`
	Headers  map[string]string `json:"headers"`
}

// streamEvent mirrors commandProxyProtocol.CommandProxyStreamEvent ({ streamId, type, payload? }), plus a `binary`
// flag Wails needs that Tauri did not: Wails Events are JSON-only, so a binary log frame crosses as a base64
// payload with binary:true, and the WailsChannel shim (bridge.ts) decodes it back to a Uint8Array before
// applyStreamEvent — so the shared decoder sees the SAME bytes Tauri delivered over its raw Channel.
type streamEvent struct {
	StreamID string `json:"streamId"`
	Type     string `json:"type"`
	Binary   bool   `json:"binary,omitempty"`
	Payload  any    `json:"payload,omitempty"`
}

type proxyStreamArgs struct {
	Payload proxyRequestPayload `json:"payload"`
	// The JS WailsChannel serializes (toJSON) to its numeric id; stream events are emitted to "stream://<channel>".
	Channel uint64 `json:"channel"`
}

type proxyStreamDestroyArgs struct {
	StreamID string `json:"streamId"`
}

// RequestStream sends the request, returns the handle once headers arrive (open bounded at 15s), then pumps body
// chunks to "stream://<channel>" until EOF (end) or error. The pump goroutine is cancelable via StreamDestroy.
func (s *ProxyService) RequestStream(args proxyStreamArgs) (ProxyStreamHandle, error) {
	socket, err := resolveProxyTarget(args.Payload)
	if err != nil {
		return ProxyStreamHandle{}, err
	}
	httpReq, err := buildProxyRequest(args.Payload.Req)
	if err != nil {
		return ProxyStreamHandle{}, err
	}
	ctx, cancel := context.WithCancel(context.Background())

	// Bound only the OPEN: client.Do returns once response headers are read; race it against the open timeout.
	type doResult struct {
		resp *http.Response
		err  error
	}
	done := make(chan doResult, 1)
	go func() {
		//nolint:bodyclose // The body is closed by the pump goroutine below (success) or drained on open-timeout.
		resp, doErr := s.clientFor(socket).Do(httpReq.WithContext(ctx))
		done <- doResult{resp, doErr}
	}()

	var response *http.Response
	select {
	case res := <-done:
		if res.err != nil {
			cancel()
			return ProxyStreamHandle{}, res.err
		}
		response = res.resp
	case <-time.After(proxyStreamOpenTimeoutMs * time.Millisecond):
		cancel()
		// If Do wins the race just after the timeout, close its body so the connection is not leaked.
		go func() {
			if res := <-done; res.resp != nil {
				_ = res.resp.Body.Close()
			}
		}()
		return ProxyStreamHandle{}, errors.New("stream open timeout")
	}

	streamID := fmt.Sprintf("cps-%d", s.counter.Add(1))
	eventName := fmt.Sprintf("stream://%d", args.Channel)
	// Container logs are binary (docker's multiplexed frame headers + arbitrary bytes); everything else (/events,
	// /build) is JSON text. Mirrors proxy.rs's `url.contains("/logs")` binary switch.
	binary := strings.Contains(args.Payload.Req.URL, "/logs")
	s.registerStream(streamID, cancel)

	go func() {
		defer func() { _ = response.Body.Close() }()
		defer s.removeStream(streamID)
		buf := make([]byte, 32*1024)
		for {
			n, readErr := response.Body.Read(buf)
			if n > 0 {
				if binary {
					s.emitStream(eventName, streamEvent{StreamID: streamID, Type: "data", Binary: true, Payload: base64.StdEncoding.EncodeToString(buf[:n])})
				} else {
					s.emitStream(eventName, streamEvent{StreamID: streamID, Type: "data", Payload: string(buf[:n])})
				}
			}
			if readErr == io.EOF {
				s.emitStream(eventName, streamEvent{StreamID: streamID, Type: "end"})
				return
			}
			if readErr != nil {
				if ctx.Err() != nil {
					return // destroyed / aborted — suppress the error event
				}
				s.emitStream(eventName, streamEvent{StreamID: streamID, Type: "error", Payload: map[string]string{"message": readErr.Error()}})
				return
			}
		}
	}()

	return ProxyStreamHandle{Stream: true, StreamID: streamID, Status: response.StatusCode, Headers: collectHeaders(response.Header)}, nil
}

// StreamDestroy aborts a stream's chunk pump (from the JS emitter's destroy/close). Mirrors proxy_stream_destroy.
func (s *ProxyService) StreamDestroy(args proxyStreamDestroyArgs) {
	s.mu.Lock()
	cancel, ok := s.streams[args.StreamID]
	if ok {
		delete(s.streams, args.StreamID)
	}
	s.mu.Unlock()
	if ok {
		cancel()
	}
}

func (s *ProxyService) registerStream(id string, cancel context.CancelFunc) {
	s.mu.Lock()
	if s.streams == nil {
		s.streams = map[string]context.CancelFunc{}
	}
	s.streams[id] = cancel
	s.mu.Unlock()
}

func (s *ProxyService) removeStream(id string) {
	s.mu.Lock()
	delete(s.streams, id)
	s.mu.Unlock()
}

// emitStream pushes a stream event to the renderer (test override or the live Wails app emitter — see events.go).
func (s *ProxyService) emitStream(name string, event streamEvent) {
	emitToRenderer(s.emit, name, event)
}
