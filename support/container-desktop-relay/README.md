# Container Desktop Relay

A unified SSH-based relay utility for bridging container socket communication across different environments, specifically targeting Windows WSL scenarios.

## Overview

Container Desktop Relay creates a bidirectional tunnel between Windows named pipes and WSL Unix sockets using SSH as the transport layer. This enables Windows applications to communicate with container engines running inside WSL distributions.

## Architecture

The relay consists of two components:

### 1. SSH Server (Linux)

Runs inside WSL as an SSH daemon that:

- Listens on TCP port (default: 20022)
- Accepts SSH connections with RSA key authentication
- Handles `direct-streamlocal@openssh.com` channel type for Unix socket forwarding
- Bidirectionally forwards data between SSH channel and Unix socket
- Monitors parent process termination (WSL-specific workaround)

### 2. SSH Client + Named Pipe Relay (Windows)

Runs on Windows to bridge named pipes to WSL:

- Creates/validates Windows named pipe
- Optionally spawns the SSH server inside WSL distribution
- Connects to SSH server running in WSL
- Forwards named pipe connections to Unix sockets via SSH

## Data Flow

```text
Windows Named Pipe → SSH Client (Windows) → SSH Server (WSL) → Unix Socket
    ↓                                                               ↓
Docker API Client                                          /var/run/docker.sock
```

## Features

### Core Functionality

- ✅ SSH-based secure tunneling
- ✅ Bidirectional I/O forwarding
- ✅ RSA 4096-bit key pair generation
- ✅ Connection pooling with limits
- ✅ Graceful shutdown handling

### Observability

- ✅ Health check endpoint (`/health`)
- ✅ Readiness probe (`/ready`)
- ✅ Metrics endpoint (`/metrics`)
- ✅ Structured JSON logging

### Configuration

- ✅ Command-line flags
- ✅ JSON configuration file support
- ✅ Environment variable support

### Reliability

- ✅ Connection retry with exponential backoff
- ✅ Automatic reconnection on SSH failures
- ✅ Proper resource cleanup
- ✅ Context-aware cancellation

## Installation

### Prerequisites

- Go 1.23.2 or later
- Windows with WSL2 (for Windows relay)
- OpenSSH compatible SSH server

### Building

```bash
# Build for Linux (runs inside WSL)
GOOS=linux GOARCH=amd64 go build -o container-desktop-relay-linux

# Build for Windows
GOOS=windows GOARCH=amd64 go build -o container-desktop-relay.exe
```

## Usage

### Generate SSH Keys

First, generate an SSH key pair:

```bash
# Linux
./container-desktop-relay-linux --generate-key-pair

# Windows
container-desktop-relay.exe --generate-key-pair
```

This creates:

- `~/.ssh/id_rsa` - Private key
- `~/.ssh/id_rsa.pub` - Public key (PEM format)
- `~/.ssh/authorized_keys` - OpenSSH format public key

### Running the SSH Server (Linux/WSL)

```bash
./container-desktop-relay-linux \
  --host 127.0.0.1 \
  --port 20022 \
  --identity-path ~/.ssh/id_rsa \
  --buffer-size 8192 \
  --watch-process-termination \
  --parent-process-pid <windows-pid>
```

### Running the Relay Client (Windows)

```bash
container-desktop-relay.exe \
  --named-pipe "npipe:////./pipe/container-desktop" \
  --ssh-connection "ssh://user@127.0.0.1:20022" \
  --distribution "Ubuntu" \
  --relay-program-path "C:\path\to\relay-linux" \
  --identity-path "C:\Users\user\.ssh\id_rsa" \
  --watch-process-termination
```

### Using Configuration File

Create `config.json`:

```json
{
  "host": "127.0.0.1",
  "port": 20022,
  "buffer_size": 8192,
  "max_connections": 100,
  "connect_timeout": "5s",
  "health_check_enabled": true,
  "health_check_port": 20080,
  "metrics_enabled": true,
  "metrics_port": 20090,
  "secure_host_key": true
}
```

Then run:

```bash
./container-desktop-relay-linux --config config.json
```

## Command-Line Flags

### Common Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--host` | SSH server host | `127.0.0.1` |
| `--port` | SSH server port | `20022` |
| `--buffer-size` | I/O buffer size | `8192` |
| `--identity-path` | Path to SSH private key | `~/.ssh/id_rsa` |
| `--known-hosts-path` | Path to known hosts file | `~/.ssh/known_hosts` |
| `--authorized-keys-path` | Path to authorized keys | `~/.ssh/authorized_keys` |
| `--generate-key-pair` | Generate SSH key pair | `false` |
| `--config` | Path to config file | `` |

### Linux-Specific Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--watch-process-termination` | Monitor parent process | `false` |
| `--parent-process-pid` | Parent Windows PID | `-1` |
| `--poll-interval` | Poll interval in seconds | `2` |
| `--max-request-wait-time` | Max request wait time (seconds) | `5` |

