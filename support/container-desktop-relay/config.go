package main

import (
	"encoding/json"
	"os"
	"time"

	"github.com/pkg/errors"
	log "github.com/sirupsen/logrus"
)

// Config represents the relay configuration
type Config struct {
	// Common settings
	Host              string        `json:"host"`
	Port              int           `json:"port"`
	BufferSize        int           `json:"buffer_size"`
	IdentityPath      string        `json:"identity_path"`
	KnownHostsPath    string        `json:"known_hosts_path"`
	AuthorizedKeysPath string       `json:"authorized_keys_path"`

	// Connection settings
	MaxConnections     int           `json:"max_connections"`
	MaxRetries         int           `json:"max_retries"`
	ConnectTimeout     time.Duration `json:"connect_timeout"`
	ReadTimeout        time.Duration `json:"read_timeout"`
	WriteTimeout       time.Duration `json:"write_timeout"`

	// Process management
	WatchProcessTermination bool `json:"watch_process_termination"`
	ParentProcessPid        int  `json:"parent_process_pid"`
	PollInterval            int  `json:"poll_interval"`

	// Health check
	HealthCheckEnabled bool   `json:"health_check_enabled"`
	HealthCheckPort    int    `json:"health_check_port"`

	// Metrics
	MetricsEnabled bool   `json:"metrics_enabled"`
	MetricsPort    int    `json:"metrics_port"`

	// Security
	SecureHostKey bool `json:"secure_host_key"`
}

// DefaultConfig returns default configuration
func DefaultConfig() *Config {
	return &Config{
		Host:                    "127.0.0.1",
		Port:                    20022,
		BufferSize:              8192, // Increased from 4096
		MaxConnections:          100,
		MaxRetries:              5,
		ConnectTimeout:          5 * time.Second,
		ReadTimeout:             30 * time.Second,
		WriteTimeout:            30 * time.Second,
		PollInterval:            2,
		HealthCheckEnabled:      true,
		HealthCheckPort:         20080,
		MetricsEnabled:          true,
		MetricsPort:             20090,
		SecureHostKey:           true,
		WatchProcessTermination: false,
		ParentProcessPid:        -1,
	}
}

// LoadConfig loads configuration from a JSON file
func LoadConfig(path string) (*Config, error) {
	config := DefaultConfig()

	if path == "" {
		return config, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			log.Warnf("Config file not found: %s, using defaults", path)
			return config, nil
		}
		return nil, errors.Wrapf(err, "failed to read config file: %s", path)
	}

	if err := json.Unmarshal(data, config); err != nil {
		return nil, errors.Wrapf(err, "failed to parse config file: %s", path)
	}

	return config, nil
}

// SaveConfig saves configuration to a JSON file
func SaveConfig(config *Config, path string) error {
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return errors.Wrap(err, "failed to marshal config")
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		return errors.Wrapf(err, "failed to write config file: %s", path)
	}

	return nil
}

// Validate validates the configuration
func (c *Config) Validate() error {
	if c.Port < 1 || c.Port > 65535 {
		return errors.Errorf("invalid port: %d", c.Port)
	}

	if c.BufferSize < 1024 {
		return errors.Errorf("buffer size too small: %d", c.BufferSize)
	}

	if c.MaxConnections < 1 {
		return errors.Errorf("max connections must be positive: %d", c.MaxConnections)
	}

	if c.HealthCheckEnabled && (c.HealthCheckPort < 1 || c.HealthCheckPort > 65535) {
		return errors.Errorf("invalid health check port: %d", c.HealthCheckPort)
	}

	if c.MetricsEnabled && (c.MetricsPort < 1 || c.MetricsPort > 65535) {
		return errors.Errorf("invalid metrics port: %d", c.MetricsPort)
	}

	return nil
}
