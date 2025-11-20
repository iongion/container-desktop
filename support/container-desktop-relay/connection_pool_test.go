package main

import (
	"context"
	"testing"
	"time"
)

func TestNewConnectionPool(t *testing.T) {
	pool := NewConnectionPool(10)
	if pool == nil {
		t.Fatal("Expected non-nil connection pool")
	}

	if pool.maxConnections != 10 {
		t.Errorf("Expected max connections 10, got %d", pool.maxConnections)
	}

	if pool.ActiveCount() != 0 {
		t.Errorf("Expected 0 active connections, got %d", pool.ActiveCount())
	}
}

func TestConnectionPoolAcquireRelease(t *testing.T) {
	pool := NewConnectionPool(5)
	ctx := context.Background()

	// Acquire connection
	err := pool.Acquire(ctx, "conn1", "/var/run/docker.sock")
	if err != nil {
		t.Fatalf("Failed to acquire connection: %v", err)
	}

	if pool.ActiveCount() != 1 {
		t.Errorf("Expected 1 active connection, got %d", pool.ActiveCount())
	}

	// Release connection
	pool.Release("conn1")

	if pool.ActiveCount() != 0 {
		t.Errorf("Expected 0 active connections after release, got %d", pool.ActiveCount())
	}
}

func TestConnectionPoolMaxLimit(t *testing.T) {
	pool := NewConnectionPool(2)
	ctx := context.Background()

	// Acquire max connections
	err1 := pool.Acquire(ctx, "conn1", "/socket1")
	err2 := pool.Acquire(ctx, "conn2", "/socket2")

	if err1 != nil || err2 != nil {
		t.Fatal("Failed to acquire connections")
	}

	// Try to acquire one more (should fail immediately)
	ctx3, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()

	err3 := pool.Acquire(ctx3, "conn3", "/socket3")
	if err3 == nil {
		t.Error("Expected error when pool is exhausted")
	}

	if pool.ActiveCount() != 2 {
		t.Errorf("Expected 2 active connections, got %d", pool.ActiveCount())
	}
}

func TestConnectionPoolGetConnections(t *testing.T) {
	pool := NewConnectionPool(5)
	ctx := context.Background()

	pool.Acquire(ctx, "conn1", "/socket1")
	pool.Acquire(ctx, "conn2", "/socket2")

	conns := pool.GetConnections()
	if len(conns) != 2 {
		t.Errorf("Expected 2 connections, got %d", len(conns))
	}

	// Verify connection info
	foundConn1 := false
	foundConn2 := false
	for _, conn := range conns {
		if conn.ID == "conn1" && conn.SocketPath == "/socket1" {
			foundConn1 = true
		}
		if conn.ID == "conn2" && conn.SocketPath == "/socket2" {
			foundConn2 = true
		}
	}

	if !foundConn1 || !foundConn2 {
		t.Error("Expected to find both connections in pool")
	}
}

func TestConnectionPoolConcurrency(t *testing.T) {
	pool := NewConnectionPool(10)
	ctx := context.Background()

	done := make(chan bool)
	errors := make(chan error, 20)

	// Launch 20 goroutines trying to acquire connections
	for i := 0; i < 20; i++ {
		go func(id int) {
			defer func() { done <- true }()

			connID := string(rune('A' + id))
			err := pool.Acquire(ctx, connID, "/socket")
			if err != nil {
				errors <- err
				return
			}

			// Hold for a bit
			time.Sleep(50 * time.Millisecond)

			pool.Release(connID)
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 20; i++ {
		<-done
	}

	close(errors)

	// Count errors (should have some due to pool limit)
	errorCount := 0
	for range errors {
		errorCount++
	}

	if errorCount == 0 {
		t.Error("Expected some goroutines to fail acquiring connection")
	}

	// Pool should be empty at the end
	if pool.ActiveCount() != 0 {
		t.Errorf("Expected 0 active connections at end, got %d", pool.ActiveCount())
	}
}

func TestConnectionPoolContextCancellation(t *testing.T) {
	pool := NewConnectionPool(1)

	// Acquire the only slot
	ctx1 := context.Background()
	err := pool.Acquire(ctx1, "conn1", "/socket1")
	if err != nil {
		t.Fatalf("Failed to acquire first connection: %v", err)
	}

	// Try to acquire with cancelled context
	ctx2, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	err = pool.Acquire(ctx2, "conn2", "/socket2")
	if err != context.Canceled {
		t.Errorf("Expected context.Canceled error, got: %v", err)
	}
}

func TestConnectionPoolReleaseNonExistent(t *testing.T) {
	pool := NewConnectionPool(5)

	// Release non-existent connection (should not panic)
	pool.Release("nonexistent")

	// Should still work normally
	ctx := context.Background()
	err := pool.Acquire(ctx, "conn1", "/socket1")
	if err != nil {
		t.Errorf("Pool should still work after releasing non-existent connection: %v", err)
	}
}
