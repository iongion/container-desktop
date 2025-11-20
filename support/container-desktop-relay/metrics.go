package main

import (
	"encoding/json"
	"net/http"
	"sync/atomic"
	"time"

	log "github.com/sirupsen/logrus"
)

// Metrics represents relay metrics
type Metrics struct {
	TotalConnections    int64         `json:"total_connections"`
	ActiveConnections   int64         `json:"active_connections"`
	TotalBytesRead      int64         `json:"total_bytes_read"`
	TotalBytesWritten   int64         `json:"total_bytes_written"`
	TotalErrors         int64         `json:"total_errors"`
	ConnectionErrors    int64         `json:"connection_errors"`
	SocketErrors        int64         `json:"socket_errors"`
	AverageConnDuration time.Duration `json:"average_connection_duration"`
	Uptime              time.Duration `json:"uptime"`
}

// MetricsCollector collects and exposes metrics
type MetricsCollector struct {
	startTime           time.Time
	totalConnections    int64
	activeConnections   int64
	totalBytesRead      int64
	totalBytesWritten   int64
	totalErrors         int64
	connectionErrors    int64
	socketErrors        int64
	totalConnDuration   int64 // nanoseconds
}

// NewMetricsCollector creates a new metrics collector
func NewMetricsCollector() *MetricsCollector {
	return &MetricsCollector{
		startTime: time.Now(),
	}
}

// RecordConnection records a new connection
func (m *MetricsCollector) RecordConnection() {
	atomic.AddInt64(&m.totalConnections, 1)
	atomic.AddInt64(&m.activeConnections, 1)
}

// RecordDisconnection records a connection closure
func (m *MetricsCollector) RecordDisconnection(duration time.Duration) {
	atomic.AddInt64(&m.activeConnections, -1)
	atomic.AddInt64(&m.totalConnDuration, int64(duration))
}

// RecordBytesRead records bytes read
func (m *MetricsCollector) RecordBytesRead(bytes int64) {
	atomic.AddInt64(&m.totalBytesRead, bytes)
}

// RecordBytesWritten records bytes written
func (m *MetricsCollector) RecordBytesWritten(bytes int64) {
	atomic.AddInt64(&m.totalBytesWritten, bytes)
}

// RecordError records an error
func (m *MetricsCollector) RecordError() {
	atomic.AddInt64(&m.totalErrors, 1)
}

// RecordConnectionError records a connection error
func (m *MetricsCollector) RecordConnectionError() {
	atomic.AddInt64(&m.connectionErrors, 1)
	m.RecordError()
}

// RecordSocketError records a socket error
func (m *MetricsCollector) RecordSocketError() {
	atomic.AddInt64(&m.socketErrors, 1)
	m.RecordError()
}

// GetMetrics returns current metrics
func (m *MetricsCollector) GetMetrics() Metrics {
	totalConns := atomic.LoadInt64(&m.totalConnections)
	totalDuration := atomic.LoadInt64(&m.totalConnDuration)

	avgDuration := time.Duration(0)
	if totalConns > 0 {
		avgDuration = time.Duration(totalDuration / totalConns)
	}

	return Metrics{
		TotalConnections:    totalConns,
		ActiveConnections:   atomic.LoadInt64(&m.activeConnections),
		TotalBytesRead:      atomic.LoadInt64(&m.totalBytesRead),
		TotalBytesWritten:   atomic.LoadInt64(&m.totalBytesWritten),
		TotalErrors:         atomic.LoadInt64(&m.totalErrors),
		ConnectionErrors:    atomic.LoadInt64(&m.connectionErrors),
		SocketErrors:        atomic.LoadInt64(&m.socketErrors),
		AverageConnDuration: avgDuration,
		Uptime:              time.Since(m.startTime),
	}
}

// ServeHTTP implements http.Handler for metrics
func (m *MetricsCollector) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	metrics := m.GetMetrics()
	w.Header().Set("Content-Type", "application/json")

	if err := json.NewEncoder(w).Encode(metrics); err != nil {
		log.Errorf("Failed to encode metrics: %v", err)
	}
}

// StartMetricsServer starts the metrics HTTP server
func StartMetricsServer(port int, collector *MetricsCollector) error {
	mux := http.NewServeMux()
	mux.Handle("/metrics", collector)

	server := &http.Server{
		Addr:         ":" + string(rune(port)),
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	log.Infof("Starting metrics server on port %d", port)
	return server.ListenAndServe()
}
