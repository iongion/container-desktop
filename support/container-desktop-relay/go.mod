module container-desktop-ssh-relay

go 1.25.0

toolchain go1.26.4

require (
	github.com/Microsoft/go-winio v0.6.2
	github.com/containers/gvisor-tap-vsock v0.8.9
	github.com/containers/winquit v1.1.0
	github.com/pkg/errors v0.9.1
	github.com/sirupsen/logrus v1.9.4
	golang.org/x/crypto v0.53.0
	golang.org/x/sync v0.21.0
)

require golang.org/x/sys v0.46.0 // indirect
