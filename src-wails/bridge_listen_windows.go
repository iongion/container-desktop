//go:build windows

package main

import (
	"net"
	"strings"

	"github.com/Microsoft/go-winio"
)

// newStdioListener creates the named-pipe server for a stdio bridge (Windows Docker-over-SSH + every WSL relay).
// The stripped path is `//./pipe/name`; the Win32 pipe API wants `\\.\pipe\name`. go-winio's listener handles the
// one-instance-per-client accept loop internally. Mirrors bridge.rs's #[cfg(windows)] start_stdio_bridge.
func newStdioListener(address string) (net.Listener, error) {
	return winio.ListenPipe(strings.ReplaceAll(address, "/", `\`), nil)
}
