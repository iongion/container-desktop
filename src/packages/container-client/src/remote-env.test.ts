import { afterEach, describe, expect, it } from "vitest";
import { ContainerEngine, ContainerEngineHost } from "@/container-client/types/engine";
import { OperatingSystem } from "@/container-client/types/os";
import {
  buildRemoteConnectionsFromEnv,
  parseRemoteConnectionsEnv,
  type RemoteEnvConnection,
  resolveRemoteEnvConnections,
} from "./remote-env";

const ENV: Record<string, string> = {
  CONTAINER_DESKTOP_REMOTE_MAC_ENGINE: "podman, docker, container",
  CONTAINER_DESKTOP_REMOTE_MAC_SSH_HOST: "my-mac",
  CONTAINER_DESKTOP_REMOTE_MAC_SSH_PORT: "2222",
  CONTAINER_DESKTOP_REMOTE_MAC_SSH_USER: "ion",
  CONTAINER_DESKTOP_REMOTE_MAC_SSH_KEY: "~/.ssh/id_ed25519",
  CONTAINER_DESKTOP_REMOTE_MAC_PODMAN_SOCKET: "/run/user/501/podman/podman.sock",
  CONTAINER_DESKTOP_REMOTE_MAC_DOCKER_SOCKET: "/var/run/docker.sock",
  CONTAINER_DESKTOP_REMOTE_MAC_APPLE_SOCKET: "/Users/ion/.socktainer/container.sock",
  CONTAINER_DESKTOP_REMOTE_MAC_LABEL: "My Mac",
  CONTAINER_DESKTOP_REMOTE_LINUX_ENGINE: "podman",
  CONTAINER_DESKTOP_REMOTE_LINUX_SSH_HOST: "linux",
  CONTAINER_DESKTOP_REMOTE_LINUX_SSH_USER: "ion",
  CONTAINER_DESKTOP_REMOTE_LINUX_SSH_KEY: "~/.ssh/id_ed25519",
  CONTAINER_DESKTOP_REMOTE_LINUX_AUTOSTART: "true",
  IGNORED_KEY: "x",
};

describe("parseRemoteConnectionsEnv", () => {
  it("parses entries keyed by lowercased id (sorted), ignoring non-prefixed keys", () => {
    expect(parseRemoteConnectionsEnv(ENV).map((e) => e.id)).toEqual(["linux", "mac"]);
    expect(parseRemoteConnectionsEnv({ IGNORED_KEY: "x" })).toEqual([]);
  });

  it("maps every field including comma engines, ssh, per-engine sockets and label", () => {
    const mac = parseRemoteConnectionsEnv(ENV).find((e) => e.id === "mac")!;
    expect(mac.engines).toEqual([ContainerEngine.PODMAN, ContainerEngine.DOCKER, ContainerEngine.APPLE]);
    expect(mac.sshHost).toBe("my-mac");
    expect(mac.sshPort).toBe(2222);
    expect(mac.sshUser).toBe("ion");
    expect(mac.sshKey).toBe("~/.ssh/id_ed25519");
    expect(mac.sockets.podman).toBe("/run/user/501/podman/podman.sock");
    expect(mac.sockets.docker).toBe("/var/run/docker.sock");
    expect(mac.sockets.container).toBe("/Users/ion/.socktainer/container.sock");
    expect(mac.label).toBe("My Mac");
  });

  it("defaults port to 22 and autoStart to false, and honours AUTOSTART=true", () => {
    const targets = parseRemoteConnectionsEnv(ENV);
    const mac = targets.find((e) => e.id === "mac")!;
    const linux = targets.find((e) => e.id === "linux")!;
    expect(mac.autoStart).toBe(false);
    expect(linux.sshPort).toBe(22);
    expect(linux.autoStart).toBe(true);
  });

  it("skips an entry that has no SSH_HOST", () => {
    const env = {
      CONTAINER_DESKTOP_REMOTE_NOHOST_ENGINE: "podman",
      CONTAINER_DESKTOP_REMOTE_NOHOST_SSH_USER: "ion",
    };
    expect(parseRemoteConnectionsEnv(env)).toEqual([]);
  });

  it("drops unknown engine tokens and skips an entry left with no valid engine", () => {
    const env = {
      CONTAINER_DESKTOP_REMOTE_A_ENGINE: "podman, bogus",
      CONTAINER_DESKTOP_REMOTE_A_SSH_HOST: "a",
      CONTAINER_DESKTOP_REMOTE_B_ENGINE: "bogus",
      CONTAINER_DESKTOP_REMOTE_B_SSH_HOST: "b",
    };
    const parsed = parseRemoteConnectionsEnv(env);
    expect(parsed.map((e) => e.id)).toEqual(["a"]);
    expect(parsed[0].engines).toEqual([ContainerEngine.PODMAN]);
  });

  it("keeps underscores that belong to the id", () => {
    const env = {
      CONTAINER_DESKTOP_REMOTE_MY_MAC_ENGINE: "docker",
      CONTAINER_DESKTOP_REMOTE_MY_MAC_SSH_HOST: "my-mac",
    };
    expect(parseRemoteConnectionsEnv(env).map((e) => e.id)).toEqual(["my_mac"]);
  });
});

