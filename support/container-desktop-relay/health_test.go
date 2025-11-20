package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestNewHealthChecker(t *testing.T) {
	checker := NewHealthChecker()
	if checker == nil {
		t.Fatal("Expected non-nil health checker")
	}

	if time.Since(checker.startTime) > time.Second {
		t.Error("Start time should be recent")
	}
}

func TestHealthCheckerCounters(t *testing.T) {
	checker := NewHealthChecker()

	// Test increment
	checker.IncrementConnections()
	checker.IncrementConnections()

	status := checker.GetStatus()
	if status.ActiveConnections != 2 {
		t.Errorf("Expected 2 active connections, got %d", status.ActiveConnections)
	}
	if status.TotalConnections != 2 {
		t.Errorf("Expected 2 total connections, got %d", status.TotalConnections)
	}

	// Test decrement
	checker.DecrementConnections()

	status = checker.GetStatus()
	if status.ActiveConnections != 1 {
		t.Errorf("Expected 1 active connection, got %d", status.ActiveConnections)
	}
	if status.TotalConnections != 2 {
		t.Errorf("Expected 2 total connections (unchanged), got %d", status.TotalConnections)
	}
}

func TestHealthCheckerErrors(t *testing.T) {
	checker := NewHealthChecker()

	err := errors.New("test error")
	checker.RecordError(err)

	status := checker.GetStatus()
	if status.ErrorCount != 1 {
		t.Errorf("Expected 1 error, got %d", status.ErrorCount)
	}

	if status.LastError != "test error" {
		t.Errorf("Expected last error 'test error', got '%s'", status.LastError)
	}
}

func TestHealthCheckerHTTPHandler(t *testing.T) {
	checker := NewHealthChecker()
	checker.IncrementConnections()

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()

	checker.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var status HealthStatus
	if err := json.NewDecoder(w.Body).Decode(&status); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if status.Status != "healthy" {
		t.Errorf("Expected healthy status, got %s", status.Status)
	}

	if status.ActiveConnections != 1 {
		t.Errorf("Expected 1 active connection, got %d", status.ActiveConnections)
	}
}

func TestHealthCheckerDegradedStatus(t *testing.T) {
	checker := NewHealthChecker()

	// Simulate many connections
	for i := 0; i < 1001; i++ {
		checker.IncrementConnections()
	}

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()

	checker.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("Expected status 503, got %d", w.Code)
	}

	var status HealthStatus
	if err := json.NewDecoder(w.Body).Decode(&status); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if status.Status != "degraded" {
		t.Errorf("Expected degraded status, got %s", status.Status)
	}
}

func TestHealthCheckerUptime(t *testing.T) {
	checker := NewHealthChecker()

	// Wait a bit
	time.Sleep(100 * time.Millisecond)

	status := checker.GetStatus()
	if status.Uptime == "" {
		t.Error("Expected non-empty uptime")
	}
}

func TestHealthCheckerConcurrency(t *testing.T) {
	checker := NewHealthChecker()

	// Run concurrent operations
	done := make(chan bool)
	for i := 0; i < 10; i++ {
		go func() {
			for j := 0; j < 100; j++ {
				checker.IncrementConnections()
				checker.DecrementConnections()
				checker.RecordError(errors.New("test"))
			}
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	status := checker.GetStatus()
	if status.ErrorCount != 1000 {
		t.Errorf("Expected 1000 errors, got %d", status.ErrorCount)
	}

	// Active connections should be 0 (incremented and decremented same amount)
	if status.ActiveConnections != 0 {
		t.Errorf("Expected 0 active connections, got %d", status.ActiveConnections)
	}
}
