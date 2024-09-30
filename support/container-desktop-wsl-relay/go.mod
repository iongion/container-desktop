module container-desktop-wsl-relay

go 1.23.0

replace (
	github.com/gogo/protobuf => github.com/gogo/protobuf v1.3.2
	golang.org/x/crypto => golang.org/x/crypto v0.0.0-20201216223049-8b5274cf687f
	golang.org/x/text => golang.org/x/text v0.3.3
)

require github.com/Microsoft/go-winio v0.6.2

require (
	github.com/keybase/go-ps v0.0.0-20190827175125-91aafc93ba19 // indirect
	golang.org/x/sys v0.10.0 // indirect
)
