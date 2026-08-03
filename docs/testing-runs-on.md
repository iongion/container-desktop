# Testing worker execution targets ("Runs on")

A worker can run its file + command tools on one of four targets — **host · remote host (SSH) · an existing
container · a throwaway sandbox** (see [`architecture/ai-subsystem.md`](architecture/ai-subsystem.md#execution-targets-runs-on)).
This is exercised by **one scenario matrix with two implementations**, so there is a single list of behaviors
to maintain, not two:

| Arm | Where | Execution host | Proves | Runs in |
| --- | ----- | -------------- | ------ | ------- |
| **mock** | `src/packages/platform/tests/capabilities/executionTargets.mock.test.ts` | in-memory `VirtualEngineHost` | the **logic** — a write reads back, floor/root/scoping are right, the sandbox is disposed | the default `yarn test:run` (hermetic, CI) |
| **live** | `src/__tests__/live/runs-on.live.test.ts` | real **podman + docker** (local) **and every SSH remote engine** via a CLI `ConnectionExecHost` (local spawn or an SSH-wrapping `Runner`) | the **transport** — the engine forwards stdin (over SSH too), a sandbox really starts and is really removed, remote-container works end to end | `yarn test:runs-on:live` (never CI) |

Both arms call the **same** `runExecutionTargetMatrix(...)` in
[`src/__tests__/support/executionTargetMatrix.ts`](../src/__tests__/support/executionTargetMatrix.ts), which
drives the **real** `createRunHost → createExecutionSelector → createExecWorkspaceAccess`. Only the injected
`ConnectionExecHost` differs. Mock catches logic regressions; live catches engine/transport regressions.

## The scenarios (per target)

For each supported target the matrix builds a worker, has the run host resolve its backend, and — through a
no-model scenario `createTeamRun` — drives the worker's own workspace end to end:

- **write → read** the same file (proves content survives *where the worker runs*),
- **edit · list · stat · glob · grep · execCommand**,
- asserts the **floor scope** (`host`/`remote` → `strict`, `container` → `container`, `sandbox` → `sandbox`),
- asserts the **workspace root** (host → local; remote/container → `/tmp/container-desktop-ai/<runId>`;
  sandbox → `/workspace`),
- asserts the worker's **engineOps default to its own connection** (host stays unscoped),
- after the run, asserts the run's **sandbox container is removed** (live: queried against the engine, scoped
  to this run's own container ids).

## Two bugs this matrix caught

Both were invisible to the original unit tests, which asserted command **shape** against fakes that always
returned success — they never checked that a write could be read back.

1. **Sandbox never started on podman.** `createSandboxContainer` passed `--workdir /workspace` to `run -d`, but
   a workdir that does not yet exist in the image aborts container start on podman
   (`workdir "/workspace" does not exist`; docker auto-creates it). Fix: create without `--workdir`, then
   `mkdir -p /workspace` by exec, and pin the cwd per-exec.
2. **Every container/sandbox write produced an empty file.** `execInContainer` omitted `-i`, so the piped file
   content never reached the container process and `tee` wrote nothing. Fix: `exec -i [--workdir] …`, always
   feeding stdin.

## Running

```bash
# Mock arm — part of the hermetic suite (no engines needed):
yarn test:run

# Live arm — needs podman and/or docker on PATH; each engine (and each SSH remote) skips loudly if absent:
yarn test:runs-on:live

# Add a self-contained SSH remote (remote / remote-container over ssh) — no external machine:
yarn ssh-remote:up && yarn test:runs-on:live && yarn ssh-remote:down
```

The live arm force-removes any `container-desktop.ai.sandbox=*` container it leaves behind (on each engine, local
or remote), and uses `alpine:3` (`docker.io/library/alpine:3` on podman). It is kept out of CI by living in
`vitest.live.config.mts`.

## Remote / remote-container

The live arm exercises `remote`, `remote-sandbox` and `remote-container` for real against **every SSH engine the
live-target chain resolves** — the `CONTAINER_DESKTOP_REMOTE_*` `.env` entries and
[`src/__tests__/live/targets.env`](../src/__tests__/live/targets.example.env), loaded by the same
`loadTestTargets()` the connection matrix uses. A remote engine of your own (e.g. a Mac/Linux box over SSH) is
picked up automatically; nothing else is needed.

The `host` target always runs on the machine executing the suite; the `sandbox`/`remote`/`container` targets all
route through an **SSH-wrapping `Runner`** — the native-local analogue of the facade's
`runHostCommand` vs `runScopeCommand(ssh …)` split, so a `*_REMOTE` connection becomes remote-container with no
extra branch.

### Windows remotes — WSL is required

The exec-routed workspace emits POSIX argv (`mkdir -p`, `tee`, `stat -c`, `find`, `grep -rnIE`), which no native
Windows shell runs (cmd.exe and PowerShell both lack `stat`/`grep`/`find`/`tee`). So a **Windows** remote's
`remote` (native-FS) target is **bridged through WSL** — the single POSIX dialect runs unchanged via
`wsl -e <program> <args…>`. **WSL is a hard requirement for a Windows remote worker.** This is the same seam in
production: [`connectionExec.ts`](../src/packages/platform/src/capabilities/connectionExec.ts)
`hostShellArgv(osType, …)` wraps `execOnConnection` in `wsl -e` when the connection's `osType` is Windows (the
live test imports the *same* function, so test and shipped adapter can't drift). `container`/`sandbox` targets
are NOT WSL-bridged — they run the native Windows engine CLI (`docker.exe`/`podman.exe`) into a Linux container.
The single function is where a future cmd.exe / PowerShell workspace dialect would plug in; today WSL is the only
strategy.

A Windows target is declared with an explicit `_OS` (`CONTAINER_DESKTOP_REMOTE_*` can't express it — it stamps the
*client* OS), so use the `CDT_TARGET_*` form:

```ini
CDT_TARGET_WIN11_ENABLED=true
CDT_TARGET_WIN11_OS=Windows_NT
CDT_TARGET_WIN11_HOSTS=docker.remote
CDT_TARGET_WIN11_SSH_HOST=win11        # ~/.ssh/config alias; key via ssh-agent
CDT_TARGET_WIN11_SSH_USER=you
```

The matrix probes each capability and gates per-kind: **WSL reachable** (`wsl -e true`) enables the `remote`
target; an **engine daemon reachable** (`<engine> ps`) enables `sandbox`/existing-`container`. A Windows remote
with WSL up but Docker Desktop stopped runs `host` + `remote` and skips the engine targets loudly (start Docker
Desktop / `podman machine start` to include them).

### Self-contained remote (no external machine)

You do not need a spare box. The root [`docker-compose.yml`](../docker-compose.yml) `remote-engine` service is an
**sshd + docker-in-docker** host — a genuine, throwaway REMOTE docker engine reachable over SSH. The driver
[`support/ssh-remote-sandbox.sh`](../support/ssh-remote-sandbox.sh) (mirroring `support/swarm-sandbox.sh`) builds
and starts it, generates an ephemeral keypair, and writes a `CONTAINER_DESKTOP_REMOTE_DEVSSH_*` block into
`targets.env` so the loader finds it automatically:

```bash
yarn ssh-remote:up            # build+start the sshd/dind remote, write targets.env
yarn test:runs-on:live        # now runs podman/docker native + the devssh SSH remote (remote-container over ssh)
yarn ssh-remote:down          # stop, strip the targets.env block, delete keys
```

Scope to just the sandbox with `CONTAINER_DESKTOP_TEST_TARGETS=devssh yarn test:runs-on:live`. The command argv
the SSH `Runner` mirrors is the same fixed adapter argv asserted in
[`connectionExec.test.ts`](../src/packages/platform/tests/capabilities/connectionExec.test.ts) (a scoped
`*_REMOTE` connection routes through `runScopeCommand`).

## The VirtualEngineHost (mock quality)

The mock arm's fidelity comes from
[`src/packages/ai-system/src/testing/virtualEngineHost.ts`](../src/packages/ai-system/src/testing/virtualEngineHost.ts):
an in-memory `ConnectionExecHost` with a container registry and a command emulator that honors the **exact**
POSIX argv the exec-routed workspace emits (`mkdir -p`, `tee`+stdin, `cat`, `ls -1Ap`, `stat -c`, `find`,
`grep -rnIE`, `rm -r`). It has its own unit test and is **also wired into the live mock app**: under
`CONTAINER_DESKTOP_MOCK` the execution selector runs over it, so a mock Team Run worker genuinely resolves and runs
on its sandbox/container/remote target (a real in-memory roundtrip) instead of the old host-only fallback. The
seeded "Editor" worker ships with a sandbox target so the wiring is exercised out of the box.
