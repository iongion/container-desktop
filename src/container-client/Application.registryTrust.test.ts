import { afterEach, describe, expect, it } from "vitest";

import { type FakeCommandHandle, installFakeCommand } from "@/__tests__/setup/fakeCommand";
import { getDefaultConnectors } from "@/container-client/connection";
import { createComposedHostClient } from "@/container-client/runtimes/registry";
import { ContainerEngine, ContainerEngineHost, OperatingSystem } from "@/env/Types";
import { Application } from "./Application";

// Drive the REAL composed host so runHostCommand → Command.Execute is exercised; the fake records that final
// Execute (launcher/args/opts). The security property under test: the token rides opts.input (stdin), never argv.

let fake: FakeCommandHandle;
afterEach(() => {
  fake?.restore();
  (Application as any).instance = undefined;
});

function makeApp() {
  const bus = { send: () => undefined, invoke: async () => undefined };
  return Application.initInstance({
    osType: OperatingSystem.Linux,
    version: "0.0.0-test",
    environment: "test",
    messageBus: bus as any,
  });
}

async function nativePodmanHost() {
  const connector = getDefaultConnectors(OperatingSystem.Linux).find(
    (c) => c.engine === ContainerEngine.PODMAN && c.host === ContainerEngineHost.PODMAN_NATIVE,
  );
  if (!connector) {
    throw new Error("no native podman connector");
  }
  const host = await createComposedHostClient(connector, OperatingSystem.Linux);
  await host.setSettings({ ...connector.settings, program: { name: "podman", path: "/usr/bin/podman", version: "5" } });
  return host;
}

async function wslPodmanHost() {
  const connector = getDefaultConnectors(OperatingSystem.Windows).find(
    (c) => c.engine === ContainerEngine.PODMAN && c.host === ContainerEngineHost.PODMAN_VIRTUALIZED_WSL,
  );
  if (!connector) {
    throw new Error("no wsl podman connector");
  }
  const host = await createComposedHostClient(connector, OperatingSystem.Windows);
  await host.setSettings({
    ...connector.settings,
    controller: { name: "wsl", path: "wsl", version: "2", scope: "Ubuntu-24.04" },
    program: { name: "podman", path: "podman", version: "5" },
  });
  return host;
}

describe("Application.registryLogin", () => {
  it("uses --password-stdin with the secret on stdin, NEVER in argv", async () => {
    const app = makeApp();
    const host = await nativePodmanHost();
    fake = installFakeCommand();

    await app.registryLogin({ host, registry: "registry.example.com", username: "alice", secret: "s3cr3t-token" });

    const call = fake.calls[0];
    expect(call.launcher).toBe("/usr/bin/podman");
    expect(call.args).toEqual(["login", "registry.example.com", "--username", "alice", "--password-stdin"]);
    expect(call.opts?.input).toBe("s3cr3t-token");
    // The token appears nowhere in the launcher/argv, and the argv-`-p` form is never used.
    expect(JSON.stringify([call.launcher, ...call.args])).not.toContain("s3cr3t-token");
    expect(call.args).not.toContain("-p");
  });

  it("adds --tls-verify=false for an insecure podman login", async () => {
    const app = makeApp();
    const host = await nativePodmanHost();
    fake = installFakeCommand();

    await app.registryLogin({ host, registry: "reg.local:5000", username: "bob", secret: "x", insecure: true });

    expect(fake.calls[0].args).toContain("--tls-verify=false");
  });
});

describe("Application.registryLogout", () => {
  it("runs `logout <registry>`", async () => {
    const app = makeApp();
    const host = await nativePodmanHost();
    fake = installFakeCommand();

    await app.registryLogout({ host, registry: "registry.example.com" });

    expect(fake.calls[0].args).toEqual(["logout", "registry.example.com"]);
  });
});

describe("Application.writeRegistryConfig (scoped podman)", () => {
  it("read-modify-writes registries.conf, piping the merged TOML via stdin (mkdir + cat >)", async () => {
    const app = makeApp();
    const host = await wslPodmanHost();
    fake = installFakeCommand();

    const res = await app.writeRegistryConfig({
      host,
      registries: [{ name: "reg.local:5000", tls: "insecure", order: 1, enabled: true }],
      removedLocations: [],
    });

    expect(res.success).toBe(true);
    const write = fake.calls.find((c) => c.args.some((a) => typeof a === "string" && a.includes("cat >")));
    expect(write?.args.some((a) => a.includes("mkdir -p"))).toBe(true);
    // The merged config arrives on stdin (opts.input), not in argv.
    expect(write?.opts?.input).toContain('location = "reg.local:5000"');
    expect(write?.opts?.input).toContain("insecure = true");
    expect(write?.opts?.input).toContain('unqualified-search-registries = [ "reg.local:5000" ]');
  });
});

describe("Application.importCA (scoped docker)", () => {
  it("installs the PEM into certs.d via stdin (sudo), never in argv", async () => {
    const app = makeApp();
    const connector = getDefaultConnectors(OperatingSystem.Windows).find(
      (c) => c.engine === ContainerEngine.DOCKER && c.host === ContainerEngineHost.DOCKER_VIRTUALIZED_WSL,
    );
    if (!connector) {
      throw new Error("no wsl docker connector");
    }
    const host = await createComposedHostClient(connector, OperatingSystem.Windows);
    await host.setSettings({
      ...connector.settings,
      controller: { name: "wsl", path: "wsl", version: "2", scope: "Ubuntu-24.04" },
      program: { name: "docker", path: "docker", version: "27" },
    });
    fake = installFakeCommand();

    const pem = "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----\n";
    const res = await app.importCA({ host, registryHost: "reg.local", pem });

    expect(res.success).toBe(true);
    const write = fake.calls.find((c) => c.args.some((a) => typeof a === "string" && a.includes("cat >")));
    expect(write?.opts?.input).toBe(pem);
    // Scoped exec wraps the controller (wsl.exe … --exec) around `sudo sh -c …` — docker certs.d is under /etc.
    expect(write?.args).toContain("sudo");
    expect(write?.args).toContain("sh");
    // The PEM never appears in argv — only on stdin.
    expect(JSON.stringify([write?.launcher, ...(write?.args ?? [])])).not.toContain("BEGIN CERTIFICATE");
  });
});
