package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/signal"
	"os/user"
	"strings"
	"syscall"

	"github.com/Microsoft/go-winio"
)

// See https://github.com/docker/go-plugins-helpers/blob/main/sdk/windows_listener.go
const (
	IO_BUFFER_SIZE = 512
	// AllowEveryone grants full access permissions for everyone.
	AllowEveryone = "S:(ML;;NW;;;LW)D:(A;;0x12019f;;;WD)"
	// AllowCurrentUser grants full access permissions for the current user.
	AllowCurrentUser = "D:P(A;;GA;;;$SID)"
	// AllowServiceSystemAdmin grants full access permissions for Service, System, Administrator group and account.
	AllowServiceSystemAdmin = "D:(A;ID;FA;;;SY)(A;ID;FA;;;BA)(A;ID;FA;;;LA)(A;ID;FA;;;LS)"
)

var (
	distribution string
	parentPid    int64
	namedPipe    string
	permissions  string
)

var signalChan chan (os.Signal) = make(chan os.Signal, 1)

func init() {
	flag.StringVar(&distribution, "distribution", os.Getenv("WSL_DISTRO_NAME"), "WSL Distribution name of the parent process")
	flag.Int64Var(&parentPid, "parent-pid", -1, "Parent WSL Distribution process ID")
	flag.StringVar(&namedPipe, "pipe", "\\\\.\\pipe\\container-desktop", "Named pipe to relay through")
	flag.StringVar(&permissions, "permissions", "AllowCurrentUser", fmt.Sprintf("Named pipe permissions specifier - see https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights\nAvailable are:\n\tAllowServiceSystemAdmin=%s\n\tAllowCurrentUser=%s\n\tAllowEveryone=%s\n", AllowServiceSystemAdmin, AllowCurrentUser, AllowEveryone))
	flag.Usage = func() {
		flag.PrintDefaults()
	}
	log.SetOutput(os.Stderr)
	log.SetPrefix("[windows]")
}

var stdinCh = make(chan []byte)
var listener net.Listener

func handleClient(conn net.Conn) {
	defer conn.Close()
	log.Printf("Client connected [%s]", conn.RemoteAddr().Network())

	// Create channels for bidirectional communication
	connCh := make(chan []byte)

	// Read from stdin and send to channel
	go func() {
		for {
			buffer := make([]byte, IO_BUFFER_SIZE)
			n, err := os.Stdin.Read(buffer)
			if err != nil {
				if err != io.EOF {
					log.Printf("Error reading from stdin stdinCh: %v", err)
				}
				// close(stdinCh) // Close the channel on error or EOF
				return
			}
			stdinCh <- buffer[:n]
		}
	}()

	// Read from connection and send to channel
	go func() {
		for {
			buffer := make([]byte, IO_BUFFER_SIZE)
			n, err := conn.Read(buffer)
			if err != nil {
				if err != io.EOF {
					log.Printf("Error reading from connection connCh: %v", err)
				}
				close(connCh)
				return
			}
			connCh <- buffer[:n]
		}
	}()

	// Process data from both channels
	for {
		select {
		case data, ok := <-stdinCh:
			if !ok {
				// stdin channel closed, stop processing
				return
			}
			_, err := conn.Write(data)
			if err != nil {
				log.Printf("Error writing to connection: %v", err)
				return
			}
		case data, ok := <-connCh:
			if !ok {
				// connection channel closed, stop processing
				return
			}
			_, err := os.Stdout.Write(data)
			if err != nil {
				log.Printf("Error writing to stdout: %v", err)
				return
			}
		}
	}
}

func main() {
	flag.Parse()

	// Handle program exit
	defer close(signalChan)
	signal.Notify(signalChan,
		os.Interrupt,
		syscall.SIGHUP,
		syscall.SIGINT,
		syscall.SIGTERM,
		syscall.SIGQUIT,
		syscall.SIGSEGV)
	_, cancelFunc := context.WithCancel(context.Background())
	defer cancelFunc()
	// Ctrl+C handler
	go func() {
		<-signalChan
		signal.Stop(signalChan)
		cancelFunc()
		listener.Close()
		os.Exit(0)
	}()

	// Parse security descriptor
	securityDescriptor := AllowEveryone
	if len(permissions) > 0 {
		switch permissions {
		case "AllowServiceSystemAdmin":
			securityDescriptor = AllowServiceSystemAdmin
		case "AllowCurrentUser":
			securityDescriptor = AllowCurrentUser
		case "AllowEveryone":
			securityDescriptor = AllowEveryone
		default:
			securityDescriptor = permissions
		}
		if strings.Contains(securityDescriptor, "$SID") {
			currentUser, err := user.Current()
			if err != nil {
				log.Println("Relay server error retrieving current user:", err)
				return
			}
			securityDescriptor = strings.Replace(securityDescriptor, "$SID", currentUser.Uid, 1)
		}
		// log.Printf("Computed permissions are: %s\n", securityDescriptor)
	}

	// Configure named pipe
	pc := &winio.PipeConfig{
		SecurityDescriptor: securityDescriptor,
		MessageMode:        false,
		InputBufferSize:    IO_BUFFER_SIZE,
		OutputBufferSize:   IO_BUFFER_SIZE,
	}
	// Listen on the named pipe
	listener, err := winio.ListenPipe(namedPipe, pc)
	if err != nil {
		log.Fatal("Relay server listen error:", err)
	}
	defer listener.Close()
	log.Printf("Relay server is now listening on: %s\n", namedPipe)
	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Fatal("Relay server accept error:", err)
		}
		go handleClient(conn)
	}
}