### Windows-Specific Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--named-pipe` | Named pipe path | `npipe:////./pipe/container-desktop` |
| `--ssh-connection` | SSH connection string | `` |
| `--ssh-timeout` | SSH timeout in seconds | `5` |
| `--max-retries` | Max connection retries | `5` |
| `--distribution` | WSL distribution name | `` |
| `--relay-program-path` | Path to Linux relay binary | `` |
| `--tid-path` | Thread ID file path | `` |

## Health Checks

### Health Endpoint

```bash
curl http://localhost:20080/health
```

Response:

```json
{
  "status": "healthy",
  "uptime": "1h23m45s",
  "active_connections": 3,
  "total_connections": 150,
  "error_count": 2,
  "last_error": "",
  "timestamp": "2025-01-16T10:30:00Z"
}
```

Status codes:

- `200 OK` - Service is healthy
- `503 Service Unavailable` - Service is degraded (>1000 active connections)

### Readiness Probe

```bash
curl http://localhost:20080/ready
```

Returns `200 OK` when ready to accept connections.

## Metrics

### Metrics Endpoint

```bash
curl http://localhost:20090/metrics
```

Response:

```json
{
  "total_connections": 150,
  "active_connections": 3,
  "total_bytes_read": 1048576,
  "total_bytes_written": 524288,
  "total_errors": 2,
  "connection_errors": 1,
  "socket_errors": 1,
  "average_connection_duration": "5m30s",
  "uptime": "1h23m45s"
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging level (trace, debug, info, warn, error) | `debug` |

## Security Considerations

### SSH Key Management

- Always use strong RSA keys (4096-bit)
- Protect private keys with appropriate file permissions (0600)
- Rotate keys regularly
- Never commit keys to version control

### Host Key Verification

By default, the relay uses `InsecureIgnoreHostKey` for local WSL connections. For remote connections, set `--secure-host-key=true` to enable proper host key verification.

### Connection Limits

Configure `max_connections` to prevent resource exhaustion:

```json
{
  "max_connections": 100
}
```

## Troubleshooting

### Connection Refused

**Problem**: Cannot connect to SSH server

**Solutions**:

1. Check if SSH server is running: `ps aux | grep relay`
2. Verify port is correct: `netstat -an | grep 20022`
3. Check firewall settings
4. Verify WSL distribution is running: `wsl -l -v`

### Permission Denied

**Problem**: SSH authentication fails

**Solutions**:

1. Verify key permissions: `chmod 600 ~/.ssh/id_rsa`
2. Check authorized_keys: `cat ~/.ssh/authorized_keys`
3. Regenerate keys: `--generate-key-pair`

### High Memory Usage

**Problem**: Relay consuming too much memory

**Solutions**:

1. Reduce `buffer_size`
2. Lower `max_connections`
3. Check for connection leaks in metrics

### Process Won't Terminate (WSL)

**Problem**: Relay process doesn't exit when parent dies

**Solutions**:

1. Enable process watching: `--watch-process-termination`
2. Provide parent PID: `--parent-process-pid <pid>`
3. Use shorter poll interval: `--poll-interval 1`

## Development

### Running Tests

```bash
# Run all tests
go test -v ./...

# Run with coverage
go test -v -cover ./...

# Run specific test
go test -v -run TestConnectionPool
```

### Building with Debug Info

```bash
go build -gcflags="all=-N -l" -o relay-debug
```

### Enabling Trace Logging

```bash
LOG_LEVEL=trace ./container-desktop-relay-linux
```

## Performance

### Benchmarks

Typical performance characteristics:

- **Throughput**: ~500 MB/s (depends on buffer size)
- **Latency**: <1ms (local connections)
- **Connections**: 100+ concurrent connections
- **Memory**: ~50MB base + ~1MB per connection

### Tuning

For high-throughput scenarios:

```json
{
  "buffer_size": 16384,
  "max_connections": 200,
  "read_timeout": "60s",
  "write_timeout": "60s"
}
```

## Known Issues

1. **Windows SSH Tunneling**: SSH socket forwarding on Windows requires additional tooling (npiperelay)
2. **WSL Process Monitoring**: Workaround for Go issue #69845 required
3. **Named Pipe HTTP Client**: Full Windows named pipe support requires custom HTTP client implementation

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass: `go test -v ./...`
5. Submit a pull request

## License

See LICENSE file for details.

## Support

For issues and questions:

- GitHub Issues: <https://github.com/your-org/container-desktop-relay>
- Documentation: See inline code comments

## Changelog

### v1.0.0 (Planned)

- Initial release
- SSH-based relay
- Health checks and metrics
- Configuration file support
- Comprehensive tests
- Connection pooling
