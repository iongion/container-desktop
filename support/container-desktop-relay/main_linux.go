package main

import (
	"bytes"
	"context"
	"encoding/csv"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	log "github.com/sirupsen/logrus"

	"golang.org/x/crypto/ssh"
	"golang.org/x/sync/errgroup"
)

var (
	watchProcessTermination bool
	port                    int
	host                    string
	bufferSize              int
	pollInterval            int
	parentProcessPid        int
	maxRequestWaitTime      int
	// Special
	identityPath       string
	knownHostsPath     string
	authorizedKeysPath string
	generateKeyPair    bool
)

var cancelFunc context.CancelFunc
var stopChan = make(chan os.Signal, 1)

const (
	PRCTL_SYSCALL    = 157
	PR_SET_PDEATHSIG = 1
)

type streamLocalDirect struct {
	SocketPath string
	Reserved0  string
	Reserved1  uint32
}

func init() {
	flag.StringVar(&host, "host", "127.0.0.1", "The SSH connection host")
	flag.IntVar(&port, "port", 20022, "The SSH connection port")
	flag.IntVar(&bufferSize, "buffer-size", 4096, "The I/O buffer size")
	flag.BoolVar(&watchProcessTermination, "watch-process-termination", false, "Watch for process termination(WSL patch)")
	flag.IntVar(&pollInterval, "poll-interval", 2, "Parent process polling interval in seconds - default is 2 seconds")
	flag.IntVar(&parentProcessPid, "parent-process-pid", -1, "Parent process PID(Windows PID) - used to watch for process termination")
	flag.IntVar(&maxRequestWaitTime, "max-request-wait-time", 5, "Maximum time to wait for a request in seconds")
	// Special
	flag.BoolVar(&generateKeyPair, "generate-key-pair", false, "Generate SSH RSA key pair - it overwrites existing key pair")
	flag.StringVar(&identityPath, "identity-path", filepath.Join(getHome(), ".ssh", "id_rsa"), "Path to the SSH connection private key")
	flag.StringVar(&knownHostsPath, "known-hosts-path", filepath.Join(getHome(), ".ssh", "known_hosts"), "Path to the SSH known hosts file")
	flag.StringVar(&authorizedKeysPath, "authorized-keys-path", filepath.Join(getHome(), ".ssh", "authorized_keys"), "Path to the SSH authorized keys file")
	//
	flag.Usage = func() {
		flag.PrintDefaults()
	}
	// Setup logging
	log.SetFormatter(&log.JSONFormatter{})
	log.SetOutput(os.Stderr)
	// Decode log level
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

func handleRequests(reqs <-chan *ssh.Request) {
	for range reqs {
		log.Debugln("Received request")
	}
}

func cleanupSockAndChannel(sock net.Conn, channel ssh.Channel) {
	if sock != nil {
		err := sock.Close()
		if err != nil {
			log.Debugf("Error closing sock: %v\n", err)
		}
	}
	if channel != nil {
		err := channel.CloseWrite()
		if err != nil {
			log.Debugf("Error closing channel write: %v\n", err)
		}
		err = channel.Close()
		if err != nil {
			log.Debugf("Error closing channel: %v\n", err)
		}
	}
}

func handleChannels(chans <-chan ssh.NewChannel) {
	directMsg := streamLocalDirect{}
	for newChannel := range chans {
		if t := newChannel.ChannelType(); t != "direct-streamlocal@openssh.com" {
			newChannel.Reject(ssh.UnknownChannelType, fmt.Sprintf("Channel type is no supported: %s", t))
			continue
		}
		if err := ssh.Unmarshal(newChannel.ExtraData(), &directMsg); err != nil {
			log.Debugf("Could not direct-streamlocal data: %s\n", err)
			newChannel.Reject(ssh.Prohibited, "invalid format")
			return
		}
		channel, _, err := newChannel.Accept()
		if err != nil {
			log.Debugf("Could not accept channel: %s\n", err)
			continue
		}

		// Handle channel
		socketPath := directMsg.SocketPath
		if len(socketPath) == 0 {
			log.Debugln("Channel socket path must be provided")
			newChannel.Reject(ssh.Prohibited, "Channel socket path must be provided")
			channel.Close()
			continue
		}
		log.Tracef("Connecting to socket: <%s>\n", socketPath)
		sock, err := net.Dial("unix", socketPath)
		if err != nil {
			log.Debugf("Could not dial unix socket %s: %v\n", socketPath, err)
			channel.Close()
			continue
		}

		defer func() {
			log.Debugln("Completion - closing sock and channel")
			cleanupSockAndChannel(sock, channel)
		}()

		// I/O operations are done in separate goroutines
		var wg sync.WaitGroup
		defer wg.Wait()

		// Reading from the channel and writing to the socket
		wg.Add(1)
		go func() {
			buffer := make([]byte, bufferSize)
			for {
				n, err := channel.Read(buffer)
				if err != nil {
					if err != io.EOF {
						log.Tracef("Error reading from channel: %v\n", err)
					} else {
						log.Trace("Channel read complete - EOF reached")
					}
					break
				}
				if n > 0 {
					_, writeErr := sock.Write(buffer[:n])
					if writeErr != nil {
						log.Tracef("Error writing to sock: %v\n", writeErr)
						break
					}
					log.Tracef("Wrote %d bytes from channel to sock\n", n)
				}
			}
			wg.Done()
		}()

		// Reading from the socket and writing to the channel
		wg.Add(1)
		go func() {
			buffer := make([]byte, bufferSize)
			for {
				n, err := sock.Read(buffer)
				if err != nil {
					if err != io.EOF {
						log.Tracef("Error reading from sock: %v\n", err)
					} else {
						log.Trace("Sock read complete - EOF reached")
					}
					break
				}
				if n > 0 {
					_, writeErr := channel.Write(buffer[:n])
					if writeErr != nil {
						log.Tracef("Error writing to channel: %v", writeErr)
						break
					}
					log.Tracef("Wrote %d bytes from sock to channel", n)
				}
			}
			log.Trace("Read complete or timeout - closing sock and channel")
			cleanupSockAndChannel(sock, channel)
			wg.Done()
		}()
	}
}

func handleConnection(conn net.Conn, sshConfig *ssh.ServerConfig) {
	ssh_conn, channels, requests, err := ssh.NewServerConn(conn, sshConfig)
	if err != nil {
		log.Errorf("Unable to relay TCP to SSH: %v\n", err)
		conn.Close()
		return
	}
	log.Debugf("Logged in with key %s\n", ssh_conn.Permissions.Extensions["pubkey-fp"])
	var wg sync.WaitGroup
	defer wg.Wait()

	wg.Add(1)
	go func() {
		ssh.DiscardRequests(requests)
		wg.Done()
	}()

	wg.Add(1)
	go func(in <-chan *ssh.Request) {
		handleRequests(in)
		wg.Done()
	}(requests)

	wg.Add(1)
	go func() {
		defer func() {
			wg.Done()
		}()
		handleChannels(channels)
	}()
}

func nativeProcessExists(pid int32) (bool, error) {
	if pid <= 0 {
		return false, fmt.Errorf("invalid pid %v", pid)
	}
	proc, err := os.FindProcess(int(pid))
	if err != nil {
		return false, err
	}
	err = proc.Signal(syscall.Signal(0))
	if err == nil {
		return true, nil
	}
	if err.Error() == "os: process already finished" {
		return false, nil
	}
	errno, ok := err.(syscall.Errno)
	if !ok {
		return false, err
	}
	switch errno {
	case syscall.ESRCH:
		return false, nil
	case syscall.EPERM:
		return true, nil
	}
	return false, err
}

func isProcessRunning(ctx context.Context, windowsPid int, linuxPid int) bool {
	// Detecting if a process is running on Linux
	flag, err := nativeProcessExists(int32(linuxPid))
	if err != nil {
		log.Errorf("Error checking process: %v\n", err)
	}
	if !flag {
		log.Debugf("Linux process %d is no longer running - shutting down\n", linuxPid)
		return false
	}
	// Detecting if a process is running on Windows
	cmd := exec.CommandContext(ctx, "tasklist.exe", "/fo", "CSV", "/fi", fmt.Sprintf("PID eq %d", windowsPid))
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if err != nil {
		log.Errorf("Error checking process: %v\n", err)
		return false
	}
	cleaned := strings.TrimSpace(string(out))
	csvReader := csv.NewReader(strings.NewReader(cleaned))
	records, err := csvReader.ReadAll()
	if err != nil {
		log.Errorf("Error parsing process list CSV: %v\n", err)
		return false
	}
	log.Tracef("Process running check: %s - %v\n", cleaned, records)
	return len(records) > 1 && cmd.ProcessState.Success()
}

func watchProcess(ctx context.Context, processPid int) {
	for {
		if processPid > 0 {
			if isProcessRunning(ctx, processPid, os.Getpid()) {
				log.Tracef("Process %d is still running\n", processPid)
			} else {
				log.Debugf("Process %d is no longer running - shutting down\n", processPid)
				break
			}
		}
		time.Sleep(time.Duration(pollInterval) * time.Second)
	}
	stopChan <- syscall.SIGINT
	os.Exit(0)
}

func setKillSignal() {
	_, _, errno := syscall.RawSyscall(uintptr(PRCTL_SYSCALL), uintptr(PR_SET_PDEATHSIG), uintptr(syscall.SIGKILL), 0)
	if errno != 0 {
		log.Debugf("Error setting parent death signal: %v", errno)
		os.Exit(127 + int(errno))
	}
	// here's the check that prevents an orphan due to the possible race
	// condition
	// if strconv.Itoa(os.Getppid()) != os.Getenv("PARENT_PID") {
	// 	os.Exit(1)
	// }
}

func main() {
	flag.Parse()

	setKillSignal()

	address := fmt.Sprintf("%s:%d", host, port)
	log.Debugf("Starting ssh server on %s\n", address)

	ctx, cancelFunc := context.WithCancel(context.Background())
	group, ctx := errgroup.WithContext(ctx)
	defer cancelFunc()

	signal.Notify(stopChan,
		os.Interrupt,
		syscall.SIGHUP,
		syscall.SIGINT,
		syscall.SIGTERM,
		syscall.SIGQUIT,
		syscall.SIGSEGV)

	go func() {
		<-stopChan
		log.Debugln("Received termination signal")
		signal.Stop(stopChan)
		cancelFunc()
		log.Debugln("Exiting")
		os.Exit(0)
	}()

	if watchProcessTermination {
		log.Debugf("Watching process termination - spawned by parent pid %d as pid %d\n", parentProcessPid, os.Getpid())
		// Note - This is a WSL specific hack otherwise the process does not terminate
		// See - https://github.com/golang/go/issues/69845
		go watchProcess(ctx, parentProcessPid)
	} else {
		log.Debugln("Not watching process termination")
	}

	if generateKeyPair {
		if len(identityPath) == 0 {
			log.Errorln("Identity path must be specified when generating key pair - exiting")
			stopChan <- syscall.SIGINT
			return
		}
		log.Debugf("Identity path %s - keypair generation started\n", identityPath)
		WriteKeyPair(identityPath, authorizedKeysPath)
	} else {
		if len(identityPath) == 0 {
			log.Errorln("Identity path must be specified - exiting")
			stopChan <- syscall.SIGINT
			return
		}
	}

	// Read the private key from the identity path
	privateKey, publicKey, publicKeyPEM := ReadKeys(identityPath)

	sshConfig := &ssh.ServerConfig{
		NoClientAuth: false,
		PublicKeyCallback: func(conn ssh.ConnMetadata, connectionPublicKey ssh.PublicKey) (*ssh.Permissions, error) {
			log.Debugf("Login attempt by %s", conn.User())
			connectionPublicKeyPEM := ssh.MarshalAuthorizedKey(publicKey)
			matching := bytes.Compare(publicKeyPEM, connectionPublicKeyPEM) == 0
			if matching {
				return &ssh.Permissions{
					Extensions: map[string]string{
						"pubkey-fp": ssh.FingerprintSHA256(connectionPublicKey),
					},
				}, nil
			}
			return nil, fmt.Errorf("Keys are not matching - Unknown public key for %q\n", conn.User())
		},
	}

	sshConfig.AddHostKey(privateKey)

	log.Debugf("Starting listening for SSH connections on %s\n", address)
	listener, err := net.Listen("tcp", address)
	if err != nil {
		log.Debugf("Unable to listen to address: %v\n", err)
		stopChan <- syscall.SIGINT
		return
	}

loop:
	for {
		select {
		case <-ctx.Done():
			break loop
		default:
			// proceed
		}
		conn, err := listener.Accept()
		if err != nil {
			log.Debugf("Unable to accept listener: %v\n", err)
			break
		}
		defer func() {
			log.Debugln("Closing connection")
			err = conn.Close()
			if err != nil {
				log.Debugf("Unable to close connection: %v\n", err)
			}
		}()
		go handleConnection(conn, sshConfig)
	}

	log.Debugln("Waiting for worker group")
	if err := group.Wait(); err != nil {
		log.Debugf("Error occurred in execution group: %s\n", err.Error())
	}

	stopChan <- syscall.SIGINT
}
