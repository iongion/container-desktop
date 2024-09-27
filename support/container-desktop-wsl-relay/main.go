package main

import (
	"container-desktop-wsl-relay/internal/relay"
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

const (
	// NOTE: 16k since Linux OS is mostly setting this
	DefaultBufferSize = 16384
)

var (
	socketPath                   string
	tcpAddress                   string
	pidFile                      string
	bufferSize                   int
	unixToTCPHealthCheckDuration time.Duration
)

func init() {
	flag.StringVar(&socketPath, "socket", "/var/run/docker.sock", "Container engine socket path")
	flag.StringVar(&tcpAddress, "address", "localhost:8080", "TCP address to relay to")
	flag.StringVar(&pidFile, "pid-file", "", "PID file path")
	flag.IntVar(&bufferSize, "buffer-size", DefaultBufferSize, "Buffer size")
	flag.DurationVar(&unixToTCPHealthCheckDuration, "health-check-duration", 30*time.Second, "Health check duration")
	log.SetOutput(os.Stderr)
	log.SetPrefix("[linux]")
}

var signalChan chan (os.Signal) = make(chan os.Signal, 1)

func main() {
	flag.Parse()

	if len(socketPath) == 0 {
		log.Fatalln("blank/empty `src` specified")
	}

	if len(tcpAddress) == 0 {
		log.Fatalln("blank/empty `dst` specified")
	}

	if len(pidFile) > 0 {
		log.Printf("Writing PID to %s\n", pidFile)
		pidContents := []byte(strconv.FormatInt(int64(os.Getpid()), 10))
		err := os.WriteFile(pidFile, pidContents, 0644)
		if err != nil {
			panic(err)
		}
	}

	relayer, err := relay.NewUnixSocketTCP(
		unixToTCPHealthCheckDuration,
		socketPath,
		tcpAddress,
		bufferSize,
	)
	if err != nil {
		log.Fatalln("Couldn't create relay from unix socket to TCP", err)
	}

	defer close(signalChan)

	signal.Notify(signalChan,
		os.Interrupt,
		syscall.SIGHUP,
		syscall.SIGINT,
		syscall.SIGTERM,
		syscall.SIGQUIT,
		syscall.SIGSEGV)

	ctx, cancelFunc := context.WithCancel(context.Background())
	defer cancelFunc()

	// Ctrl+C handler
	go func() {
		<-signalChan
		signal.Stop(signalChan)
		cancelFunc()
		os.Exit(0)
	}()

	log.Printf("Relay from %s to %s\n", socketPath, tcpAddress)
	err = relayer.Relay(ctx)
	if err != nil {
		log.Fatalln("Couldn't create relay from unix socket to TCP", err)
	}
}
