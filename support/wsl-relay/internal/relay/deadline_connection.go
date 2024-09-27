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
	"net"
	"time"
)

type DeadlineConnection struct {
	net.Conn
	readDeadlineTimeout  time.Duration
	writeDeadlineTimeout time.Duration
	remoteAddress        net.Addr
}

func NewDeadlineConnection(conn net.Conn, writeDeadlineTimeout, readDeadlineTimeout time.Duration) *DeadlineConnection {
	return &DeadlineConnection{
		Conn:                 conn,
		writeDeadlineTimeout: writeDeadlineTimeout,
		readDeadlineTimeout:  readDeadlineTimeout,
		remoteAddress:        conn.RemoteAddr(),
	}
}

func (d *DeadlineConnection) Read(b []byte) (int, error) {
	err := d.Conn.SetReadDeadline(time.Now().Add(d.readDeadlineTimeout))
	if err != nil {
		return 0, err
	}

	return d.Conn.Read(b)
}

func (d *DeadlineConnection) Write(b []byte) (int, error) {
	err := d.Conn.SetWriteDeadline(time.Now().Add(d.writeDeadlineTimeout))
	if err != nil {
		return 0, err
	}

	return d.Conn.Write(b)
}
