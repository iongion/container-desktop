# Built-in troubleshooting knowledge

## podman-rootless-socket

**Domain:** podman

**Tags:** socket | rootless | connection | DOCKER_HOST

### Title

Rootless Podman API socket not available

### Symptom

Cannot connect to the Podman socket; `unix:///run/user/<uid>/podman/podman.sock` reports no such file.

### Solution

Enable the user API service so the rootless socket exists, then point clients at it through `DOCKER_HOST`.

### Commands

- `systemctl --user enable --now podman.socket`
- `systemctl --user status podman.socket`

## podman-shortname

**Domain:** podman

**Tags:** pull | registry | short-name | image

### Title

Short-name image did not resolve

### Symptom

Image pulling reports short-name resolution failure or an ambiguous image name.

### Solution

Use a fully qualified image reference (`registry/namespace/name:tag`) instead of a bare short name.

### Commands

- `podman pull docker.io/library/alpine:latest`

## docker-daemon-connection

**Domain:** docker

**Tags:** daemon | socket | connection | permission denied

### Title

Cannot connect to the Docker daemon

### Symptom

Cannot connect to the Docker daemon at `unix:///var/run/docker.sock`, or Docker reports that the daemon is not running.

### Solution

Start the Docker service or Docker Desktop and verify it is listening. Check that `DOCKER_HOST` is not pointing elsewhere.

### Commands

- `systemctl --user status docker`
- `docker version`

## docker-socket-permission

**Domain:** docker

**Tags:** permission denied | socket | group | rootless

### Title

Permission denied on the Docker socket

### Symptom

Connecting to the Docker daemon socket at `/var/run/docker.sock` fails with permission denied.

### Solution

Add your user to the `docker` group and sign in again, or use a rootless engine. Do not use `chmod 777` on the socket.

### Commands

- `sudo usermod -aG docker $USER`

## wsl-distro-not-running

**Domain:** wsl

**Tags:** wsl | distribution | restart | stopped

### Title

WSL distribution not running or in a stale state

### Symptom

The WSL distribution is stopped or hangs, or the engine inside WSL is unreachable.

### Solution

List distributions and their state, then restart WSL to clear stuck state before starting the engine again.

### Commands

- `wsl -l -v`
- `wsl --shutdown`

## wsl-docker-integration

**Domain:** wsl

**Tags:** wsl | docker desktop | integration

### Title

Docker not visible inside WSL

### Symptom

The `docker` command works on Windows but not inside the WSL distribution.

### Solution

Enable Docker Desktop WSL integration for the distribution under Settings → Resources → WSL integration, or run a native engine inside WSL.

### Commands

## ssh-publickey-denied

**Domain:** ssh

**Tags:** ssh | publickey | identity | auth

### Title

SSH permission denied (publickey)

### Symptom

Connecting to a remote engine over SSH fails with `Permission denied (publickey)`.

### Solution

Confirm the correct `IdentityFile` is offered and the key is loaded in the agent. Verify the public key is present in the remote `authorized_keys` file.

### Commands

- `ssh-add -l`
- `ssh -v <host>`

## ssh-host-key-changed

**Domain:** ssh

**Tags:** ssh | known_hosts | host key

### Title

SSH host key verification failed

### Symptom

SSH reports `Host key verification failed` or `REMOTE HOST IDENTIFICATION HAS CHANGED`.

### Solution

If the host legitimately changed, remove the stale `known_hosts` entry and reconnect to accept the new key.

### Commands

- `ssh-keygen -R <host>`
