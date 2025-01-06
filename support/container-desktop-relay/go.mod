module container-desktop-ssh-relay

go 1.23.2

require (
	github.com/Microsoft/go-winio v0.6.2
	github.com/containers/gvisor-tap-vsock v0.7.5
	github.com/containers/winquit v1.1.0
	github.com/pkg/errors v0.9.1
	github.com/sirupsen/logrus v1.9.3
	golang.org/x/crypto v0.31.0
	golang.org/x/sync v0.8.0
)

require golang.org/x/sys v0.28.0 // indirect
