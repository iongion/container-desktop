import { describe, expect, it } from "vitest";

import { ContainerEngine } from "@/env/Types";
import { authConfigPath, caCertPath, certsDir, dockerDaemonJsonPath, registriesConfPath } from "./paths";

const podmanRootless = { engine: ContainerEngine.PODMAN, rootfull: false, home: "/home/alice" };
const podmanRootful = { engine: ContainerEngine.PODMAN, rootfull: true, home: "/home/alice" };
const docker = { engine: ContainerEngine.DOCKER, rootfull: false, home: "/home/alice" };
const apple = { engine: ContainerEngine.APPLE, rootfull: false, home: "/home/alice" };

describe("registriesConfPath", () => {
  it("rootless podman → ~/.config/containers/registries.conf", () => {
    expect(registriesConfPath(podmanRootless)).toBe("/home/alice/.config/containers/registries.conf");
  });
  it("rootful podman → /etc/containers/registries.conf", () => {
    expect(registriesConfPath(podmanRootful)).toBe("/etc/containers/registries.conf");
  });
  it("docker + apple → undefined (docker uses daemon.json, apple none)", () => {
    expect(registriesConfPath(docker)).toBeUndefined();
    expect(registriesConfPath(apple)).toBeUndefined();
  });
});

describe("dockerDaemonJsonPath", () => {
  it("docker → /etc/docker/daemon.json; others undefined", () => {
    expect(dockerDaemonJsonPath(docker)).toBe("/etc/docker/daemon.json");
    expect(dockerDaemonJsonPath(podmanRootless)).toBeUndefined();
    expect(dockerDaemonJsonPath(apple)).toBeUndefined();
  });
});

describe("certsDir / caCertPath", () => {
  it("rootless podman certs.d under user config", () => {
    expect(certsDir(podmanRootless, "reg.local:5000")).toBe("/home/alice/.config/containers/certs.d/reg.local:5000");
    expect(caCertPath(podmanRootless, "reg.local:5000")).toBe(
      "/home/alice/.config/containers/certs.d/reg.local:5000/ca.crt",
    );
  });
  it("rootful podman certs.d under /etc/containers", () => {
    expect(caCertPath(podmanRootful, "reg.local")).toBe("/etc/containers/certs.d/reg.local/ca.crt");
  });
  it("docker certs.d under /etc/docker", () => {
    expect(caCertPath(docker, "reg.local")).toBe("/etc/docker/certs.d/reg.local/ca.crt");
  });
  it("apple → undefined", () => {
    expect(certsDir(apple, "reg.local")).toBeUndefined();
    expect(caCertPath(apple, "reg.local")).toBeUndefined();
  });
});

describe("authConfigPath", () => {
  it("podman → auth.json; docker → ~/.docker/config.json; apple → undefined", () => {
    expect(authConfigPath(podmanRootless)).toBe("/home/alice/.config/containers/auth.json");
    expect(authConfigPath(docker)).toBe("/home/alice/.docker/config.json");
    expect(authConfigPath(apple)).toBeUndefined();
  });
});
