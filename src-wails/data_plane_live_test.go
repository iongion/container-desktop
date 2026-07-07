//go:build live

package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// Live data-plane smoke test against a REAL local engine (podman/docker) — build-tagged `live` so normal
// `go test ./...` never runs it (mirrors the renderer's *.live.test.ts convention). Proves the Phase-2 buffered
// data plane: ExecService.Execute (detection) + ProxyService.Request (the REST API over the unix socket).
//
//	go test -tags live -run TestLive -v ./...

func TestLiveExec(t *testing.T) {
	svc := &ExecService{}
	for _, launcher := range []string{"podman", "docker"} {
		res := svc.Execute(CommandExecuteRequest{Launcher: launcher, Args: []string{"version", "--format", "{{.Client.Version}}"}})
		if res.Success {
			t.Logf("ExecService.Execute %s → %q (code=%v)", launcher, strings.TrimSpace(res.Stdout), res.Code)
			return
		}
	}
	t.Skip("no podman/docker on PATH")
}

func TestLiveProxyRequest(t *testing.T) {
	candidates := []struct{ engine, socket string }{
		{"podman", os.Getenv("XDG_RUNTIME_DIR") + "/podman/podman.sock"},
		{"docker", "/var/run/docker.sock"},
	}
	svc := &ProxyService{}
	for _, c := range candidates {
		if _, err := os.Stat(c.socket); err != nil {
			continue
		}
		ping := newLiveRequest(c.socket, "GET", "/version", nil)
		resp := svc.Request(ping)
		if !resp.OK {
			t.Fatalf("%s GET /version failed: status=%d message=%v", c.engine, resp.Status, resp.Message)
		}
		t.Logf("%s GET /version → status=%d ok=%v", c.engine, resp.Status, resp.OK)

		list := svc.Request(newLiveRequest(c.socket, "GET", "/containers/json", json.RawMessage(`{"all":"true"}`)))
		if !list.OK {
			t.Fatalf("%s GET /containers/json failed: status=%d message=%v", c.engine, list.Status, list.Message)
		}
		count := 0
		if arr, ok := list.Data.([]any); ok {
			count = len(arr)
		}
		t.Logf("%s GET /containers/json → status=%d containers=%d", c.engine, list.Status, count)
		return
	}
	t.Skip("no podman/docker socket present")
}

func newLiveRequest(socket, method, path string, params json.RawMessage) proxyRequestArgs {
	args := proxyRequestArgs{Payload: proxyRequestPayload{Req: proxyReq{Method: method, URL: path, Params: params}}}
	args.Payload.Connection.Settings.API.Connection.URI = "unix://" + socket
	return args
}

// Proves the streaming OPEN + teardown against a real engine's /events (long-lived) endpoint. emit is a no-op so
// a stray event in the open window can't panic on the (absent) live app emitter. newStreamArgs lives in
// proxy_stream_test.go (compiled into the same -tags live binary).
func TestLiveProxyStream(t *testing.T) {
	candidates := []struct{ engine, socket string }{
		{"podman", os.Getenv("XDG_RUNTIME_DIR") + "/podman/podman.sock"},
		{"docker", "/var/run/docker.sock"},
	}
	for _, c := range candidates {
		if _, err := os.Stat(c.socket); err != nil {
			continue
		}
		svc := &ProxyService{emit: func(string, any) {}}
		handle, err := svc.RequestStream(newStreamArgs(c.socket, "/events", 99))
		if err != nil {
			t.Fatalf("%s GET /events (stream) open: %v", c.engine, err)
		}
		if handle.Status != 200 || handle.StreamID == "" {
			t.Fatalf("%s bad stream handle: %+v", c.engine, handle)
		}
		t.Logf("%s /events stream opened → status=%d id=%s", c.engine, handle.Status, handle.StreamID)
		svc.StreamDestroy(proxyStreamDestroyArgs{StreamID: handle.StreamID})
		return
	}
	t.Skip("no podman/docker socket present")
}
