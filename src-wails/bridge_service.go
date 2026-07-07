package main

import (
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

// BridgeService is the remote-connection data plane — SSH/WSL dial-stdio bridges + ssh -NL tunnels, the Go analog
// of src-tauri/src/bridge.rs. Engine-agnostic: the shared JS arg builders hand it a bridgeSpec { kind, key,
// localAddress, launcher, argv }. ProxyService dials localAddress after ensure. Bridges are cached by key (reused
// across a webview reload / reconnect); proxy_bridge_stop tears one down.
//
// Two kinds: "stdio" = a local listener (unix socket / windows named pipe) that per incoming connection spawns
// `launcher argv` and shuttles RAW bytes both ways (the dial-stdio bridge); "tunnel" = a long-lived `ssh -NL`
// child whose forwarded local socket is dialed once it appears.
type BridgeService struct{}

// bridges is the shared manager: ProxyService.resolveProxyTarget ensures, BridgeService.Stop stops. Package-level
// because Wails registers services independently — there is no cross-service DI (the Tauri State analog).
var bridges = &bridgeManager{}

type bridgeManager struct {
	mu      sync.Mutex
	entries map[string]*bridgeEntry
}

type bridgeEntry struct {
	stop func()
}

type proxyBridgeStopArgs struct {
	Key string `json:"key"`
}

// Stop tears down a connection's bridge by cache key (relay for SSH, connection id for WSL). The JS binding calls
// it for both candidate keys; the non-matching one is a no-op. Mirrors bridge.rs proxy_bridge_stop.
func (s *BridgeService) Stop(args proxyBridgeStopArgs) {
	bridges.stop(args.Key)
}

// ensure brings the bridge up (or reuses a cached one) and returns the LOCAL socket/pipe path ProxyService dials.
func (m *bridgeManager) ensure(spec bridgeSpec) (string, error) {
	if spec.LocalAddress == "" {
		return "", errors.New("bridge localAddress is empty (the remote connection has no local forward socket)")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.entries == nil {
		m.entries = map[string]*bridgeEntry{}
	}
	if _, ok := m.entries[spec.Key]; ok {
		return spec.LocalAddress, nil
	}
	var entry *bridgeEntry
	var err error
	switch spec.Kind {
	case "stdio":
		entry, err = startStdioBridge(spec)
	case "tunnel":
		entry, err = startTunnel(spec)
	default:
		return "", fmt.Errorf("unknown bridge kind: %s", spec.Kind)
	}
	if err != nil {
		return "", err
	}
	m.entries[spec.Key] = entry
	return spec.LocalAddress, nil
}

func (m *bridgeManager) stop(key string) {
	m.mu.Lock()
	entry, ok := m.entries[key]
	if ok {
		delete(m.entries, key)
	}
	m.mu.Unlock()
	if ok {
		entry.stop()
	}
}

// startStdioBridge binds the platform listener (newStdioListener) and accepts forever, spawning a per-connection
// dial-stdio relay. stop() closes the listener (ending accept) + removes the unix socket.
func startStdioBridge(spec bridgeSpec) (*bridgeEntry, error) {
	listener, err := newStdioListener(spec.LocalAddress)
	if err != nil {
		return nil, err
	}
	go func() {
		for {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			go bridgeConnection(conn, spec.Launcher, spec.Argv)
		}
	}()
	address := spec.LocalAddress
	return &bridgeEntry{stop: func() {
		_ = listener.Close()
		removeLocalSocket(address)
	}}, nil
}

// bridgeConnection spawns `launcher argv` and shuttles RAW bytes conn↔child-stdio both ways until each side hits
// EOF (mirrors Node's .pipe() half-close forwarding). Nothing is decoded. Mirrors bridge.rs bridge_*_connection.
func bridgeConnection(conn net.Conn, launcher string, argv []string) {
	defer func() { _ = conn.Close() }()
	cmd := exec.Command(launcher, argv...)
	configureHiddenWindow(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return
	}
	if err := cmd.Start(); err != nil {
		return
	}
	var both sync.WaitGroup
	both.Add(2)
	// client → daemon; on client EOF, close the child's stdin (a pipe signals EOF only by closing the write fd).
	go func() {
		defer both.Done()
		_, _ = io.Copy(stdin, conn)
		_ = stdin.Close()
	}()
	// daemon → client; on EOF, half-close the connection's write side (a unix socket / named pipe honors CloseWrite).
	go func() {
		defer both.Done()
		_, _ = io.Copy(conn, stdout)
		if halfCloser, ok := conn.(interface{ CloseWrite() error }); ok {
			_ = halfCloser.CloseWrite()
		}
	}()
	both.Wait()
	_ = cmd.Process.Kill()
	_ = cmd.Wait()
}

// startTunnel spawns a long-lived `ssh -NL` child and polls (~5s) for the forwarded local socket to appear,
// failing fast if the ssh child exits first (auth/host error). Mirrors bridge.rs start_tunnel.
func startTunnel(spec bridgeSpec) (*bridgeEntry, error) {
	removeLocalSocket(spec.LocalAddress)
	cmd := exec.Command(spec.Launcher, spec.Argv...)
	configureHiddenWindow(cmd)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	exited := &atomic.Bool{}
	go func() {
		_ = cmd.Wait()
		exited.Store(true)
	}()
	for range 50 {
		if _, statErr := os.Stat(spec.LocalAddress); statErr == nil {
			process := cmd.Process
			address := spec.LocalAddress
			return &bridgeEntry{stop: func() {
				_ = process.Kill()
				removeLocalSocket(address)
			}}, nil
		}
		if exited.Load() {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	_ = cmd.Process.Kill()
	return nil, errors.New("ssh -NL tunnel: local forward socket did not appear")
}

// removeLocalSocket unlinks a stale unix socket (no-op for a Windows named pipe, which is not a filesystem entry).
func removeLocalSocket(address string) {
	if runtime.GOOS != "windows" {
		_ = os.Remove(address)
	}
}
