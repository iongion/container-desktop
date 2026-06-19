import { describe, expect, it, vi } from "vitest";

import { OperatingSystem } from "@/env/Types";
import type { HostContext } from "../composition";
import { containerDialect } from "../dialects/container";
import type { CapabilityDescriptor } from "../facade";
import {
  appleNetworksEnabled,
  availableOnAppleContainer,
  gateNetworksForMacOS,
  parseMacOsProductMajor,
} from "./container";

const BASE: CapabilityDescriptor = {
  resources: { pods: false, secrets: false, networks: true },
  events: true,
  sort: {},
  extensions: {
    machines: false,
    kube: false,
    contexts: false,
    swarm: false,
    builders: false,
    compose: false,
    registries: false,
    controllerVersion: false,
  },
};

describe("appleNetworksEnabled — macOS-version networks gate", () => {
  it("macOS 15 (Darwin 24) → networks off (degraded, no `container network`)", () => {
    expect(appleNetworksEnabled(OperatingSystem.MacOS, 24)).toBe(false);
  });
  it("macOS 26 (Darwin 25) → networks on", () => {
    expect(appleNetworksEnabled(OperatingSystem.MacOS, 25)).toBe(true);
  });
  it("non-macOS host → networks on (engine unavailable anyway, don't over-restrict)", () => {
    expect(appleNetworksEnabled(OperatingSystem.Linux, 24)).toBe(true);
  });
  it("unknown Darwin major → networks on (no guess)", () => {
    expect(appleNetworksEnabled(OperatingSystem.MacOS, undefined)).toBe(true);
  });
});

describe("gateNetworksForMacOS — returns a COPY, never mutates the shared base", () => {
  it("macOS 15 → copy has networks:false and the base singleton stays untouched", () => {
    const gated = gateNetworksForMacOS(BASE, OperatingSystem.MacOS, 24);
    expect(gated.resources.networks).toBe(false);
    expect(gated).not.toBe(BASE);
    expect(gated.resources).not.toBe(BASE.resources);
    expect(BASE.resources.networks).toBe(true);
  });
});

describe("parseMacOsProductMajor", () => {
  it("parses sw_vers product versions", () => {
    expect(parseMacOsProductMajor("26.0")).toBe(26);
    expect(parseMacOsProductMajor("15.5")).toBe(15);
  });
  it("undefined on unparseable input", () => {
    expect(parseMacOsProductMajor("not-a-version")).toBeUndefined();
  });
});

describe("availableOnAppleContainer — Apple silicon + macOS gate", () => {
  const host = (osType: OperatingSystem) => ({ osType }) as unknown as HostContext;

  it("macOS + arm64 → available", async () => {
    const spy = vi.spyOn(globalThis.Platform, "getOsArch").mockResolvedValue("arm64");
    expect((await availableOnAppleContainer(host(OperatingSystem.MacOS))).success).toBe(true);
    spy.mockRestore();
  });
  it("macOS + x64 (Intel) → unavailable", async () => {
    const spy = vi.spyOn(globalThis.Platform, "getOsArch").mockResolvedValue("x64");
    expect((await availableOnAppleContainer(host(OperatingSystem.MacOS))).success).toBe(false);
    spy.mockRestore();
  });
  it("non-macOS → unavailable", async () => {
    expect((await availableOnAppleContainer(host(OperatingSystem.Linux))).success).toBe(false);
  });
});

describe("containerDialect.readEngineSocket — socket safety (never honors raw DOCKER_HOST)", () => {
  it("resolves the socktainer socket path, ignoring a DOCKER_HOST pointing at a non-Apple daemon", async () => {
    const prev = process.env.DOCKER_HOST;
    process.env.DOCKER_HOST = "tcp://bogus-docker-desktop:2375";
    try {
      const host = {
        isScoped: () => false,
        getSettings: async () => ({}),
        logger: { warn() {}, error() {}, debug() {}, info() {} },
      } as unknown as HostContext;
      const socket = await containerDialect.readEngineSocket(host, {} as never);
      expect(socket).toMatch(/\.socktainer\/container\.sock$/);
      expect(socket).not.toContain("bogus-docker-desktop");
    } finally {
      if (prev === undefined) {
        delete process.env.DOCKER_HOST;
      } else {
        process.env.DOCKER_HOST = prev;
      }
    }
  });
});
