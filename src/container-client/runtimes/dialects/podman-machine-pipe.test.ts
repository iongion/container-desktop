import { describe, expect, it } from "vitest";

import { isWindowsNamedPipe, parsePodmanMachineNamedPipe } from "./podman-machine-pipe";

// `podman system connection list --format json` on a Windows host whose machine exposes a NATIVE named pipe
// (newer Podman). Rootful machine → the Default connection is the `-root` pipe. This is the case we want to
// favor: the pipe is dialable directly from a native Windows process, no relay/SSH/dial-stdio needed.
const WINDOWS_PIPE_LIST = [
  {
    Name: "podman-machine-default",
    URI: "npipe:////./pipe/podman-machine-default",
    IsMachine: true,
    Default: false,
  },
  {
    Name: "podman-machine-default-root",
    URI: "npipe:////./pipe/podman-machine-default-root",
    IsMachine: true,
    Default: true,
  },
];

// Older WSL provider: the machine is reached over ssh into the VM — there is NO named pipe to favor.
const WINDOWS_SSH_LIST = [
  {
    Name: "podman-machine-default",
    URI: "ssh://user@127.0.0.1:56515/run/user/1000/podman/podman.sock",
    IsMachine: true,
    Default: true,
  },
];

describe("parsePodmanMachineNamedPipe", () => {
  it("returns the Default machine's pipe path (rootful → the -root pipe)", () => {
    expect(parsePodmanMachineNamedPipe(WINDOWS_PIPE_LIST)).toBe("\\\\.\\pipe\\podman-machine-default-root");
  });

  it("falls back to the first machine pipe when none is marked Default", () => {
    const list = [{ Name: "podman-machine-default", URI: "npipe:////./pipe/podman-machine-default", IsMachine: true }];
    expect(parsePodmanMachineNamedPipe(list)).toBe("\\\\.\\pipe\\podman-machine-default");
  });

  it("returns undefined for an ssh-only machine (no native pipe to favor)", () => {
    expect(parsePodmanMachineNamedPipe(WINDOWS_SSH_LIST)).toBeUndefined();
  });

  it("ignores non-machine npipe connections", () => {
    const list = [{ Name: "extra", URI: "npipe:////./pipe/some-other", IsMachine: false, Default: true }];
    expect(parsePodmanMachineNamedPipe(list)).toBeUndefined();
  });

  it("returns undefined for an empty list or non-array input", () => {
    expect(parsePodmanMachineNamedPipe([])).toBeUndefined();
    expect(parsePodmanMachineNamedPipe(undefined)).toBeUndefined();
    expect(parsePodmanMachineNamedPipe("not an array")).toBeUndefined();
  });
});

describe("isWindowsNamedPipe", () => {
  it("recognises a \\\\.\\pipe\\ path", () => {
    expect(isWindowsNamedPipe("\\\\.\\pipe\\podman-machine-default")).toBe(true);
  });

  it("recognises an npipe:// URI and its //./pipe/ variant", () => {
    expect(isWindowsNamedPipe("npipe:////./pipe/podman-machine-default")).toBe(true);
    expect(isWindowsNamedPipe("//./pipe/podman-machine-default")).toBe(true);
  });

  it("rejects unix sockets, ssh URIs and empty values", () => {
    expect(isWindowsNamedPipe("/run/user/1000/podman/podman.sock")).toBe(false);
    expect(isWindowsNamedPipe("unix:///run/user/1000/podman/podman.sock")).toBe(false);
    expect(isWindowsNamedPipe("ssh://root@127.0.0.1:56515/run/podman/podman.sock")).toBe(false);
    expect(isWindowsNamedPipe("")).toBe(false);
    expect(isWindowsNamedPipe(undefined)).toBe(false);
  });
});
