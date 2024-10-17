//go:build windows
// +build windows

package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	log "github.com/sirupsen/logrus"

	"github.com/Microsoft/go-winio"
	"github.com/containers/winquit/pkg/winquit"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
	"golang.org/x/sync/errgroup"
)

var (
	namedPipe     string
	sshConnection string
	sshTimeout    int
	maxRetries    int
	tidPath       string
	// Special
	identityPath       string
	knownHostsPath     string
	authorizedKeysPath string
	generateKeyPair    bool
	// Relay arguments
	distribution            string
	relayProgramPath        string
	watchProcessTermination bool
	port                    int
	host                    string
	bufferSize              int
	pollInterval            int
)

var relayProgramPid int = -1

func init() {
	flag.StringVar(&namedPipe, "named-pipe", "npipe:////./pipe/container-desktop", "Named pipe to relay through")
	flag.StringVar(&sshConnection, "ssh-connection", "", "The SSH connection string")
	flag.IntVar(&sshTimeout, "ssh-timeout", 5, "The SSH connection timeout in seconds")
	flag.StringVar(&tidPath, "tid-path", "", "Thread ID file path")
	flag.IntVar(&maxRetries, "max-retries", 5, "Maximum number of retries to connect to SSH server")
	// Special
	flag.BoolVar(&generateKeyPair, "generate-key-pair", false, "Generate SSH RSA key pair - it overwrites existing key pair")
	flag.StringVar(&identityPath, "identity-path", filepath.Join(getHome(), ".ssh", "id_rsa"), "Path to the SSH connection private key")
	flag.StringVar(&knownHostsPath, "known-hosts-path", filepath.Join(getHome(), ".ssh", "known_hosts"), "Path to the SSH known hosts file")
	flag.StringVar(&authorizedKeysPath, "authorized-keys-path", filepath.Join(getHome(), ".ssh", "authorized_keys"), "Path to the SSH authorized keys file")
	// Relay arguments
	flag.StringVar(&distribution, "distribution", "", "The WSL distribution")
	flag.StringVar(&relayProgramPath, "relay-program-path", "", "Path to the relay program")
	flag.StringVar(&host, "host", "127.0.0.1", "The SSH connection host")
	flag.IntVar(&port, "port", 20022, "The SSH connection port")
	flag.IntVar(&bufferSize, "buffer-size", 4096, "The I/O buffer size")
	flag.BoolVar(&watchProcessTermination, "watch-process-termination", false, "Watch for process termination(WSL patch)")
	flag.IntVar(&pollInterval, "poll-interval", 2, "Parent process polling interval in seconds - default is 2 seconds")
	// Flags
	flag.Usage = func() {
		flag.PrintDefaults()
	}
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

func HostKey(host string) ssh.PublicKey {
	fd, err := os.Open(knownHostsPath)
	if err != nil {
		log.Error(err)
		return nil
	}
	hashhost := knownhosts.HashHostname(host)
	scanner := bufio.NewScanner(fd)
	for scanner.Scan() {
		_, hosts, key, _, _, err := ssh.ParseKnownHosts(scanner.Bytes())
		if err != nil {
			log.Errorf("Failed to parse known_hosts: %s", scanner.Text())
			continue
		}
		for _, h := range hosts {
			if h == host || h == hashhost {
				return key
			}
		}
	}
	return nil
}

func waitForSSHConnection(secure bool) bool {
	log.Debugf("Parsing SSH connection to %s\n", sshConnection)
	dest, err := url.Parse(sshConnection)
	if err != nil {
		log.Errorf("Unable to parse ssh connection %v\n", err)
		return false
	}
	log.Debugf("Testing SSH connection to %s\n", dest)
	user := dest.User.Username()
	// Methods
	auth := []ssh.AuthMethod{}
	if len(identityPath) > 0 {
		signer, err := readIdentityFile(identityPath)
		if err != nil {
			log.Errorf("Unable to read identity file from %s: %v\n", identityPath, err)
			return false
		}
		auth = append(auth, ssh.PublicKeys(signer))
	}

	callback := ssh.InsecureIgnoreHostKey() // #nosec
	if secure {
		host := dest.Host
		key := HostKey(host)
		if key != nil {
			callback = ssh.FixedHostKey(key)
		}
	}

	config := &ssh.ClientConfig{
		User:            user,
		Auth:            auth,
		HostKeyCallback: callback,
		BannerCallback:  ssh.BannerDisplayStderr(),
		Timeout:         time.Second * time.Duration(sshTimeout),
	}
	// connect to ssh server
	log.Debugf("Dialing %s\n", dest.Host)
	conn, err := ssh.Dial("tcp", dest.Host, config)
	if err != nil {
		log.Error(err)
		return false
	}
	defer conn.Close()
	if _, _, err := conn.SendRequest(user+"@"+dest.Host, true, nil); err != nil { // keep alive
		log.Errorf("Error sending request: %v\n", err)
		return false
	}
	return true
}

func testNamedPipe() {
	dest, err := url.Parse(namedPipe)
	if err != nil {
		log.Fatal(err)
	}
	// Ensure named pipe is not already opened
	pipePath := strings.ReplaceAll(dest.Path, "/", "\\")
	log.Debugf("Trying to open named pipe %s\n", pipePath)
	f, err := winio.DialPipe(pipePath, nil)
	if err != nil {
		log.Debugln("Pipe is not opened, good...")
	} else {
		f.Close()
		log.Fatalf("Pipe already opened\n")
	}
}

func getWSLPath(distribution string, windowsPath string) (string, error) {
	if strings.HasPrefix(windowsPath, "/") {
		log.Debugf("Path appears to already by a WSL path for %s\n", windowsPath)
		return windowsPath, nil
	}
	args := []string{
		"--distribution",
		distribution,
		"--exec",
		"wslpath",
		windowsPath,
	}
	log.Debugf("Get WSL path: wsl.exe %s\n", strings.Join(args, " "))
	cmd := exec.Command("wsl.exe", args...)
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if err != nil {
		log.Debugf("Error getting WSL %s path %s: %v\n", distribution, windowsPath, err)
		return "", err
	}
	log.Debugf("WSL path for %s: %s\n", windowsPath, string(out))
	return strings.TrimSpace(string(out)), nil
}

func startRelayProgram(ctx context.Context) error {
	// Start the relay program
	wslIdentityPath, err := getWSLPath(distribution, identityPath)
	if err != nil {
		return err
	}
	wslRelayProgramPath, err := getWSLPath(distribution, relayProgramPath)
	if err != nil {
		return err
	}
	args := []string{
		"--distribution",
		distribution,
		"--exec",
		wslRelayProgramPath,
		"--host", host,
		"--port", fmt.Sprintf("%d", port),
		"--buffer-size", fmt.Sprintf("%d", bufferSize),
		"--poll-interval", fmt.Sprintf("%d", pollInterval),
		"--identity-path", wslIdentityPath,
		"--parent-process-pid", strconv.Itoa(os.Getpid()),
	}
	if watchProcessTermination {
		args = append(args, "--watch-process-termination")
	}
	log.Debugf("Starting relay program with args: wsl.exe %s\n", strings.Join(args, " "))
	relay := exec.CommandContext(ctx, "wsl.exe", args...)
	relay.SysProcAttr = &syscall.SysProcAttr{
		// CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
		// HideWindow: false,
	}
	relay.Stdout = os.Stdout
	relay.Stderr = os.Stderr
	if err := relay.Start(); err != nil {
		log.Errorf("Error starting relay program: %v\n", err)
		return err
	}
	relayProgramPid = relay.Process.Pid
	log.Debugf("Relay program started with PID: %d\n", relayProgramPid)
	err = relay.Wait()
	if err != nil {
		log.Errorf("Error waiting for relay program: %v\n", err)
	}
	return err
}

func saveThreadId(path string) (uint32, error) {
	stateDir := filepath.Dir(path)
	if _, err := os.Stat(stateDir); os.IsNotExist(err) {
		if err := os.MkdirAll(stateDir, 0755); err != nil {
			log.Debugf("Error creating state directory: %v\n", err)
			os.Exit(1)
		}
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_TRUNC|os.O_CREATE, 0644)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	tid := winquit.GetCurrentMessageLoopThreadId()
	fmt.Fprintf(file, "%d:%d", os.Getpid(), tid)
	return tid, nil
}

func readIdentityFile(file string) (ssh.Signer, error) {
	key, err := os.ReadFile(file)
	if err != nil {
		return nil, fmt.Errorf("Unable to read identity file: %v", err)
	}
	signer, err := ssh.ParsePrivateKey(key)
	if err != nil {
		return nil, fmt.Errorf("Unable to parse identity file: %v", err)
	}
	return signer, nil
}

func setupProxies(ctx context.Context, g *errgroup.Group, source string, destination string, identity string) error {
	var (
		src  *url.URL
		dest *url.URL
		err  error
	)
	if strings.Contains(source, "://") {
		src, err = url.Parse(source)
		if err != nil {
			return err
		}
	} else {
		src = &url.URL{
			Scheme: "unix",
			Path:   source,
		}
	}

	dest, err = url.Parse(destination)
	if err != nil {
		return err
	}

	g.Go(func() error {
		log.Debugf("Creating SSH relay from %s to %s\n", src.String(), dest.String())
		forward, err := CreateSSHForward(ctx, src, dest, identity, nil, maxRetries)
		if err != nil {
			log.Errorf("Error creating SSH forward: %v\n", err)
			return err
		}
		log.Debugf("Forwarding %s to %s\n", src.String(), dest.String())
		go func() {
			<-ctx.Done()
			// Abort pending accepts
			log.Debugln("Closing forward")
			forward.Close()
		}()
	loop:
		for {
			select {
			case <-ctx.Done():
				break loop
			default:
				// proceed
			}
			err := forward.AcceptAndTunnel(ctx)
			if err != nil {
				log.Errorf("Error occurred handling ssh forwarded connection: %q\n", err)
				break
			}
		}
		return nil
	})

	return nil
}

func main() {
	flag.Parse()
	log.Debugf("Starting container-desktop-ssh-relay to %s\n", sshConnection)

	ctx, cancelFunc := context.WithCancel(context.Background())
	group, ctx := errgroup.WithContext(ctx)
	defer cancelFunc()
	stopChan := make(chan os.Signal, 1)
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
		if relayProgramPid > -1 {
			log.Debugf("Killing relay program with PID: %d\n", relayProgramPid)
			err := exec.Command("taskkill", "/f", "/pid", strconv.Itoa(relayProgramPid)).Run()
			if err != nil {
				log.Debugf("Error killing relay program %d: %v\n", relayProgramPid, err)
			}
		}
		log.Debugln("Exiting")
		os.Exit(0)
	}()

	if len(tidPath) > 0 {
		_, err := saveThreadId(tidPath)
		if err != nil {
			log.Errorf("Error saving thread ID: %v\n", err)
			stopChan <- syscall.SIGINT
			return
		}
	}

	if generateKeyPair {
		if len(identityPath) == 0 {
			log.Error("Identity path must be specified when generating key pair - exiting")
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

	testNamedPipe()

	useSecureKey := len(relayProgramPath) == 0
	if len(relayProgramPath) > 0 {
		log.Debugln("Starting relay program")
		group.Go(func() error {
			error := startRelayProgram(ctx)
			if error != nil {
				log.Errorf("Error starting relay program: %v\n", error)
				stopChan <- syscall.SIGINT
			}
			return error
		})
	}

	retriesLeft := maxRetries
	// Use security only if custom sshd is running
	for !waitForSSHConnection(useSecureKey) {
		if retriesLeft == 0 {
			log.Errorln("Unable to connect to SSH server - no more retries left")
			stopChan <- syscall.SIGINT
			break
		}
		log.Debugf("%d - Retrying to connect to SSH server\n", retriesLeft)
		time.Sleep(500 * time.Millisecond)
		retriesLeft--
	}

	log.Debugln("Connected to SSH server - Setting up proxies started")
	err := setupProxies(ctx, group, namedPipe, sshConnection, identityPath)
	if err != nil {
		log.Errorf("Unable to setup proxies: %s\n", err.Error())
		stopChan <- syscall.SIGINT
		return
	}

	log.Debugln("Setting up proxies completed - waiting for worker group")
	if err := group.Wait(); err != nil {
		log.Errorf("Error occurred in execution group: %s\n", err.Error())
		stopChan <- syscall.SIGINT
		return
	}
}
