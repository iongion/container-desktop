import { describe, expect, it } from "vitest";

import {
  buildPodmanMachineDialStdioCommand,
  parsePodmanMachineSSHConnection,
  resolvePodmanMachineBridge,
} from "./podman-machine-ssh";

// Exact shape of `podman system connection list --format json` on a Windows host with a running WSL machine
// (captured live). Podman marks the rootful `-root` connection Default, but the app targets rootless podman, so
// the selectors must pick the rootless `podman-machine-default` on the in-VM rootless socket.
const WINDOWS_IDENTITY = "C:\\Users\\istoica\\.local\\share\\containers\\podman\\machine\\machine";
const windowsConnectionList = JSON.stringify([
  {
    Name: "podman-machine-default",
    URI: "ssh://user@127.0.0.1:56515/run/user/1000/podman/podman.sock",
    Identity: WINDOWS_IDENTITY,
    IsMachine: true,
    Default: false,
    ReadWrite: true,
  },
  {
    Name: "podman-machine-default-root",
    URI: "ssh://root@127.0.0.1:56515/run/podman/podman.sock",
    Identity: WINDOWS_IDENTITY,
    IsMachine: true,
    Default: true,
    ReadWrite: true,
  },
]);

describe("parsePodmanMachineSSHConnection", () => {
  it("picks the ROOTLESS machine connection even when the rootful -root is Default", () => {
    const conn = parsePodmanMachineSSHConnection(windowsConnectionList);
    expect(conn).toEqual({
      user: "user",
      host: "127.0.0.1",
      port: 56515,
      socket: "/run/user/1000/podman/podman.sock",
      identity: WINDOWS_IDENTITY,
    });
  });

  it("falls back to the first machine connection when none is marked Default", () => {
    const list = JSON.stringify([
      {
        Name: "podman-machine-default",
        URI: "ssh://user@127.0.0.1:56515/run/user/1000/podman/podman.sock",
        Identity: WINDOWS_IDENTITY,
        IsMachine: true,
        Default: false,
      },
    ]);
    expect(parsePodmanMachineSSHConnection(list)?.user).toBe("user");
  });

  it("ignores non-machine connections (a native remote podman, reachable by ssh -NL)", () => {
    const list = JSON.stringify([
      {
        Name: "remote-linux",
        URI: "ssh://podman@build-box:22/run/user/1000/podman/podman.sock",
        Identity: "/home/me/.ssh/id_ed25519",
        IsMachine: false,
        Default: true,
      },
    ]);
    expect(parsePodmanMachineSSHConnection(list)).toBeUndefined();
  });

  it("returns undefined for an entry without an identity, empty list, or invalid JSON", () => {
    expect(
      parsePodmanMachineSSHConnection(
        JSON.stringify([{ Name: "x", URI: "ssh://root@127.0.0.1:56515/s.sock", IsMachine: true }]),
      ),
    ).toBeUndefined();
    expect(parsePodmanMachineSSHConnection("[]")).toBeUndefined();
    expect(parsePodmanMachineSSHConnection("not json")).toBeUndefined();
  });
});

describe("buildPodmanMachineDialStdioCommand", () => {
  it("nests OpenSSH into the machine and runs the VM's local podman dial-stdio (identity quoted)", () => {
    const command = buildPodmanMachineDialStdioCommand({
      user: "root",
      host: "127.0.0.1",
      port: 56515,
      socket: "/run/podman/podman.sock",
      identity: WINDOWS_IDENTITY,
    });
    expect(command).toEqual([
      "ssh",
      "-i",
      `"${WINDOWS_IDENTITY}"`,
      "-p",
      "56515",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "BatchMode=yes",
      "root@127.0.0.1",
      "podman",
      "system",
      "dial-stdio",
    ]);
  });
});

describe("resolvePodmanMachineBridge", () => {
  it("produces a stable relay id (the machine URI) plus the nested dial-stdio command", () => {
    const bridge = resolvePodmanMachineBridge(windowsConnectionList);
    expect(bridge?.relay).toBe("ssh://user@127.0.0.1:56515/run/user/1000/podman/podman.sock");
    expect(bridge?.command[0]).toBe("ssh");
    expect(bridge?.command).toContain("dial-stdio");
    expect(bridge?.command).toContain("user@127.0.0.1");
  });

  it("returns undefined when there is no machine to bridge", () => {
    expect(resolvePodmanMachineBridge("[]")).toBeUndefined();
  });
});
