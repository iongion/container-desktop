.PHONY: all build build-linux build-windows test clean install fmt vet lint

# Variables
BINARY_NAME=container-desktop-relay
BINARY_LINUX=$(BINARY_NAME)-linux
BINARY_WINDOWS=$(BINARY_NAME).exe
VERSION?=dev
BUILD_TIME=$(shell date -u '+%Y-%m-%d_%H:%M:%S')
GIT_COMMIT=$(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Build flags
LDFLAGS=-ldflags "-X main.Version=$(VERSION) -X main.BuildTime=$(BUILD_TIME) -X main.GitCommit=$(GIT_COMMIT)"
GOFLAGS=-trimpath

all: test build

build: build-linux build-windows

build-linux:
	@echo "Building for Linux..."
	GOOS=linux GOARCH=amd64 go build $(GOFLAGS) $(LDFLAGS) -o $(BINARY_LINUX)
	@echo "Built: $(BINARY_LINUX)"

build-windows:
	@echo "Building for Windows..."
	GOOS=windows GOARCH=amd64 go build $(GOFLAGS) $(LDFLAGS) -o $(BINARY_WINDOWS)
	@echo "Built: $(BINARY_WINDOWS)"

test:
	@echo "Running tests..."
	go test -v -race -cover ./...

test-coverage:
	@echo "Running tests with coverage report..."
	go test -v -race -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report generated: coverage.html"

bench:
	@echo "Running benchmarks..."
	go test -bench=. -benchmem ./...

fmt:
	@echo "Formatting code..."
	go fmt ./...
	gofmt -s -w .

vet:
	@echo "Running go vet..."
	go vet ./...

lint:
	@echo "Running linters..."
	golangci-lint run || echo "golangci-lint not installed, skipping"

clean:
	@echo "Cleaning..."
	rm -f $(BINARY_LINUX) $(BINARY_WINDOWS)
	rm -f coverage.out coverage.html
	@echo "Cleaned"

install: build
	@echo "Installing..."
	cp $(BINARY_LINUX) $(GOPATH)/bin/$(BINARY_LINUX) 2>/dev/null || echo "Could not install Linux binary"
	@echo "Installed"

deps:
	@echo "Downloading dependencies..."
	go mod download
	go mod tidy

update-deps:
	@echo "Updating dependencies..."
	go get -u ./...
	go mod tidy

# Generate example config
config-example:
	@echo "Generating example config..."
	@echo '{' > config.example.json
	@echo '  "host": "127.0.0.1",' >> config.example.json
	@echo '  "port": 20022,' >> config.example.json
	@echo '  "buffer_size": 8192,' >> config.example.json
	@echo '  "max_connections": 100,' >> config.example.json
	@echo '  "connect_timeout": "5s",' >> config.example.json
	@echo '  "read_timeout": "30s",' >> config.example.json
	@echo '  "write_timeout": "30s",' >> config.example.json
	@echo '  "health_check_enabled": true,' >> config.example.json
	@echo '  "health_check_port": 20080,' >> config.example.json
	@echo '  "metrics_enabled": true,' >> config.example.json
	@echo '  "metrics_port": 20090,' >> config.example.json
	@echo '  "secure_host_key": true' >> config.example.json
	@echo '}' >> config.example.json
	@echo "Generated: config.example.json"

# Development helpers
run-linux:
	go run -tags linux . --generate-key-pair

run-windows:
	GOOS=windows go run -tags windows .

# Docker support
docker-build:
	docker build -t $(BINARY_NAME):$(VERSION) .

help:
	@echo "Available targets:"
	@echo "  all              - Run tests and build binaries"
	@echo "  build            - Build binaries for all platforms"
	@echo "  build-linux      - Build Linux binary"
	@echo "  build-windows    - Build Windows binary"
	@echo "  test             - Run tests"
	@echo "  test-coverage    - Run tests with coverage report"
	@echo "  bench            - Run benchmarks"
	@echo "  fmt              - Format code"
	@echo "  vet              - Run go vet"
	@echo "  lint             - Run linters"
	@echo "  clean            - Remove build artifacts"
	@echo "  install          - Install binaries to GOPATH/bin"
	@echo "  deps             - Download dependencies"
	@echo "  update-deps      - Update dependencies"
	@echo "  config-example   - Generate example config file"
	@echo "  run-linux        - Run Linux version (for dev)"
	@echo "  run-windows      - Run Windows version (for dev)"
	@echo "  docker-build     - Build Docker image"
	@echo "  help             - Show this help"
