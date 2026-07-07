//go:build !windows

package main

import (
	"context"
	"net"
)

// dialLocalTransport dials the engine's unix-domain socket (Linux/macOS). The http.Transport's addr is ignored —
// every request over this client goes to the one socket, mirroring reqwest's ClientBuilder::unix_socket.
func dialLocalTransport(ctx context.Context, socket string) (net.Conn, error) {
	return (&net.Dialer{}).DialContext(ctx, "unix", socket)
}
