package main

// container-desktop-relay (linux build) — "bridge" mode.
//
// Bridges a container engine's unix socket to this process's stdin/stdout so the
// desktop app can reach a Podman/Docker engine running inside a WSL distribution
// over a single `wsl.exe --exec` stdio channel: named pipe <-> stdio <-> unix
// socket. No TCP listener, no SSH server, no keys, no files left behind.
//
// The Windows build of this same module (main_windows.go) provides "relay" mode,
// which bridges a Windows named pipe to a remote engine socket over SSH.

import (
	"flag"
	"io"
	"net"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	log "github.com/sirupsen/logrus"
)

// linux/amd64 prctl numbers. Ask the kernel to SIGKILL us if our parent (the
// wsl.exe invocation spawned by the app) dies, so no bridge process is ever left
// behind inside the distribution. Matches the build matrix (amd64) used today.
const (
	sysPrctl       = 157
	prSetPdeathsig = 1
)

func init() {
	log.SetFormatter(&log.JSONFormatter{})
	log.SetOutput(os.Stderr)
	lvl, ok := os.LookupEnv("LOG_LEVEL")
	if !ok {
		lvl = "debug"
	}
	ll, err := log.ParseLevel(lvl)
	if err != nil {
		ll = log.DebugLevel
	}
	log.SetLevel(ll)
}

func setParentDeathSignal() {
	if _, _, errno := syscall.Syscall(sysPrctl, prSetPdeathsig, uintptr(syscall.SIGKILL), 0); errno != 0 {
		log.Warnf("could not set parent death signal: %v", errno)
	}
}

// dialWithRetry connects to the engine unix socket, retrying briefly so a
// just-started engine (or a socket that appears a moment later) still connects.
func dialWithRetry(socketPath string, attempts int, delay time.Duration) (*net.UnixConn, error) {
	var lastErr error
	for range attempts {
		conn, err := net.Dial("unix", socketPath)
		if err == nil {
			return conn.(*net.UnixConn), nil
		}
		lastErr = err
		time.Sleep(delay)
	}
	return nil, lastErr
}

// bridge copies in->conn and conn->out concurrently, half-closing each side on
// EOF so request/response framing is preserved, and returns once both directions
// have finished.
func bridge(conn *net.UnixConn, in io.Reader, out io.WriteCloser) {
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _ = io.Copy(conn, in)
		_ = conn.CloseWrite()
	}()
	go func() {
		defer wg.Done()
		_, _ = io.Copy(out, conn)
		_ = out.Close()
	}()
	wg.Wait()
}

func main() {
	mode := flag.String("mode", "bridge", `relay mode (linux build supports only "bridge")`)
	socketPath := flag.String("socket", "", "engine unix socket path to bridge to stdio")
	retries := flag.Int("retry", 50, "connection attempts before giving up")
	flag.Parse()

	if *mode != "bridge" {
		log.Fatalf(`unsupported mode %q (linux build supports only "bridge")`, *mode)
	}
	if *socketPath == "" {
		log.Fatalln("missing required flag: --socket <unix-socket-path>")
	}

	setParentDeathSignal()

	sigc := make(chan os.Signal, 1)
	signal.Notify(sigc, os.Interrupt, syscall.SIGHUP, syscall.SIGINT, syscall.SIGTERM, syscall.SIGQUIT)
	go func() {
		<-sigc
		os.Exit(0)
	}()

	log.Debugf("Bridging unix socket %s to stdio", *socketPath)
	conn, err := dialWithRetry(*socketPath, *retries, 100*time.Millisecond)
	if err != nil {
		log.Fatalf("Could not connect to %s: %v", *socketPath, err)
	}
	defer conn.Close()

	bridge(conn, os.Stdin, os.Stdout)
	log.Debugln("Bridge closed")
}
