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
	"io"
	"log"
	"net"
	"sync"
	"time"
)

type AbstractDuplexRelay struct {
	healthCheckInterval time.Duration
	sourceName          string
	destinationName     string
	destinationAddr     string
	bufferSize          int
	dialSourceConn      func(context.Context) (net.Conn, error)
	listenTargetConn    func(context.Context) (net.Listener, error)
}

func (r *AbstractDuplexRelay) Relay(ctx context.Context) error {
	listener, err := r.listenTargetConn(ctx)
	if err != nil {
		return err
	}
	defer listener.Close()

	ctx, cancel := context.WithCancel(ctx)
	go r.healthCheckSource(ctx, cancel)
	go func() {
		<-ctx.Done()
		listener.Close()
	}()

	for {
		conn, err := listener.Accept()
		if err != nil {
			// NOTE: Don't print false-positive errors
			if ctx.Err() != nil {
				return nil
			}

			continue
		}

		// log.Printf("Established connection to %s\n", conn.RemoteAddr())
		go r.handleConnection(ctx, conn)
	}
}

func (r *AbstractDuplexRelay) healthCheckSource(ctx context.Context, cancel context.CancelFunc) {
	defer cancel()

	ticker := time.NewTicker(r.healthCheckInterval)
	defer ticker.Stop()

	// NOTE: Dial source to make sure it's alive
	conn, err := r.dialSourceConn(ctx)
	if err != nil {
		log.Printf(
			"Could not dial %s for health check. Error: %s\n",
			r.sourceName,
			err,
		)
		return
	}
	conn.Close()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// NOTE: Dial source to make sure it's alive
			conn, err := r.dialSourceConn(ctx)
			if err != nil {
				log.Printf(
					"Could not dial %s for health check. Error: %s\n",
					r.sourceName,
					err,
				)
				conn.Close()
				return
			}
			conn.Close()
		}
	}
}

// nolint:funlen
func (r *AbstractDuplexRelay) handleConnection(ctx context.Context, conn net.Conn) {
	defer func(conn net.Conn) {
		_ = conn.Close()
		// log.Printf("Closed connection to %s %s\n", r.destinationName, conn.RemoteAddr())
	}(conn)

	// NOTE: Accepted connection at `dst` address
	// must be using read/write deadlines to make sure
	// we're not leaking goroutines by waiting on half-closed connections.
	destDeadlineConn := NewDeadlineConnection(conn, writeDeadlineTimeout, readDeadlineTimeout)
	// log.Printf("Handling connection from %s %s\n", r.destinationName, destDeadlineConn.remoteAddress)

	sourceConn, err := r.dialSourceConn(ctx)
	if err != nil {
		log.Printf(
			"Could not read from source %s. Error: %s",
			r.sourceName,
			err,
		)
		return
	}

	defer sourceConn.Close()
	defer destDeadlineConn.Close()

	var wg sync.WaitGroup

	wg.Add(1)
	// NOTE: Read from source and write to destination
	go func() {
		defer wg.Done()

		buffer := make([]byte, r.bufferSize)

		for {
			readBytes, err := sourceConn.Read(buffer)
			if err != nil {
				sourceConn.Close()
				// NOTE: Force close destination connection to stop
				// the "destination read to source write" goroutine.
				destDeadlineConn.Close()

				if err == io.EOF {
					// log.Printf(
					// 	"Reached EOF of %s %s. Stopping reading",
					// 	r.sourceName,
					// 	sourceConn.RemoteAddr(),
					// )
					return
				}
				/*
					log.Printf(
						"Could not read from %s %s. Error: %s\n",
						r.sourceName,
						sourceConn.RemoteAddr(),
						err,
					)
				*/
				return
			}

			if readBytes < 1 {
				continue
			}

			// NOTE: Pad to the read bytes to remove 0s
			_, _ = destDeadlineConn.Write(buffer[:readBytes])
		}
	}()

	// NOTE: Read from destination and write to source
	buffer := make([]byte, r.bufferSize)
	for {
		readBytes, err := destDeadlineConn.Read(buffer)
		if err != nil {
			destDeadlineConn.Close()
			// NOTE: Force close source connection to stop
			// the "source read to dest write" goroutine.
			sourceConn.Close()

			if err == io.EOF {
				// log.Printf(
				// 	"Reached EOF of %s %s. Stopping reading",
				// 	r.destinationName,
				// 	destDeadlineConn.remoteAddress,
				// )
				break
			}

			log.Printf(
				"Could not read from %s %s. Error: %s",
				r.destinationName,
				destDeadlineConn.remoteAddress,
				err,
			)
			break
		}

		if readBytes < 1 {
			continue
		}

		// NOTE: Pad to the read bytes to remove 0s
		_, err = sourceConn.Write(buffer[:readBytes])
		if err != nil {
			log.Printf(
				"Could not write to %s %s. Error: %s",
				r.sourceName,
				sourceConn.RemoteAddr(),
				err,
			)
			return
		}
	}

	wg.Wait()
}
