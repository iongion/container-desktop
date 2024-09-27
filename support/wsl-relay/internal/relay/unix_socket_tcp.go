// Copyright 2018 SumUp Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package relay

import (
	"context"
	"log"
	"net"
	"os"
	"strconv"
	"strings"
	"time"
)

type UnixSocketTCP struct {
	AbstractDuplexRelay
}

func NewUnixSocketTCP(
	healthCheckInterval time.Duration,
	unixSocketPath,
	tcpAddress string,
	bufferSize int,
) (*UnixSocketTCP, error) {
	tcpAddressParts := strings.Split(tcpAddress, ":")
	if len(tcpAddressParts) != 2 {
		log.Fatalf(
			"wrong format for tcp address %s. Expected <addr>:<port>",
			tcpAddress,
		)
	}

	_, err := strconv.ParseInt(tcpAddressParts[1], 10, 32)
	if err != nil {
		log.Fatalf(
			"%v could not parse specified port number %s",
			err,
			tcpAddressParts[1],
		)
	}

	_, err = os.Stat(unixSocketPath)
	if os.IsNotExist(err) {
		log.Fatalf("%v could not stat %s", err, unixSocketPath)
	}

	return &UnixSocketTCP{
		AbstractDuplexRelay{
			healthCheckInterval: healthCheckInterval,
			bufferSize:          bufferSize,
			sourceName:          "unix socket",
			destinationName:     "TCP connection",
			destinationAddr:     tcpAddress,
			dialSourceConn: func(ctx context.Context) (net.Conn, error) {
				dialer := &net.Dialer{}
				// NOTE: This is a streaming unix domain socket
				// equivalent of `sock.STREAM`.
				conn, err := dialer.DialContext(ctx, "unix", unixSocketPath)
				if err != nil {
					log.Fatalf(
						"%v failed to dial unix address: %s",
						err,
						unixSocketPath,
					)
				}

				return conn, nil
			},
			listenTargetConn: func(ctx context.Context) (net.Listener, error) {
				var lc net.ListenConfig
				listener, err := lc.Listen(ctx, "tcp", tcpAddress)
				if err != nil {
					log.Fatalf(
						"%v failed to listen at TCP address: %s",
						err,
						tcpAddress,
					)
				}
				return listener, nil
			},
		},
	}, nil
}
