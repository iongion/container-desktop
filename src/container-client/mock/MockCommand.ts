// A fixture-backed ICommand — the switchable mock for the communication layer. ProxyRequest is the
// HTTP/data seam (delegates to mockApiAdapter); Execute/Spawn answer the few CLI reads the UI makes
// (`<engine> system info` for the System Info screen, `<engine> --version`) from fixtures; the
// service-lifecycle methods report success/"ready" so the app reaches READY with no real engine.
// Generalizes the test-only installFakeCommand (src/__tests__/setup/fakeCommand.ts) into something the
// running app installs (main + preload) when mock mode is on.

import { EventEmitter } from "eventemitter3";

import { type CommandExecutionResult, ContainerEngine } from "@/env/Types";
import { loadEngineFixtures } from "./fixturesLoader";
import { mockApiAdapter } from "./mockApiAdapter";
import { getMockEngine } from "./mode";

function okResult(over?: Partial<CommandExecutionResult>): CommandExecutionResult {
  return { pid: 1, code: 0, success: true, stdout: "", stderr: "", ...over };
}

function engineForLauncher(launcher: string): ContainerEngine {
  const normalized = `${launcher}`.toLowerCase();
  if (normalized.includes("docker")) {
    return ContainerEngine.DOCKER;
  }
  if (normalized.includes("podman")) {
    return ContainerEngine.PODMAN;
  }
  if (normalized.includes("container")) {
    return ContainerEngine.APPLE;
  }
  return getMockEngine();
}

// For a scoped/remote build the launcher is a wrapper (wsl/limactl/ssh/podman machine ssh), so the engine
// name rides in the args (e.g. ["--distribution","Ubuntu","--exec","podman","build",…]). When the launcher
// doesn't itself name an engine, pick it from the first engine token in the args; otherwise fall back.
function engineForStreamingArgs(launcher: string, flat: string[]): ContainerEngine {
  const normalizedLauncher = `${launcher}`.toLowerCase();
  if (!/docker|podman|container/.test(normalizedLauncher)) {
    for (const token of flat) {
      const value = `${token}`.toLowerCase();
      if (value === "docker") {
        return ContainerEngine.DOCKER;
      }
      if (value === "podman") {
        return ContainerEngine.PODMAN;
      }
      if (value === "container") {
        return ContainerEngine.APPLE;
      }
    }
  }
  return engineForLauncher(launcher);
}

// Scope wrappers run a program INSIDE the guest: `wsl … --exec <prog> <args>`, `limactl shell <scope> <prog>
// <args>`, `podman machine ssh <scope> [-o …] <prog> <args>`. Unwrap to the real program so the fixture-backed
// reads (version / which / system info / echo) answer the same as a native call and a scoped connection boots.
function unwrapScopeCommand(launcher: string, flat: string[]): { program: string; args: string[] } | undefined {
  const l = `${launcher}`.toLowerCase();
  if (l.includes("wsl")) {
    const idx = flat.indexOf("--exec");
    if (idx >= 0 && flat[idx + 1]) {
      return { program: flat[idx + 1], args: flat.slice(idx + 2) };
    }
  }
  if (l.includes("limactl") && flat[0] === "shell" && flat[2]) {
    return { program: flat[2], args: flat.slice(3) };
  }
  if (l.includes("podman") && flat[0] === "machine" && flat[1] === "ssh") {
    let i = 3;
    while (flat[i] === "-o") {
      i += 2;
    }
    if (flat[i]) {
      return { program: flat[i], args: flat.slice(i + 1) };
    }
  }
  return undefined;
}

