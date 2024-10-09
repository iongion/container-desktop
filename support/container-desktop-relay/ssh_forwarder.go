// Original source: https://github.com/containers/gvisor-tap-vsock/blob/main/pkg/sshclient/ssh_forwarder.go
package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/containers/gvisor-tap-vsock/pkg/fs"
	"github.com/containers/gvisor-tap-vsock/pkg/sshclient"
	"github.com/pkg/errors"
	"github.com/sirupsen/logrus"
)

type CloseWriteStream interface {
	io.Reader
	io.WriteCloser
	CloseWrite() error
}

type CloseWriteConn interface {
	net.Conn
	CloseWriteStream
}

type SSHForward struct {
	listener net.Listener
	bastion  *sshclient.Bastion
	sock     *url.URL
}

type SSHDialer interface {
	DialContextTCP(ctx context.Context, addr string) (net.Conn, error)
}

type genericTCPDialer struct {
}

const initialBackoff = 100 * time.Millisecond

var defaultTCPDialer genericTCPDialer

func (dialer *genericTCPDialer) DialContextTCP(ctx context.Context, addr string) (net.Conn, error) {
	var d net.Dialer
	return d.DialContext(ctx, "tcp", addr)
}

func CreateSSHForward(ctx context.Context, src *url.URL, dest *url.URL, identity string, dialer SSHDialer, maxRetries int) (*SSHForward, error) {
	if dialer == nil {
		dialer = &defaultTCPDialer
	}

	return setupProxy(ctx, src, dest, identity, "", dialer, maxRetries)
}

func CreateSSHForwardPassphrase(ctx context.Context, src *url.URL, dest *url.URL, identity string, passphrase string, dialer SSHDialer, maxRetries int) (*SSHForward, error) {
	if dialer == nil {
		dialer = &defaultTCPDialer
	}

	return setupProxy(ctx, src, dest, identity, passphrase, dialer, maxRetries)
}

func (forward *SSHForward) AcceptAndTunnel(ctx context.Context) error {
	return acceptConnection(ctx, forward.listener, forward.bastion, forward.sock)
}

func (forward *SSHForward) Tunnel(ctx context.Context) (CloseWriteConn, error) {
	return connectForward(ctx, forward.bastion)
}

func (forward *SSHForward) Close() {
	if forward.listener != nil {
		forward.listener.Close()
	}
	if forward.bastion != nil {
		forward.bastion.Close()
	}
}

func connectForward(ctx context.Context, bastion *sshclient.Bastion) (CloseWriteConn, error) {
	for retries := 1; ; retries++ {
		forward, err := bastion.Client.Dial("unix", bastion.Path)
		if err == nil {
			return forward.(CloseWriteConn), nil
		}
		if retries > 2 {
			return nil, errors.Wrapf(err, "Couldn't reestablish ssh tunnel on path: %s", bastion.Path)
		}
		// Check if ssh connection is still alive
		_, _, err = bastion.Client.Conn.SendRequest("alive@gvproxy", true, nil)
		if err != nil {
			for bastionRetries := 1; ; bastionRetries++ {
				err = bastion.Reconnect(ctx)
				if err == nil {
					break
				}
				if bastionRetries > 2 || !sleep(ctx, 200*time.Millisecond) {
					return nil, errors.Wrapf(err, "Couldn't reestablish ssh connection: %s", bastion.Host)
				}
			}
		}

		if !sleep(ctx, 200*time.Millisecond) {
			retries = 3
		}
	}
}

func listenUnix(socketURI *url.URL) (net.Listener, error) {
	path := socketURI.Path
	if runtime.GOOS == "windows" {
		path = strings.TrimPrefix(path, "/")
	}

	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return nil, err
	}

	oldmask := fs.Umask(0177)
	defer fs.Umask(oldmask)
	listener, err := net.Listen("unix", path)
	if err != nil {
		return listener, errors.Wrapf(err, "Error listening on socket: %s", socketURI.Path)
	}

	return listener, nil
}

