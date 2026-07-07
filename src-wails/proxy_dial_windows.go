//go:build windows

package main

import (
	"context"
	"net"
	"strings"

	"github.com/Microsoft/go-winio"
)

// dialLocalTransport dials the engine's Windows named pipe. The stripped path is `//./pipe/name`; the Win32 pipe
// API wants `\\.\pipe\name`. Mirrors reqwest's ClientBuilder::windows_named_pipe (the #[cfg(windows)] arm).
func dialLocalTransport(ctx context.Context, socket string) (net.Conn, error) {
	return winio.DialPipeContext(ctx, strings.ReplaceAll(socket, "/", `\`))
}
