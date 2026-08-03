// Connection-exec capability (MAIN). Implements the neutral ConnectionExecHost port over the live
// EngineDataService — the same host clients the rest of the app uses. It gives an AI worker CAPTURED,
// non-interactive command execution on any connection: the local host, a remote host over SSH, or inside a
// container on either. The scope/SSH/WSL wrapping is done by the facade's runHostCommand/runScopeCommand, so a
// container on a *_REMOTE connection is the remote-container case with no extra branch.

import type { ConnectionExecHost, ConnectionExecOptions, ConnectionExecResult } from "@/ai-system/core/ports";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import type { EngineConnectorSettings } from "@/container-client/types/connection";
import { OperatingSystem } from "@/container-client/types/os";

import type { EngineDataService } from "@/platform/engineDataService";

// Captured output is bounded so a chatty command cannot blow up the transcript or model history.
const MAX_STREAM_CHARS = 100_000;

// How a bare POSIX workspace program (cat / tee / stat / find / grep / mkdir …) is run on a connection's own
// host shell. A unix host runs it directly. A Windows host has NO POSIX tools and a cmd.exe login shell, so the
// single POSIX exec-workspace dialect is bridged through WSL — `wsl -e <program> <args…>` — which is a hard
// requirement for a Windows remote worker target. This one function is the seam: a future alternative Windows
// strategy (a cmd.exe / PowerShell workspace dialect) would branch here instead; today WSL is the only one.
// NOTE: only the DIRECT host exec (execOnConnection) is bridged — container/sandbox targets run the native
// Windows engine CLI (docker.exe / podman.exe) which talks to a Linux engine, so their argv must NOT be wrapped.
export function hostShellArgv(osType: OperatingSystem, program: string, args: string[]): [string, string[]] {
  if (osType === OperatingSystem.Windows) {
    return ["wsl", ["-e", program, ...args]];
  }
  return [program, args];
}

interface CommandResult {
  code: unknown;
  success: boolean;
  stdout?: string;
  stderr?: string;
}

function cap(text: string | undefined): { value: string; truncated: boolean } {
  const s = text ?? "";
  return s.length > MAX_STREAM_CHARS
    ? { value: s.slice(0, MAX_STREAM_CHARS), truncated: true }
    : { value: s, truncated: false };
}

function toResult(raw: CommandResult): ConnectionExecResult {
  const out = cap(raw.stdout);
  const err = cap(raw.stderr);
  const code = typeof raw.code === "number" ? raw.code : raw.success ? 0 : null;
  return { code, stdout: out.value, stderr: err.value, truncated: out.truncated || err.truncated };
}

