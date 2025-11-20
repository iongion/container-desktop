package main

import (
	"context"
	"sync"
	"sync/atomic"

	"github.com/pkg/errors"
	log "github.com/sirupsen/logrus"
)

// ConnectionPool manages active connections with limits
type ConnectionPool struct {
	maxConnections int64
	activeCount    int64
	mu             sync.RWMutex
	connections    map[string]*ConnectionInfo
	semaphore      chan struct{}
}

// ConnectionInfo holds information about an active connection
type ConnectionInfo struct {
	ID        string
	SocketPath string
	StartTime int64
}

// NewConnectionPool creates a new connection pool
func NewConnectionPool(maxConnections int) *ConnectionPool {
	return &ConnectionPool{
		maxConnections: int64(maxConnections),
		connections:    make(map[string]*ConnectionInfo),
		semaphore:      make(chan struct{}, maxConnections),
	}
}

// Acquire acquires a connection slot
func (p *ConnectionPool) Acquire(ctx context.Context, connID string, socketPath string) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case p.semaphore <- struct{}{}:
		// Acquired
		atomic.AddInt64(&p.activeCount, 1)

		p.mu.Lock()
		p.connections[connID] = &ConnectionInfo{
			ID:         connID,
			SocketPath: socketPath,
			StartTime:  currentTimeNanos(),
		}
		p.mu.Unlock()

		log.Debugf("Connection acquired: %s (active: %d/%d)", connID, p.ActiveCount(), p.maxConnections)
		return nil
	default:
		return errors.Errorf("connection pool exhausted (max: %d)", p.maxConnections)
	}
}

// Release releases a connection slot
func (p *ConnectionPool) Release(connID string) {
	p.mu.Lock()
	_, exists := p.connections[connID]
	if exists {
		delete(p.connections, connID)
	}
	p.mu.Unlock()

	if !exists {
		log.Debugf("Attempted to release non-existent connection: %s", connID)
		return
	}

	<-p.semaphore
	atomic.AddInt64(&p.activeCount, -1)

	log.Debugf("Connection released: %s (active: %d/%d)", connID, p.ActiveCount(), p.maxConnections)
}

// ActiveCount returns the number of active connections
func (p *ConnectionPool) ActiveCount() int64 {
	return atomic.LoadInt64(&p.activeCount)
}

// GetConnections returns a snapshot of active connections
func (p *ConnectionPool) GetConnections() []*ConnectionInfo {
	p.mu.RLock()
	defer p.mu.RUnlock()

	conns := make([]*ConnectionInfo, 0, len(p.connections))
	for _, conn := range p.connections {
		conns = append(conns, conn)
	}
	return conns
}

func currentTimeNanos() int64 {
	return 0 // placeholder - would use time.Now().UnixNano()
}
