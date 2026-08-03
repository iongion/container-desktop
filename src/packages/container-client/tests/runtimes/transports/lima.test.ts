import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FakeCommandHandle, installFakeCommand } from "@/__tests__/setup/fakeCommand";
import { LIMATransport } from "@/container-client/runtimes/transports/lima";
import type { EngineConnectorSettings } from "@/container-client/types/connection";
import { OperatingSystem } from "@/container-client/types/os";

// The rule a real Mac disproved: an instance called `ubuntu-vm`, created from LIMA's stock docker
// template, forwards `sock/docker.sock` — never `sock/ubuntu-vm.sock`. Composing the name from the
// instance timed the connection out for 50s against a path nothing binds.
const REPORT = JSON.stringify({
  name: "ubuntu-vm",
  config: {
    portForwards: [
      { guestPortRange: [1, 65535], hostPortRange: [1, 65535] },
      { guestSocket: "/run/user/501/podman/podman.sock", hostSocket: "/Users/tester/.lima/ubuntu-vm/sock/podman.sock" },
      { guestSocket: "/var/run/docker.sock", hostSocket: "/Users/tester/.lima/ubuntu-vm/sock/docker.sock" },
    ],
  },
});

const PODMAN_GUEST = "/run/user/501/podman/podman.sock";
const DOCKER_GUEST = "/var/run/docker.sock";

const settings = (scope: string) =>
  ({ controller: { name: "limactl", path: "/opt/homebrew/bin/limactl", scope } }) as unknown as EngineConnectorSettings;

describe("LIMATransport.resolveScopeURI", () => {
  const g = globalThis as unknown as Record<string, unknown>;
  let previousOs: unknown;
  let command: FakeCommandHandle;

  beforeEach(() => {
    previousOs = g.CURRENT_OS_TYPE;
    g.CURRENT_OS_TYPE = OperatingSystem.MacOS;
  });

  afterEach(() => {
    g.CURRENT_OS_TYPE = previousOs;
    command?.restore();
  });

  it("is the socket LIMA reports it forwards, asked about that one instance", async () => {
    command = installFakeCommand(() => ({ stdout: REPORT }));

    expect(await new LIMATransport().resolveScopeURI({} as any, settings("ubuntu-vm"), DOCKER_GUEST)).toBe(
      "/Users/tester/.lima/ubuntu-vm/sock/docker.sock",
    );
    expect(command.calls).toHaveLength(1);
    expect(command.calls[0].launcher).toBe("/opt/homebrew/bin/limactl");
    expect(command.calls[0].args).toEqual(["list", "--format", "json", "ubuntu-vm"]);
  });

  it("picks the forward whose guestSocket the engine reported, so two engines in one instance differ", async () => {
    command = installFakeCommand(() => ({ stdout: REPORT }));
    expect(await new LIMATransport().resolveScopeURI({} as any, settings("ubuntu-vm"), PODMAN_GUEST)).toBe(
      "/Users/tester/.lima/ubuntu-vm/sock/podman.sock",
    );
  });

  it("takes the first forwarded socket when the engine named none", async () => {
    command = installFakeCommand(() => ({ stdout: REPORT }));
    expect(await new LIMATransport().resolveScopeURI({} as any, settings("ubuntu-vm"), "")).toBe(
      "/Users/tester/.lima/ubuntu-vm/sock/podman.sock",
    );
  });

  it("falls back to the engine-agnostic convention when LIMA forwards no socket", async () => {
    command = installFakeCommand(() => ({
      stdout: JSON.stringify({ name: "ubuntu-vm", config: { portForwards: null } }),
    }));
    const uri = await new LIMATransport().resolveScopeURI({} as any, settings("ubuntu-vm"));
    expect(uri.endsWith("/.lima/ubuntu-vm/sock/ubuntu-vm.sock")).toBe(true);
  });

  it("falls back when limactl refuses the flag, rather than losing the connection", async () => {
    command = installFakeCommand(() => ({ success: false, code: 1, stderr: "unknown flag: --format" }));
    const uri = await new LIMATransport().resolveScopeURI({} as any, settings("ubuntu-vm"));
    expect(uri.endsWith("/.lima/ubuntu-vm/sock/ubuntu-vm.sock")).toBe(true);
  });

  it("names no socket with no instance named, and asks nothing to find that out", async () => {
    command = installFakeCommand(() => ({ stdout: REPORT }));
    expect(await new LIMATransport().resolveScopeURI({} as any, settings(""))).toBe("");
    expect(command.calls).toHaveLength(0);
  });

  it("asks nothing off macOS, where LIMA does not exist", async () => {
    g.CURRENT_OS_TYPE = OperatingSystem.Linux;
    command = installFakeCommand(() => ({ stdout: REPORT }));
    const uri = await new LIMATransport().resolveScopeURI({} as any, settings("ubuntu-vm"));
    expect(uri.endsWith("/.lima/ubuntu-vm/sock/ubuntu-vm.sock")).toBe(true);
    expect(command.calls).toHaveLength(0);
  });
});
