import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostContext } from "@/container-client/runtimes/composition";
import { containerDialect, parseAppleSystemStatus } from "@/container-client/runtimes/dialects/container";
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

// The user's own socktainer (the one the app starts) is at ~/.socktainer; Homebrew's service runs socktainer with its
// own HOME, so its socket is under the Homebrew prefix. A present socket wins; with none, the app's own place.
describe("containerDialect.readEngineSocket — the user's socket, else Homebrew's service", () => {
  const OWN = "/Users/me/.socktainer/container.sock";
  const BREW = "/opt/homebrew/var/run/socktainer/.socktainer/container.sock";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const nativeHost = (present: string[]) => {
    vi.spyOn(globalThis.Platform, "getHomeDir").mockResolvedValue("/Users/me");
    vi.spyOn(globalThis.FS, "isFilePresent").mockImplementation(async (path: string) => present.includes(path));
    return { isScoped: () => false } as unknown as HostContext;
  };

  it("uses the user's socket when it is there, even beside Homebrew's", async () => {
    expect(await containerDialect.readEngineSocket(nativeHost([OWN, BREW]), {} as never)).toBe(OWN);
  });

  it("uses Homebrew's service socket when only that one is there", async () => {
    expect(await containerDialect.readEngineSocket(nativeHost([BREW]), {} as never)).toBe(BREW);
  });

  it("names the user's socket when none is there, where the app starts socktainer", async () => {
    expect(await containerDialect.readEngineSocket(nativeHost([]), {} as never)).toBe(OWN);
  });

  it("checks the remote Mac's sockets over the SSH scope", async () => {
    const runScopeCommand = vi.fn(async (program: string, args: string[]) => {
      if (program === "printenv") {
        return result("/Users/remote\n", 0);
      }
      const present = program === "test" && args[1] === BREW;
      return result("", present ? 0 : 1);
    });
    const host = { isScoped: () => true, runScopeCommand } as unknown as HostContext;
    const settings = { controller: { scope: "mac" } } as never;
    expect(await containerDialect.readEngineSocket(host, settings)).toBe(BREW);
    expect(runScopeCommand).toHaveBeenCalledWith(
      "test",
      ["-S", "/Users/remote/.socktainer/container.sock"],
      "mac",
      settings,
    );
  });
});

// `container system status --format json`, as Apple's 1.7.1 CLI prints it (Sources/ContainerCommands/System/SystemStatus.swift).
const RUNNING_STATUS = JSON.stringify({
  status: "running",
  client: { version: "1.7.1", build: "release", commit: "abc", appName: "container" },
  server: { version: "1.7.1", build: "release", commit: "abc", appName: "container-apiserver" },
  paths: { appRoot: "/Users/me/Library/Application Support/com.apple.container", installRoot: "/usr/local" },
});
const result = (stdout: string, code: number) => ({ pid: 1, code, success: code === 0, stdout, stderr: "" });

describe("parseAppleSystemStatus — the state Apple's CLI reports", () => {
  it("reads a running service with the CLI and server versions", () => {
    expect(parseAppleSystemStatus(RUNNING_STATUS)).toEqual({
      status: "running",
      clientVersion: "1.7.1",
      serverVersion: "1.7.1",
    });
  });

  it("reads a stopped service, which prints only its status", () => {
    expect(parseAppleSystemStatus('{"status":"unregistered"}\n')).toEqual({ status: "unregistered" });
    expect(parseAppleSystemStatus('{"status":"not running"}')).toEqual({ status: "not running" });
  });

  it("is undefined when the CLI printed no status", () => {
    expect(parseAppleSystemStatus("")).toBeUndefined();
    expect(parseAppleSystemStatus("zsh: command not found: container")).toBeUndefined();
    expect(parseAppleSystemStatus('{"other":1}')).toBeUndefined();
  });
});

// The app starts Apple's side itself: Apple's service first, by the connection's own `container`, without the kernel
// prompt a GUI cannot answer, and only when it is not running already; then socktainer, supervised for as long as the
// app runs, never auto-starting a service.
describe("containerDialect.buildService — Apple's service, then socktainer", () => {
  const settings = { program: { name: "container", path: "/usr/local/bin/container" } } as never;
  const socket = "/Users/me/.socktainer/container.sock";
  const hostWith = (status: { stdout: string; code: number }, socktainerPath = "/opt/socktainer/bin/socktainer") => {
    const runHostCommand = vi.fn(async () => result(status.stdout, status.code));
    const host = {
      isScoped: () => false,
      runHostCommand,
      findHostProgram: async () => ({ name: "socktainer", path: socktainerPath, version: "1.6.1" }),
    } as unknown as HostContext;
    return { host, runHostCommand };
  };

  it("starts Apple's service first when it is not running, then runs socktainer as the service", async () => {
    const { host, runHostCommand } = hostWith({ stdout: '{"status":"unregistered"}', code: 1 });
    expect(await containerDialect.buildService(host, settings, socket, "warn")).toEqual({
      prepare: { args: ["system", "start", "--enable-kernel-install"] },
      program: "/opt/socktainer/bin/socktainer",
      args: ["--no-auto-start"],
    });
    expect(runHostCommand).toHaveBeenCalledWith(
      "/usr/local/bin/container",
      ["system", "status", "--format", "json"],
      settings,
    );
  });

  it("only runs socktainer when Apple's service is already running", async () => {
    const { host } = hostWith({ stdout: RUNNING_STATUS, code: 0 });
    expect(await containerDialect.buildService(host, settings, socket, "warn")).toEqual({
      program: "/opt/socktainer/bin/socktainer",
      args: ["--no-auto-start"],
    });
  });

  it("names nothing to start when socktainer is not installed", async () => {
    const { host } = hostWith({ stdout: RUNNING_STATUS, code: 0 }, "");
    expect(await containerDialect.buildService(host, settings, socket, "warn")).toBe(null);
  });
});

