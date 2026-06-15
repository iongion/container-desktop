# Container Desktop Relay

A tiny Go helper that lets Container Desktop reach a container engine's **unix socket** when
that socket lives somewhere the desktop process can't open directly — inside a **WSL**
distribution, or on a **remote host over SSH (Windows only)**.

One module builds into **two single-file binaries** (selected by `GOOS`). Each is static,
needs no config file, and leaves nothing behind:

| Binary | Build | Mode | Used for |
|--------|-------|------|----------|
| `container-desktop-relay` | `GOOS=linux` | **bridge** | WSL — runs inside the distro, bridges the engine socket to stdio |
| `container-desktop-ssh-relay.exe` | `GOOS=windows` | **relay** | Remote SSH **on Windows** — bridges a Windows named pipe to a remote socket over SSH |

> Remote SSH on **Linux/macOS does not use this relay** — the app shells out to the native
> `ssh` client directly (`StrictHostKeyChecking=accept-new`). This helper only covers the WSL
> bridge and the Windows remote-SSH path. Podman Machine / Docker Desktop connect through
> their own host pipe and don't use it at all.

## Bridge mode — WSL (`container-desktop-relay`, linux build)

Source: [`main_linux.go`](main_linux.go). The app (Windows side, `WSLRelayServer` in
[`src/platform/node-executor.ts`](../../src/platform/node-executor.ts)) runs this **inside the
distribution via `wsl.exe --exec`**, once per client connection, and pumps bytes between a
Windows **named pipe** and the relay's **stdin/stdout**:

```text
Windows named pipe  <->  wsl.exe stdio  <->  container-desktop-relay  <->  /run/.../podman.sock
```

It is a pure pipe: it dials the engine unix socket (short retry so a just-started engine
still connects) and copies `stdin → socket` and `socket → stdout` with half-close framing.
**No TCP listener, no SSH, no keys, no files.** It asks the kernel to `SIGKILL` it if its
parent (`wsl.exe`) dies (`PR_SET_PDEATHSIG`), so nothing is ever orphaned inside the distro.

Flags — that is the entire surface:

| Flag | Default | Meaning |
|------|---------|---------|
| `--mode` | `bridge` | only `bridge` is supported on the linux build |
| `--socket` | — | engine unix socket to bridge (required) |
| `--retry` | `50` | socket dial attempts (100 ms apart) before giving up |

The app injects this binary into the distribution under a **version-scoped path**
(`<app-home>/bin/<version>/container-desktop-relay`) and **verifies it by SHA-256** before
running it — recopying if the in-distro hash differs, and refusing to run on mismatch.

## Relay mode — remote SSH on Windows (`container-desktop-ssh-relay.exe`, windows build)

Source: [`main_windows.go`](main_windows.go) + [`ssh_forwarder.go`](ssh_forwarder.go). On
Windows a unix-socket `ssh -L` forward isn't available, so the app runs this binary to bridge
a Windows named pipe to the remote engine socket over SSH (`golang.org/x/crypto/ssh`,
`direct-streamlocal`):

```text
Windows named pipe  <->  container-desktop-ssh-relay.exe  --(SSH)-->  remote /var/run/docker.sock
```

The app invokes it with exactly these flags:

```text
container-desktop-ssh-relay.exe \
  --named-pipe     "npipe://<local-pipe>" \
  --ssh-connection "ssh://<user>@<host>:<port><remote-unix-socket>" \
  --ssh-timeout    15 \
  --identity-path  <private-key>
```

The remote host key is verified against `~/.ssh/known_hosts` (`knownhosts.FixedHostKey`).

## Building

```bash
./relay-build.sh        # builds both binaries into ./bin (+ .sha256 sidecars)
```

(`relay-build.cmd` / `relay-build.ps1` on Windows.) Outputs `bin/container-desktop-relay`
(linux bridge) and `bin/container-desktop-ssh-relay.exe` (windows relay), each with a
`.sha256` sidecar. Vulnerability scan: `govulncheck ./...`.

## Testing

`go test ./...`. The Windows SSH paths are `//go:build windows`, so they only compile under
`GOOS=windows` — CI runs the suite on **both** ubuntu and windows
([`.github/workflows/CIPipeline.yml`](../../.github/workflows/CIPipeline.yml)).

## Notes

- Logs go to **stderr** as JSON (`LOG_LEVEL` env — `trace|debug|info|warn|error`, default
  `debug`) so stdout stays a clean byte pipe.
- `main_windows.go` still carries **legacy** flags/helpers from the previous design (an
  in-WSL SSH server on `:20022`, key-pair generation, a JSON config with health/metrics
  ports, a `--relay-program-path` self-spawn path). The app passes none of them; they remain
  only until pruned. The current WSL path is the stdio **bridge** above — there is no longer
  an SSH server inside the distribution.
