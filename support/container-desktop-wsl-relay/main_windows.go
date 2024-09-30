//go:build windows

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
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/Microsoft/go-winio"
	"github.com/keybase/go-ps"
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
	parentPid    int
	namedPipe    string
	permissions  string
	bufferSize   int64
	pidFile      string
	pollInterval = 2
)

var signalChan chan (os.Signal) = make(chan os.Signal, 1)

func isProcessRunning(pid int) bool {
	// See https://github.com/golang/go/issues/33814
	// For testing shutdown use: powershell.exe -Command Start-Process -FilePath container-desktop-wsl-relay.exe -Wait
	process, err := ps.FindProcess(pid)
	if err != nil {
		return false
	}
	if runtime.GOOS == "windows" {
		// log.Printf("Checking for running process ID %d - %v\n", pid, process)
		if process != nil {
			return true
		}
	}
	return false
}

func watchParentProcess(parentPid int) {
	for {
		if parentPid > 0 {
			if !isProcessRunning(parentPid) {
				log.Printf("Parent process ID %d is no longer running - shutting down\n", parentPid)
				signalChan <- syscall.SIGINT
				return
			}
		} else {
			log.Println("Parent process ID is not provided yet")
		}
		time.Sleep(time.Duration(pollInterval) * time.Second)
	}
}

func init() {
	flag.StringVar(&distribution, "distribution", os.Getenv("WSL_DISTRO_NAME"), "WSL Distribution name of the parent process")
	flag.IntVar(&parentPid, "parent-pid", -1, "Parent WSL Distribution process ID")
	flag.IntVar(&pollInterval, "poll-interval", 2, "Parent process polling interval in seconds - default is 2 seconds")
	flag.StringVar(&namedPipe, "pipe", "\\\\.\\pipe\\container-desktop", "Named pipe to relay through")
	flag.StringVar(&permissions, "permissions", "AllowCurrentUser", fmt.Sprintf("Named pipe permissions specifier - see https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights\nAvailable are:\n\tAllowServiceSystemAdmin=%s\n\tAllowCurrentUser=%s\n\tAllowEveryone=%s\n", AllowServiceSystemAdmin, AllowCurrentUser, AllowEveryone))
	flag.Int64Var(&bufferSize, "buffer-size", IO_BUFFER_SIZE, "I/O buffer size in bytes")
	flag.StringVar(&pidFile, "pid-file", "", "PID file path - The native Windows path where the native Windows PID is to be written")
	flag.Usage = func() {
		flag.PrintDefaults()
	}
	log.SetPrefix("[windows]")
	log.SetOutput(os.Stderr)
	// logFile, err := os.OpenFile("container-desktop-wsl-relay.exe.log", os.O_CREATE|os.O_APPEND|os.O_RDWR, 0666)
	// if err != nil {
	// 	panic(err)
	// }
	// mw := io.MultiWriter(os.Stderr, logFile)
	// log.SetOutput(mw)
}

var stdinCh = make(chan []byte)

func handleClient(conn net.Conn) {
	defer conn.Close()
	log.Printf("Client connected [%s]", conn.RemoteAddr().Network())

	// Create channels for bidirectional communication
	connCh := make(chan []byte)

	// Read from stdin and send to channel
	go func() {
		for {
			buffer := make([]byte, bufferSize)
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
			buffer := make([]byte, bufferSize)
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
				log.Printf("[stdin.closed] Client disconnected [%s]", conn.RemoteAddr().Network())
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
				log.Printf("[conn.closed] Client disconnected [%s]", conn.RemoteAddr().Network())
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

	// Termination signals
	go func() {
		<-signalChan
		log.Println("Received termination signal")
		signal.Stop(signalChan)
		log.Println("Canceling context")
		cancelFunc()
		log.Println("Exiting")
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
		log.Printf("Computed permissions are: %s\n", securityDescriptor)
	}

	// Write the PID of current process
	if len(pidFile) > 0 {
		log.Printf("Writing relay Windows PID %d to %s\n", os.Getpid(), pidFile)
		pidContents := []byte(strconv.FormatInt(int64(os.Getpid()), 10))
		err := os.WriteFile(pidFile, pidContents, 0644)
		if err != nil {
			panic(err)
		}
	}

	if parentPid > 0 {
		log.Printf("Reported parent process ID is %d\n", parentPid)
		// if os.Getppid() != int(parentPid) {
		// 	log.Fatalf("Parent process ID %d does not match expected %d", os.Getppid(), parentPid)
		// }
	}

	// Configure named pipe
	pc := &winio.PipeConfig{
		SecurityDescriptor: securityDescriptor,
		MessageMode:        false,
		InputBufferSize:    int32(bufferSize),
		OutputBufferSize:   int32(bufferSize),
	}
	// Listen on the named pipe
	listener, err := winio.ListenPipe(namedPipe, pc)
	if err != nil {
		log.Fatal("Relay server listen error:", err)
	}
	defer listener.Close()
	log.Printf("Relay server is now listening on: %s\n", namedPipe)
	go watchParentProcess(os.Getppid())
	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Fatal("Relay server accept error:", err)
		}
		go handleClient(conn)
	}
}