async function runCli(launcher: string, args: string[]): Promise<CommandExecutionResult> {
  const flat = (args || []).map((a) => `${a}`);
  const unwrapped = unwrapScopeCommand(launcher, flat);
  if (unwrapped) {
    return await runCli(unwrapped.program, unwrapped.args);
  }
  const engine = engineForLauncher(launcher);
  const normalizedLauncher = `${launcher}`.toLowerCase();
  const firstArg = `${flat[0] || ""}`.toLowerCase();
  // `echo <x>` (used by the WSL/LIMA scope start-checks) echoes its argument.
  if (normalizedLauncher === "echo" || normalizedLauncher.endsWith("/echo")) {
    return okResult({ stdout: `${flat.join(" ")}\n` });
  }
  if ((normalizedLauncher.endsWith("which") || normalizedLauncher.endsWith("whereis")) && firstArg === "trivy") {
    return okResult({
      stdout: normalizedLauncher.endsWith("whereis") ? "trivy: /usr/bin/trivy\n" : "/usr/bin/trivy\n",
    });
  }
  if (normalizedLauncher.includes("trivy")) {
    const fx = await loadEngineFixtures(engine);
    if (flat.includes("--version") && flat.includes("--format") && flat.includes("json")) {
      return okResult({
        stdout: JSON.stringify({
          Version: "0.56.2",
          VulnerabilityDB: {
            Version: 2,
            UpdatedAt: "2024-11-02T06:00:00Z",
            DownloadedAt: "2024-11-02T08:00:00Z",
          },
        }),
      });
    }
    if (flat.includes("--version")) {
      return okResult({ stdout: "Trivy Version 0.56.2" });
    }
    return okResult({
      stdout: JSON.stringify({
        Results: (fx.extras.securityReport as any)?.result ?? [],
      }),
    });
  }
  // `ip -o -4 addr show scope global` → advertise-address candidates for the Swarm init drawer's NIC picker.
  // Two NICs matching the "init-error" scenario's message (10.0.2.15 on eth0, 192.168.64.1 on eth1).
  if (normalizedLauncher.endsWith("ip") && flat.includes("addr")) {
    return okResult({
      stdout:
        "2: eth0    inet 10.0.2.15/24 brd 10.0.2.255 scope global eth0\\       valid_lft forever preferred_lft forever\n" +
        "3: eth1    inet 192.168.64.1/24 brd 192.168.64.255 scope global eth1\\       valid_lft forever preferred_lft forever\n",
    });
  }
  if (flat[0] === "machine") {
    const fx = await loadEngineFixtures(engine);
    if (engine !== ContainerEngine.PODMAN) {
      return okResult({ stdout: "[]" });
    }
    if (flat[1] === "list") {
      return okResult({ stdout: JSON.stringify(fx.machines) });
    }
    if (flat[1] === "inspect") {
      const name = flat[2];
      const machines = (fx.machines as any[]).filter((machine) => !name || machine.Name === name);
      return okResult({
        stdout: JSON.stringify(
          machines.map((machine) => ({
            Name: machine.Name,
            ConfigDir: { Path: `/home/mock/.config/containers/podman/machine/${machine.Name}` },
            ConnectionInfo: {
              PodmanSocket: { Path: `/run/user/1000/podman/${machine.Name}.sock` },
              PodmanPipe: { Path: null },
            },
            Created: machine.Created,
            LastUp: machine.LastUp,
            Resources: {
              CPUs: machine.CPUs,
              DiskSize: machine.DiskSize,
              Memory: machine.Memory,
              USBs: [],
            },
            SSHConfig: {
              IdentityPath: `/home/mock/.ssh/${machine.Name}`,
              Port: machine.Running ? 2222 : 0,
              RemoteUsername: "core",
            },
            State: machine.Running ? "running" : "stopped",
            UserModeNetworking: true,
            Rootful: false,
            Rosetta: false,
          })),
        ),
      });
    }
    return okResult();
  }
  // `<engine> system info --format json` → the SystemInfo JSON the dialect parses from stdout.
  if (flat.includes("info")) {
    const fx = await loadEngineFixtures(engine);
    return okResult({ stdout: JSON.stringify(fx.info) });
  }
  // `<engine> --version` / `<engine> version`.
  if (flat.includes("--version") || flat.includes("version")) {
    const fx = await loadEngineFixtures(engine);
    return okResult({ stdout: fx.extras.versionText });
  }
  return okResult();
}

/** Build a fresh MockCommand (implements ICommand). */
export function createMockCommand(): ICommand {
  const command: ICommand = {
    async Execute(launcher: string, args: string[]) {
      return runCli(launcher, args);
    },
    async Spawn(launcher: string, args: string[]) {
      return runCli(launcher, args);
    },
    async Kill() {
      /* no-op */
    },
    async CreateNodeJSApiDriver() {
      return { request: async () => ({ status: 200, data: "OK" }) };
    },
    async ExecuteStreaming(launcher: string, args: string[]) {
      const emitter = new EventEmitter();
      const flat = (args || []).map((a) => `${a}`);
      const isBuild = flat.includes("build");
      const engine = engineForStreamingArgs(launcher, flat);
      // Replay engine-shaped build output on a macrotask so the caller's `handle.on(...)` attaches first.
      setTimeout(async () => {
        if (isBuild) {
          const fx = await loadEngineFixtures(engine);
          for (const chunk of fx.buildOutput ?? []) {
            emitter.emit("data", chunk);
          }
        }
        emitter.emit("exit", { code: 0 });
        emitter.emit("close", { code: 0 });
      }, 0);
      return {
        on: (event: string, listener: any) => emitter.on(event as any, listener),
        off: (event: string, listener: any) => emitter.off(event as any, listener),
        dispose: () => emitter.removeAllListeners(),
        kill: () => emitter.emit("exit", { code: null, signal: "SIGTERM" }),
      } as StreamHandle;
    },
    async ExecuteAsBackgroundService() {
      const emitter = new EventEmitter();
      // Resolve on a macrotask so the caller's "ready" listener is registered first.
      setTimeout(
        () =>
          emitter.emit("ready", {
            process: okResult(),
            child: { pid: 1, code: 0, success: true, kill: () => {}, unref: () => {} },
          }),
        0,
      );
      return emitter as any;
    },
    async StartSSHConnection() {
      // Mock connections are native; SSH establishment is never exercised.
      throw new Error("MockCommand: StartSSHConnection is not supported in mock mode");
    },
    async StopConnectionServices() {
      /* no-op */
    },
    async ProxyRequest(request: any, connection: any) {
      return mockApiAdapter(request, connection);
    },
  };
  return command;
}
