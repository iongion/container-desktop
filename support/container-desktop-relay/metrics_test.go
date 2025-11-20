package main

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"
)

func TestNewMetricsCollector(t *testing.T) {
	collector := NewMetricsCollector()
	if collector == nil {
		t.Fatal("Expected non-nil metrics collector")
	}

	if time.Since(collector.startTime) > time.Second {
		t.Error("Start time should be recent")
	}
}

func TestMetricsCollectorConnections(t *testing.T) {
	collector := NewMetricsCollector()

	collector.RecordConnection()
	collector.RecordConnection()

	metrics := collector.GetMetrics()
	if metrics.TotalConnections != 2 {
		t.Errorf("Expected 2 total connections, got %d", metrics.TotalConnections)
	}
	if metrics.ActiveConnections != 2 {
		t.Errorf("Expected 2 active connections, got %d", metrics.ActiveConnections)
	}

	collector.RecordDisconnection(5 * time.Second)

	metrics = collector.GetMetrics()
	if metrics.ActiveConnections != 1 {
		t.Errorf("Expected 1 active connection, got %d", metrics.ActiveConnections)
	}
	if metrics.TotalConnections != 2 {
		t.Errorf("Expected 2 total connections (unchanged), got %d", metrics.TotalConnections)
	}
}

func TestMetricsCollectorBytes(t *testing.T) {
	collector := NewMetricsCollector()

	collector.RecordBytesRead(1024)
	collector.RecordBytesRead(2048)
	collector.RecordBytesWritten(512)

	metrics := collector.GetMetrics()
	if metrics.TotalBytesRead != 3072 {
		t.Errorf("Expected 3072 bytes read, got %d", metrics.TotalBytesRead)
	}
	if metrics.TotalBytesWritten != 512 {
		t.Errorf("Expected 512 bytes written, got %d", metrics.TotalBytesWritten)
	}
}

func TestMetricsCollectorErrors(t *testing.T) {
	collector := NewMetricsCollector()

	collector.RecordError()
	collector.RecordConnectionError()
	collector.RecordSocketError()

	metrics := collector.GetMetrics()
	if metrics.TotalErrors != 3 {
		t.Errorf("Expected 3 total errors, got %d", metrics.TotalErrors)
	}
	if metrics.ConnectionErrors != 1 {
		t.Errorf("Expected 1 connection error, got %d", metrics.ConnectionErrors)
	}
	if metrics.SocketErrors != 1 {
		t.Errorf("Expected 1 socket error, got %d", metrics.SocketErrors)
	}
}

func TestMetricsCollectorAverageDuration(t *testing.T) {
	collector := NewMetricsCollector()

	collector.RecordConnection()
	collector.RecordDisconnection(10 * time.Second)

	collector.RecordConnection()
	collector.RecordDisconnection(20 * time.Second)

	metrics := collector.GetMetrics()
	expectedAvg := 15 * time.Second
	if metrics.AverageConnDuration != expectedAvg {
		t.Errorf("Expected average duration %v, got %v", expectedAvg, metrics.AverageConnDuration)
	}
}

func TestMetricsCollectorHTTPHandler(t *testing.T) {
	collector := NewMetricsCollector()
	collector.RecordConnection()
	collector.RecordBytesRead(1024)

	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()

	collector.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var metrics Metrics
	if err := json.NewDecoder(w.Body).Decode(&metrics); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if metrics.TotalConnections != 1 {
		t.Errorf("Expected 1 total connection, got %d", metrics.TotalConnections)
	}
	if metrics.TotalBytesRead != 1024 {
		t.Errorf("Expected 1024 bytes read, got %d", metrics.TotalBytesRead)
	}
}

func TestMetricsCollectorConcurrency(t *testing.T) {
	collector := NewMetricsCollector()

	done := make(chan bool)
	for i := 0; i < 10; i++ {
		go func() {
			for j := 0; j < 100; j++ {
				collector.RecordConnection()
				collector.RecordBytesRead(100)
				collector.RecordBytesWritten(50)
				collector.RecordDisconnection(time.Millisecond)
			}
			done <- true
		}()
	}

	for i := 0; i < 10; i++ {
		<-done
	}

	metrics := collector.GetMetrics()
	if metrics.TotalConnections != 1000 {
		t.Errorf("Expected 1000 total connections, got %d", metrics.TotalConnections)
	}
	if metrics.TotalBytesRead != 100000 {
		t.Errorf("Expected 100000 bytes read, got %d", metrics.TotalBytesRead)
	}
	if metrics.TotalBytesWritten != 50000 {
		t.Errorf("Expected 50000 bytes written, got %d", metrics.TotalBytesWritten)
	}
}

func TestMetricsCollectorUptime(t *testing.T) {
	collector := NewMetricsCollector()

	time.Sleep(100 * time.Millisecond)

	metrics := collector.GetMetrics()
	if metrics.Uptime < 100*time.Millisecond {
		t.Errorf("Expected uptime >= 100ms, got %v", metrics.Uptime)
	}
}
