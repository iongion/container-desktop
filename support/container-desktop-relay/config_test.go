package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDefaultConfig(t *testing.T) {
	config := DefaultConfig()

	if config.Host != "127.0.0.1" {
		t.Errorf("Expected default host 127.0.0.1, got %s", config.Host)
	}

	if config.Port != 20022 {
		t.Errorf("Expected default port 20022, got %d", config.Port)
	}

	if config.BufferSize != 8192 {
		t.Errorf("Expected buffer size 8192, got %d", config.BufferSize)
	}

	if config.MaxConnections != 100 {
		t.Errorf("Expected max connections 100, got %d", config.MaxConnections)
	}

	if config.ConnectTimeout != 5*time.Second {
		t.Errorf("Expected connect timeout 5s, got %v", config.ConnectTimeout)
	}
}

func TestConfigValidation(t *testing.T) {
	tests := []struct {
		name      string
		config    *Config
		expectErr bool
	}{
		{
			name:      "valid config",
			config:    DefaultConfig(),
			expectErr: false,
		},
		{
			name: "invalid port - too low",
			config: &Config{
				Port:           0,
				BufferSize:     8192,
				MaxConnections: 100,
			},
			expectErr: true,
		},
		{
			name: "invalid port - too high",
			config: &Config{
				Port:           70000,
				BufferSize:     8192,
				MaxConnections: 100,
			},
			expectErr: true,
		},
		{
			name: "buffer size too small",
			config: &Config{
				Port:           20022,
				BufferSize:     512,
				MaxConnections: 100,
			},
			expectErr: true,
		},
		{
			name: "max connections invalid",
			config: &Config{
				Port:           20022,
				BufferSize:     8192,
				MaxConnections: 0,
			},
			expectErr: true,
		},
		{
			name: "invalid health check port",
			config: &Config{
				Port:               20022,
				BufferSize:         8192,
				MaxConnections:     100,
				HealthCheckEnabled: true,
				HealthCheckPort:    0,
			},
			expectErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.config.Validate()
			if tt.expectErr && err == nil {
				t.Error("Expected validation error but got nil")
			}
			if !tt.expectErr && err != nil {
				t.Errorf("Expected no validation error but got: %v", err)
			}
		})
	}
}

func TestSaveAndLoadConfig(t *testing.T) {
	// Create temporary directory
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.json")

	// Create and save config
	originalConfig := DefaultConfig()
	originalConfig.Port = 12345
	originalConfig.BufferSize = 16384

	err := SaveConfig(originalConfig, configPath)
	if err != nil {
		t.Fatalf("Failed to save config: %v", err)
	}

	// Load config
	loadedConfig, err := LoadConfig(configPath)
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	// Verify values
	if loadedConfig.Port != 12345 {
		t.Errorf("Expected port 12345, got %d", loadedConfig.Port)
	}

	if loadedConfig.BufferSize != 16384 {
		t.Errorf("Expected buffer size 16384, got %d", loadedConfig.BufferSize)
	}
}

func TestLoadConfigNonExistent(t *testing.T) {
	config, err := LoadConfig("/nonexistent/config.json")
	if err != nil {
		t.Errorf("Expected no error for missing config, got: %v", err)
	}

	// Should return default config
	if config.Port != 20022 {
		t.Errorf("Expected default port, got %d", config.Port)
	}
}

func TestLoadConfigEmptyPath(t *testing.T) {
	config, err := LoadConfig("")
	if err != nil {
		t.Errorf("Expected no error for empty path, got: %v", err)
	}

	// Should return default config
	if config == nil {
		t.Error("Expected default config, got nil")
	}
}

func TestLoadConfigInvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "invalid.json")

	// Write invalid JSON
	err := os.WriteFile(configPath, []byte("{invalid json"), 0644)
	if err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	_, err = LoadConfig(configPath)
	if err == nil {
		t.Error("Expected error for invalid JSON, got nil")
	}
}
