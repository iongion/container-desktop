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

async function runCli(launcher: string, args: string[]): Promise<CommandExecutionResult> {
  const engine = engineForLauncher(launcher);
  const flat = (args || []).map((a) => `${a}`);
  const normalizedLauncher = `${launcher}`.toLowerCase();
  const firstArg = `${flat[0] || ""}`.toLowerCase();
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
