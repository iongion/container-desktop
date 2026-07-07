//go:build !windows

package main

import (
	"net"
	"os"
)

// newStdioListener binds the unix-domain socket for a stdio bridge (Linux/macOS). A stale socket from a crashed
// run makes bind() fail with EADDRINUSE, so remove it first. Mirrors bridge.rs's #[cfg(unix)] start_stdio_bridge.
func newStdioListener(address string) (net.Listener, error) {
	_ = os.Remove(address)
	return net.Listen("unix", address)
}