export function createConnectionExecAdapter(service: EngineDataService): ConnectionExecHost {
  // A Windows host bridges POSIX workspace execs through `wsl -e …` (hostShellArgv). If WSL is not installed or has
  // no default distro, every bridged command fails with a cryptic wsl error. Probe `wsl -e true` ONCE per
  // connection before the first bridged exec so the worker gets a clear, actionable error instead. A successful
  // probe is cached for the connection's lifetime; a failed one is dropped so a later install is picked up.
  const wslProbes = new Map<string, Promise<void>>();

  function resolve(connectionId: string): HostClientFacade {
    const host = service.getHost(connectionId) as HostClientFacade | undefined;
    if (!host) {
      throw new Error(`Connection "${connectionId}" is not running.`);
    }
    return host;
  }

  // Run an argv in the connection's environment. Scoped/remote hosts wrap it (wsl/limactl/ssh) inside
  // runScopeCommand; a native host runs it directly on the local box via runHostCommand.
  async function runOn(
    host: HostClientFacade,
    settings: EngineConnectorSettings,
    program: string,
    args: string[],
    opts?: ConnectionExecOptions,
  ): Promise<ConnectionExecResult> {
    const execOpts = opts?.input !== undefined ? { input: opts.input } : undefined;
    const raw = host.isScoped()
      ? await host.runScopeCommand(program, args, settings.controller?.scope ?? "", settings, execOpts)
      : await host.runHostCommand(program, args, settings, execOpts);
    return toResult(raw);
  }

  function engineProgram(settings: EngineConnectorSettings): string {
    const program = settings.program?.path || settings.program?.name;
    if (!program) throw new Error("Engine program is not configured for this connection.");
    return program;
  }

  // Captured, non-interactive exec into a container: `<engine> exec -i [--workdir <dir>] <id> <program> <args…>`.
  // `-i` is REQUIRED so a piped `input` reaches the container process on stdin — without it the engine leaves
  // stdin closed and stdin-reading programs (e.g. `tee`, used by writeFile) silently produce an empty file. We
  // always feed stdin (empty string when there is no input) so `-i` never blocks on an inherited parent stdin.
  // The program token is a bare executable (floor-validated), so no `--` separator is needed for a leading dash.
  async function execInContainerImpl(
    host: HostClientFacade,
    settings: EngineConnectorSettings,
    containerId: string,
    program: string,
    args: string[],
    opts?: ConnectionExecOptions,
  ): Promise<ConnectionExecResult> {
    const flags = opts?.workdir ? ["-i", "--workdir", opts.workdir] : ["-i"];
    return runOn(host, settings, engineProgram(settings), ["exec", ...flags, containerId, program, ...args], {
      ...opts,
      input: opts?.input ?? "",
    });
  }

  // Run `wsl -e true` once per connection; throw a clear error if WSL is unavailable. Cached on success, dropped
  // on failure so a subsequent probe re-checks (the user may install WSL between attempts).
  async function ensureWslAvailable(
    connectionId: string,
    host: HostClientFacade,
    settings: EngineConnectorSettings,
  ): Promise<void> {
    let probe = wslProbes.get(connectionId);
    if (!probe) {
      probe = runOn(host, settings, "wsl", ["-e", "true"]).then((result) => {
        if (result.code !== 0) {
          throw new Error(
            `A Windows worker target requires WSL, but "wsl -e true" failed on connection "${connectionId}": ${result.stderr || "WSL is not available"}`,
          );
        }
      });
      probe.catch(() => wslProbes.delete(connectionId));
      wslProbes.set(connectionId, probe);
    }
    return probe;
  }

  return {
    async execOnConnection(connectionId, program, args, opts) {
      const host = resolve(connectionId);
      const settings = await host.getSettings();
      if (host.osType === OperatingSystem.Windows) {
        await ensureWslAvailable(connectionId, host, settings);
      }
      const [prog, argv] = hostShellArgv(host.osType, program, args);
      return runOn(host, settings, prog, argv, opts);
    },

    async execInContainer(connectionId, containerId, program, args, opts) {
      const host = resolve(connectionId);
      const settings = await host.getSettings();
      return execInContainerImpl(host, settings, containerId, program, args, opts);
    },

    async createSandboxContainer(connectionId, image, sandbox) {
      const host = resolve(connectionId);
      const settings = await host.getSettings();
      // Detached, labeled (for orphan cleanup), kept alive by an overridden entrypoint. `run -d` prints the new
      // container id on stdout. NOTE: no `--workdir /workspace` here — a workdir that does not yet exist in the
      // image aborts container start on podman ("workdir does not exist"), so we create /workspace by exec below
      // and pin it per-exec (opts.workdir) instead.
      const result = await runOn(host, settings, engineProgram(settings), [
        "run",
        "-d",
        "--label",
        sandbox.label,
        "--entrypoint",
        "sleep",
        image,
        "infinity",
      ]);
      const containerId = result.stdout.trim().split(/\s+/).pop() ?? "";
      if (!containerId || result.code !== 0) {
        throw new Error(`Unable to create sandbox container from "${image}": ${result.stderr || "no id returned"}`);
      }
      // Create the workspace dir now that the container is running (no --workdir here, so it runs from the image
      // default cwd before /workspace exists). Subsequent execs pin --workdir /workspace via opts.workdir.
      const made = await execInContainerImpl(host, settings, containerId, "mkdir", ["-p", "/workspace"]);
      if (made.code !== 0) {
        await runOn(host, settings, engineProgram(settings), ["rm", "-f", containerId]).catch(() => undefined);
        throw new Error(`Unable to initialize sandbox workspace in "${image}": ${made.stderr || "mkdir failed"}`);
      }
      return { containerId };
    },

    async removeSandboxContainer(connectionId, containerId) {
      const host = resolve(connectionId);
      const settings = await host.getSettings();
      await runOn(host, settings, engineProgram(settings), ["rm", "-f", containerId]);
    },
  };
}