const MAC: RemoteEnvConnection = {
  id: "mac",
  engines: [ContainerEngine.PODMAN, ContainerEngine.DOCKER, ContainerEngine.APPLE],
  sshHost: "my-mac",
  sshPort: 22,
  sshUser: "ion",
  sshKey: "~/.ssh/id_ed25519",
  sockets: {
    podman: "/run/user/501/podman/podman.sock",
    docker: "/var/run/docker.sock",
    container: "/Users/ion/.socktainer/container.sock",
  },
  autoStart: true,
  label: "My Mac",
};

describe("buildRemoteConnectionsFromEnv", () => {
  it("builds one readonly remote connection per (entry, engine)", () => {
    const built = buildRemoteConnectionsFromEnv([MAC], OperatingSystem.Linux);
    expect(built.map((c) => c.id)).toEqual([
      "system-env.mac.podman",
      "system-env.mac.docker",
      "system-env.mac.container",
    ]);
    expect(built.every((c) => c.readonly)).toBe(true);
    expect(built.map((c) => c.host)).toEqual([
      ContainerEngineHost.PODMAN_REMOTE,
      ContainerEngineHost.DOCKER_REMOTE,
      ContainerEngineHost.APPLE_REMOTE,
    ]);
  });

  it("sets scope to the ssh host, the per-engine socket as the relay, autoStart, and leaves uri empty", () => {
    const [podman, docker, container] = buildRemoteConnectionsFromEnv([MAC], OperatingSystem.Linux);
    expect(podman.engine).toBe(ContainerEngine.PODMAN);
    expect(podman.settings.mode).toBe("mode.automatic");
    expect(podman.settings.controller?.scope).toBe("my-mac");
    expect(podman.settings.api.connection.relay).toBe("/run/user/501/podman/podman.sock");
    expect(podman.settings.api.connection.uri).toBe("");
    expect(podman.settings.api.autoStart).toBe(true);
    expect(docker.engine).toBe(ContainerEngine.DOCKER);
    expect(docker.settings.api.connection.relay).toBe("/var/run/docker.sock");
    expect(container.engine).toBe(ContainerEngine.APPLE);
    expect(container.host).toBe(ContainerEngineHost.APPLE_REMOTE);
    expect(container.settings.program.name).toBe("container");
    expect(container.settings.controller?.scope).toBe("my-mac");
    expect(container.settings.api.baseURL).toBe("http://localhost");
    expect(container.settings.api.connection.relay).toBe("/Users/ion/.socktainer/container.sock");
  });

  it("names from the label when present, else from the ssh host; empty relay when no socket given", () => {
    const [named] = buildRemoteConnectionsFromEnv([MAC], OperatingSystem.Linux);
    expect(named.name).toBe("My Mac (podman)");

    const bare: RemoteEnvConnection = {
      ...MAC,
      id: "box",
      label: undefined,
      sockets: {},
      engines: [ContainerEngine.PODMAN],
    };
    const [unnamed] = buildRemoteConnectionsFromEnv([bare], OperatingSystem.Linux);
    expect(unnamed.name).toBe("my-mac (podman)");
    expect(unnamed.settings.api.connection.relay).toBe("");
  });

  it("returns nothing for an empty list", () => {
    expect(buildRemoteConnectionsFromEnv([], OperatingSystem.Linux)).toEqual([]);
  });
});

describe("resolveRemoteEnvConnections", () => {
  const g = globalThis as unknown as { CONTAINER_DESKTOP_REMOTE_CONNECTIONS?: string };
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("CONTAINER_DESKTOP_REMOTE_")) {
        delete process.env[key];
      }
    }
    g.CONTAINER_DESKTOP_REMOTE_CONNECTIONS = undefined;
  });

  it("parses from process.env when remote keys are present (main / node)", () => {
    process.env.CONTAINER_DESKTOP_REMOTE_T_ENGINE = "podman";
    process.env.CONTAINER_DESKTOP_REMOTE_T_SSH_HOST = "tbox";
    expect(resolveRemoteEnvConnections().map((e) => e.id)).toEqual(["t"]);
  });

  it("falls back to the preload-exposed JSON global when process.env has none (renderer)", () => {
    g.CONTAINER_DESKTOP_REMOTE_CONNECTIONS = JSON.stringify([
      {
        id: "x",
        engines: ["podman"],
        sshHost: "x",
        sshPort: 22,
        sshUser: "",
        sshKey: "",
        sockets: {},
        autoStart: true,
      },
    ]);
    expect(resolveRemoteEnvConnections().map((e) => e.id)).toEqual(["x"]);
  });

  it("returns [] when nothing is configured and [] for malformed exposed JSON", () => {
    expect(resolveRemoteEnvConnections()).toEqual([]);
    g.CONTAINER_DESKTOP_REMOTE_CONNECTIONS = "{not json";
    expect(resolveRemoteEnvConnections()).toEqual([]);
  });
});
