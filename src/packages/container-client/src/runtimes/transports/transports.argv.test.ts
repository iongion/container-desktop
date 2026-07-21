import { afterEach, describe, expect, it } from "vitest";
import { type FakeCommandHandle, installFakeCommand, type RecordedCall } from "@/__tests__/setup/fakeCommand";
import { getDefaultConnectors } from "@/container-client/connection";
import { createComposedHostClient } from "@/container-client/runtimes/registry";
import type { EngineConnectorSettings } from "@/container-client/types/connection";
import { ContainerEngine, ContainerEngineHost } from "@/container-client/types/engine";
import type { HostExecOptions } from "@/container-client/types/host";
import { OperatingSystem } from "@/container-client/types/os";

// A scoped command flows client.runScopeCommand → transport.runScopeCommand → host.runHostCommand →
// Command.Execute(launcher, args). The fake records that final Execute, so these tests pin the exact
// controller wrapper each transport emits (the thing that silently breaks when a flag/order changes).

let fake: FakeCommandHandle;
afterEach(() => fake?.restore());

async function recordScopeCommand(opts: {
  osType: OperatingSystem;
  engine: ContainerEngine;
  host: ContainerEngineHost;
  controllerName: string;
  scope: string;
  program: string;
  args: string[];
  execOpts?: HostExecOptions;
}): Promise<RecordedCall> {
  const connector = getDefaultConnectors(opts.osType).find((c) => c.engine === opts.engine && c.host === opts.host);
  if (!connector) {
    throw new Error(`no connector for ${opts.engine}/${opts.host} on ${opts.osType}`);
  }
  const client = await createComposedHostClient(connector, opts.osType);
  const settings: EngineConnectorSettings = {
    ...connector.settings,
    controller: { name: opts.controllerName, path: opts.controllerName, version: "", scope: opts.scope },
  };
  await client.setSettings(settings);
  fake = installFakeCommand();
  await client.runScopeCommand(opts.program, opts.args, opts.scope, settings, opts.execOpts);
  return fake.calls[0];
}

describe("transport scoped-exec argv", () => {
  it("WSL: wsl.exe --distribution <scope> --exec <program> <args> (and Windows .exe munging)", async () => {
    const call = await recordScopeCommand({
      osType: OperatingSystem.Windows,
      engine: ContainerEngine.PODMAN,
      host: ContainerEngineHost.PODMAN_VIRTUALIZED_WSL,
      controllerName: "wsl",
      scope: "Ubuntu-24.04",
      program: "podman",
      args: ["ps"],
    });
    expect(call.launcher).toBe("wsl.exe");
    expect(call.args).toEqual(["--distribution", "Ubuntu-24.04", "--exec", "podman", "ps"]);
  });

  it("LIMA: limactl shell <scope> <program> <args>", async () => {
    const call = await recordScopeCommand({
      osType: OperatingSystem.MacOS,
      engine: ContainerEngine.PODMAN,
      host: ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA,
      controllerName: "limactl",
      scope: "default",
      program: "podman",
      args: ["ps"],
    });
    expect(call.launcher).toBe("limactl");
    expect(call.args).toEqual(["shell", "default", "podman", "ps"]);
  });

  it("Podman machine: podman machine ssh <scope> -o LogLevel=ERROR <program> <args>", async () => {
    const call = await recordScopeCommand({
      osType: OperatingSystem.Linux,
      engine: ContainerEngine.PODMAN,
      host: ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR,
      controllerName: "podman",
      scope: "podman-machine-default",
      program: "podman",
      args: ["ps"],
    });
    expect(call.launcher).toBe("podman");
    expect(call.args).toEqual(["machine", "ssh", "podman-machine-default", "-o", "LogLevel=ERROR", "podman", "ps"]);
  });

  it("threads execOpts.input (a secret) to the final Command.Execute stdin, never into argv", async () => {
    const secret = "s3cr3t-token";
    const call = await recordScopeCommand({
      osType: OperatingSystem.Windows,
      engine: ContainerEngine.PODMAN,
      host: ContainerEngineHost.PODMAN_VIRTUALIZED_WSL,
      controllerName: "wsl",
      scope: "Ubuntu-24.04",
      program: "podman",
      args: ["login", "registry.example.com", "--username", "alice", "--password-stdin"],
      execOpts: { input: secret },
    });
    // The secret arrives via opts.input (piped to the child's stdin), NOT anywhere in the launcher/argv.
    expect(call.opts?.input).toBe(secret);
    expect(JSON.stringify([call.launcher, ...call.args])).not.toContain(secret);
  });
});
