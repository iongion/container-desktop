import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostContext } from "@/container-client/runtimes/composition";
import { containerDialect } from "@/container-client/runtimes/dialects/container";
import { availableOnAppleContainer } from "@/container-client/runtimes/profiles/container";
import { OperatingSystem } from "@/container-client/types/os";

describe("availableOnAppleContainer — Apple silicon on macOS 26 or later", () => {
  const host = (osType: OperatingSystem) => ({ osType }) as unknown as HostContext;
  const darwin = globalThis.CURRENT_DARWIN_MAJOR;

  afterEach(() => {
    globalThis.CURRENT_DARWIN_MAJOR = darwin;
    vi.restoreAllMocks();
  });

  it("macOS 26 (Darwin 25) on arm64 → available", async () => {
    globalThis.CURRENT_DARWIN_MAJOR = 25;
    vi.spyOn(globalThis.Platform, "getOsArch").mockResolvedValue("arm64");
    expect((await availableOnAppleContainer(host(OperatingSystem.MacOS))).success).toBe(true);
  });

  // socktainer, the only API Apple Container has, needs macOS 26; Apple itself no longer fixes macOS 15 issues.
  it("macOS 15 (Darwin 24) → unavailable, naming the macOS it needs", async () => {
    globalThis.CURRENT_DARWIN_MAJOR = 24;
    vi.spyOn(globalThis.Platform, "getOsArch").mockResolvedValue("arm64");
    const result = await availableOnAppleContainer(host(OperatingSystem.MacOS));
    expect(result.success).toBe(false);
    expect(result.details).toContain("macOS 26");
  });

  it("macOS on Intel → unavailable", async () => {
    globalThis.CURRENT_DARWIN_MAJOR = 25;
    vi.spyOn(globalThis.Platform, "getOsArch").mockResolvedValue("x64");
    expect((await availableOnAppleContainer(host(OperatingSystem.MacOS))).success).toBe(false);
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

// The app starts Apple's side itself: Apple's service first, by the connection's own `container`, without the kernel
// prompt a GUI cannot answer; then socktainer, supervised for as long as the app runs, never auto-starting a service.
describe("containerDialect.buildService — Apple's service, then socktainer", () => {
  const settings = { program: { name: "container", path: "/usr/local/bin/container" } } as never;

  it("prepares Apple's service and runs socktainer as the service", async () => {
    const host = {
      findHostProgram: async () => ({ name: "socktainer", path: "/opt/socktainer/bin/socktainer", version: "1.6.1" }),
    } as unknown as HostContext;
    expect(await containerDialect.buildService(host, settings, "/Users/me/.socktainer/container.sock", "warn")).toEqual(
      {
        prepare: { args: ["system", "start", "--enable-kernel-install"] },
        program: "/opt/socktainer/bin/socktainer",
        args: ["--no-auto-start"],
      },
    );
  });

  it("names nothing to start when socktainer is not installed", async () => {
    const host = {
      findHostProgram: async () => ({ name: "socktainer", path: "" }),
    } as unknown as HostContext;
    expect(await containerDialect.buildService(host, settings, "/Users/me/.socktainer/container.sock", "warn")).toBe(
      null,
    );
  });
});
