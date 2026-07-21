import { describe, expect, it } from "vitest";

import { containerNetworks, extractPublishedPorts, resolveTransport } from "./model";

describe("resolveTransport", () => {
  it("maps the host suffix to the target's transport (mirrors describeConnectionAttempt)", () => {
    expect(resolveTransport("podman.remote")).toBe("ssh");
    expect(resolveTransport("podman-machine-default.wsl")).toBe("wsl");
    expect(resolveTransport("colima.lima")).toBe("vm");
    expect(resolveTransport("docker-desktop.vendor")).toBe("vm");
    expect(resolveTransport("unix:///run/podman/podman.sock")).toBe("native");
    expect(resolveTransport(undefined)).toBe("native");
  });
});

describe("extractPublishedPorts", () => {
  it("parses docker-cased PortBindings (HostPort/HostIp) with a default host IP", () => {
    const container = {
      HostConfig: {
        PortBindings: {
          "80/tcp": [{ HostIp: "", HostPort: "8080" }],
          "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }],
        },
      },
    };
    expect(extractPublishedPorts(container as any)).toEqual([
      { containerPort: 80, protocol: "tcp", hostIp: "0.0.0.0", hostPort: 8080 },
      { containerPort: 443, protocol: "tcp", hostIp: "127.0.0.1", hostPort: 8443 },
    ]);
  });

  it("parses podman-cased PortBindings (hostPort/hostIp) and defaults the protocol to tcp", () => {
    const container = {
      HostConfig: {
        PortBindings: {
          "5432": [{ hostIp: "0.0.0.0", hostPort: 5432 }],
        },
      },
    };
    expect(extractPublishedPorts(container as any)).toEqual([
      { containerPort: 5432, protocol: "tcp", hostIp: "0.0.0.0", hostPort: 5432 },
    ]);
  });

  it("returns an empty list when nothing is published", () => {
    expect(extractPublishedPorts({} as any)).toEqual([]);
    expect(extractPublishedPorts({ HostConfig: { PortBindings: {} } } as any)).toEqual([]);
  });

  it("reads the list-shaped Ports (podman host_port, docker PublicPort), skipping unpublished entries", () => {
    const podman = {
      Ports: [
        { host_ip: "0.0.0.0", container_port: 80, host_port: 8080, protocol: "tcp" },
        { container_port: 9229, host_port: 0, protocol: "tcp" }, // exposed but not published → skipped
      ],
    };
    expect(extractPublishedPorts(podman as any)).toEqual([
      { containerPort: 80, protocol: "tcp", hostIp: "0.0.0.0", hostPort: 8080 },
    ]);
    const docker = { Ports: [{ IP: "127.0.0.1", PrivatePort: 5432, PublicPort: 5432, Type: "tcp" }] };
    expect(extractPublishedPorts(docker as any)).toEqual([
      { containerPort: 5432, protocol: "tcp", hostIp: "127.0.0.1", hostPort: 5432 },
    ]);
  });

  it("de-duplicates a port present in both PortBindings and the Ports list", () => {
    const container = {
      HostConfig: { PortBindings: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }] } },
      Ports: [{ host_ip: "0.0.0.0", container_port: 80, host_port: 8080, protocol: "tcp" }],
    };
    expect(extractPublishedPorts(container as any)).toEqual([
      { containerPort: 80, protocol: "tcp", hostIp: "0.0.0.0", hostPort: 8080 },
    ]);
  });
});

describe("containerNetworks", () => {
  it("reads the container's attached network names", () => {
    expect(containerNetworks({ Networks: ["myapp_default", "dev-net"] } as any)).toEqual(["myapp_default", "dev-net"]);
  });

  it("is empty when the engine reports no networks", () => {
    expect(containerNetworks({} as any)).toEqual([]);
  });
});
