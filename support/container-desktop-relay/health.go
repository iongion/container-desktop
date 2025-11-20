package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	log "github.com/sirupsen/logrus"
)

// HealthStatus represents the health status of the relay
type HealthStatus struct {
	Status            string    `json:"status"`
	Uptime            string    `json:"uptime"`
	ActiveConnections int64     `json:"active_connections"`
	TotalConnections  int64     `json:"total_connections"`
	ErrorCount        int64     `json:"error_count"`
	LastError         string    `json:"last_error,omitempty"`
	Timestamp         time.Time `json:"timestamp"`
}

// HealthChecker manages health checking
type HealthChecker struct {
	startTime         time.Time
	activeConnections int64
	totalConnections  int64
	errorCount        int64
	lastError         string
	mutex             sync.RWMutex
}

// NewHealthChecker creates a new health checker
func NewHealthChecker() *HealthChecker {
	return &HealthChecker{
		startTime: time.Now(),
	}
}

// IncrementConnections increments the connection counters
func (h *HealthChecker) IncrementConnections() {
	atomic.AddInt64(&h.activeConnections, 1)
	atomic.AddInt64(&h.totalConnections, 1)
}

// DecrementConnections decrements the active connection counter
func (h *HealthChecker) DecrementConnections() {
	atomic.AddInt64(&h.activeConnections, -1)
}

// RecordError records an error
func (h *HealthChecker) RecordError(err error) {
	atomic.AddInt64(&h.errorCount, 1)
	if err != nil {
		h.mutex.Lock()
		h.lastError = err.Error()
		h.mutex.Unlock()
	}
}

// GetStatus returns the current health status
func (h *HealthChecker) GetStatus() HealthStatus {
	h.mutex.RLock()
	lastError := h.lastError
	h.mutex.RUnlock()

	return HealthStatus{
		Status:            "healthy",
		Uptime:            time.Since(h.startTime).String(),
		ActiveConnections: atomic.LoadInt64(&h.activeConnections),
		TotalConnections:  atomic.LoadInt64(&h.totalConnections),
		ErrorCount:        atomic.LoadInt64(&h.errorCount),
		LastError:         lastError,
		Timestamp:         time.Now(),
	}
}

// ServeHTTP implements http.Handler for health checks
func (h *HealthChecker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	status := h.GetStatus()
	w.Header().Set("Content-Type", "application/json")

	statusCode := http.StatusOK
	if status.ActiveConnections > 1000 {
		status.Status = "degraded"
		statusCode = http.StatusServiceUnavailable
	}

	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(status); err != nil {
		log.Errorf("Failed to encode health status: %v", err)
	}
}

// StartHealthCheckServer starts the health check HTTP server
func StartHealthCheckServer(port int, checker *HealthChecker) error {
	mux := http.NewServeMux()
	mux.Handle("/health", checker)
	mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ready"))
	})

	server := &http.Server{
		Addr:         ":" + strconv.Itoa(port),
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	log.Infof("Starting health check server on port %d", port)
	return server.ListenAndServe()
}