// The availability line says what the live socket serves, or, when it does not answer, which part is down and how to
// fix it. No PATH lookup: a socktainer on PATH says nothing about the one serving the socket.
describe("containerDialect.describeApiBridge — the live bridge, or the state and its fix", () => {
  const settingsFor = (cliVersion = "1.7.1") =>
    ({ program: { name: "container", path: "/usr/local/bin/container", version: cliVersion } }) as never;
  const answering = {
    request: async ({ url }: { url: string }) => {
      if (url === "/version") {
        return { data: { Version: "1.6.1", Components: [{ Name: "socktainer", Version: "1.6.1" }] } };
      }
      return { data: { ServerVersion: "1.7.1" } };
    },
  };
  const silent = {
    request: async () => {
      throw new Error("connect ENOENT /Users/me/.socktainer/container.sock");
    },
  };
  const hostWith = (driver: unknown, status?: { stdout: string; code: number }) =>
    ({
      isScoped: () => false,
      getApiDriver: async () => driver,
      runHostCommand: async () => result(status?.stdout ?? "", status?.code ?? 127),
    }) as unknown as HostContext;

  it("names socktainer and the running service versions when the socket answers", async () => {
    expect(await containerDialect.describeApiBridge?.(hostWith(answering), settingsFor())).toBe(
      "socktainer 1.6.1 · container 1.7.1",
    );
  });

  it("says how to restart the service when the CLI is newer than the running service", async () => {
    const note = await containerDialect.describeApiBridge?.(hostWith(answering), settingsFor("1.8.0"));
    expect(note).toContain("socktainer 1.6.1 · container 1.7.1");
    expect(note).toContain("the container CLI is 1.8.0");
    expect(note).toContain("container system stop");
  });

  it("names Apple's stopped service and its fix when the socket is silent", async () => {
    const note = await containerDialect.describeApiBridge?.(
      hostWith(silent, { stdout: '{"status":"unregistered"}', code: 1 }),
      settingsFor(),
    );
    expect(note).toContain("Apple's container service is not started");
    expect(note).toContain("container system start");
  });

  it("names a registered service that does not answer, and its fix", async () => {
    const note = await containerDialect.describeApiBridge?.(
      hostWith(silent, { stdout: '{"status":"not running"}', code: 1 }),
      settingsFor(),
    );
    expect(note).toContain("Apple's container service is not answering");
    expect(note).toContain("container system stop");
  });

  it("names socktainer as the part that is down when Apple's service runs", async () => {
    const note = await containerDialect.describeApiBridge?.(
      hostWith(silent, { stdout: RUNNING_STATUS, code: 0 }),
      settingsFor(),
    );
    expect(note).toContain("socktainer is not running");
  });

  it("adds nothing when neither the socket nor the CLI answers", async () => {
    expect(await containerDialect.describeApiBridge?.(hostWith(silent), settingsFor())).toBeUndefined();
  });
});

// Apple's `machine list` has no start time; a running machine's Last up comes from its `inspect`, a stopped one's stays
// empty (the screen shows "-").
describe("containerDialect machines — Last up of a running Apple machine", () => {
  it("reads the start time of each running machine from its inspect", async () => {
    const list = JSON.stringify([
      { id: "dev", status: "running", cpus: 2, memory: 1, diskSize: 1, createdDate: "2026-11-27T10:00:00Z" },
      { id: "old", status: "stopped", cpus: 1, memory: 1, diskSize: 1, createdDate: "2026-11-20T10:00:00Z" },
    ]);
    const inspect = JSON.stringify([{ id: "dev", status: "running", startedDate: "2026-11-27T10:05:00Z" }]);
    const runHostCommand = vi.fn(async (_program: string, args: string[]) =>
      result(args[1] === "list" ? list : args[1] === "inspect" && args[2] === "dev" ? inspect : "[]", 0),
    );
    const host = {
      isScoped: () => false,
      runHostCommand,
      getSettings: async () => ({ program: { name: "container", path: "/usr/local/bin/container" } }),
    } as unknown as HostContext;

    const machines = await containerDialect.bindExtensions(host).getPodmanMachines();

    expect(machines.map((machine) => [machine.Name, machine.LastUp])).toEqual([
      ["dev", "2026-11-27T10:05:00Z"],
      ["old", ""],
    ]);
    expect(runHostCommand).not.toHaveBeenCalledWith(
      expect.anything(),
      ["machine", "inspect", "old"],
      expect.anything(),
    );
  });
});