func setupProxy(ctx context.Context, socketURI *url.URL, dest *url.URL, identity string, passphrase string, dialer SSHDialer, maxRetries int) (*SSHForward, error) {
	var (
		listener net.Listener
		err      error
	)
	switch socketURI.Scheme {
	case "unix":
		listener, err = listenUnix(socketURI)
		if err != nil {
			return &SSHForward{}, err
		}
	case "npipe":
		listener, err = sshclient.ListenNpipe(socketURI)
		if err != nil {
			return &SSHForward{}, err
		}
	case "":
		// empty URL = Tunnel Only, no Accept
	default:
		return &SSHForward{}, errors.Errorf("URI scheme not supported: %s", socketURI.Scheme)
	}

	connectFunc := func(ctx context.Context, bastion *sshclient.Bastion) (net.Conn, error) {
		timeout := 5 * time.Second
		if bastion != nil {
			timeout = bastion.Config.Timeout
		}
		ctx, cancel := context.WithTimeout(ctx, timeout)
		conn, err := dialer.DialContextTCP(ctx, dest.Host)
		if cancel != nil {
			cancel()
		}

		return conn, err
	}

	createBastion := func() (*sshclient.Bastion, error) {
		conn, err := connectFunc(ctx, nil)
		if err != nil {
			return nil, err
		}
		return sshclient.CreateBastion(dest, passphrase, identity, conn, connectFunc)
	}
	bastion, err := retry(ctx, createBastion, "Waiting for sshd", maxRetries)
	if err != nil {
		return &SSHForward{}, fmt.Errorf("setupProxy failed: %w", err)
	}

	logrus.Debugf("Socket forward established: %s -> %s\n", socketURI.Path, dest.Path)

	return &SSHForward{listener, bastion, socketURI}, nil
}

func retry[T comparable](ctx context.Context, retryFunc func() (T, error), retryMsg string, maxRetries int) (T, error) {
	var (
		returnVal T
		err       error
	)

	backoff := initialBackoff

loop:
	for i := 0; i < maxRetries; i++ {
		select {
		case <-ctx.Done():
			break loop
		default:
			// proceed
		}

		returnVal, err = retryFunc()
		if err == nil {
			return returnVal, nil
		}
		logrus.Debugf("%s (%s)", retryMsg, backoff)
		sleep(ctx, backoff)
		backoff = backOff(backoff)
	}
	return returnVal, fmt.Errorf("timeout: %w", err)
}

func acceptConnection(ctx context.Context, listener net.Listener, bastion *sshclient.Bastion, socketURI *url.URL) error {
	con, err := listener.Accept()
	if err != nil {
		return errors.Wrapf(err, "Error accepting on socket: %s", socketURI.Path)
	}

	src, ok := con.(CloseWriteStream)
	if !ok {
		con.Close()
		return errors.Wrapf(err, "Underlying socket does not support half-close %s", socketURI.Path)
	}

	var dest CloseWriteStream

	dest, err = connectForward(ctx, bastion)
	if err != nil {
		con.Close()
		logrus.Error(err)
		return nil // eat
	}

	complete := new(sync.WaitGroup)
	complete.Add(2)
	go forward(src, dest, complete)
	go forward(dest, src, complete)

	go func() {
		complete.Wait()
		src.Close()
		dest.Close()
	}()

	return nil
}

func forward(src io.ReadCloser, dest CloseWriteStream, complete *sync.WaitGroup) {
	defer complete.Done()
	_, _ = io.Copy(dest, src)

	// Trigger an EOF on the other end
	_ = dest.CloseWrite()
}

func backOff(delay time.Duration) time.Duration {
	if delay == 0 {
		delay = 5 * time.Millisecond
	} else {
		delay *= 2
	}
	if delay > time.Second {
		delay = time.Second
	}
	return delay
}

func sleep(ctx context.Context, wait time.Duration) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(wait):
		return true
	}
}
