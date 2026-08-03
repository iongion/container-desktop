import { describe, expect, it } from "vitest";

import { getWindowsPipeName, getWindowsPipePath, isWindowsNamedPipe } from "@/utils";

// These two moved here from container-client's podman-machine-pipe dialect, because the platform hosts need
// the same rule: `isFilePresent` must NOT open a named pipe to find out whether it is there. Opening a pipe
// makes you a CLIENT of it — measured against a live Docker Desktop on Windows 11, `fs.existsSync` returns
// false for EVERY named pipe (libuv's stat opens the path and gets EBUSY), and the open consumes one of the
// server's instances. The hosts route a pipe address to an enumeration of `\\.\pipe\` instead, and this is
// the rule that decides which addresses are routed that way.

describe("isWindowsNamedPipe", () => {
  it("accepts every spelling the app passes around", () => {
    expect(isWindowsNamedPipe("\\\\.\\pipe\\podman-machine-default")).toBe(true);
    expect(isWindowsNamedPipe("npipe:////./pipe/podman-machine-default")).toBe(true);
    expect(isWindowsNamedPipe("//./pipe/podman-machine-default")).toBe(true);
    expect(isWindowsNamedPipe("\\\\?\\pipe\\docker_engine")).toBe(true);
  });

  it("rejects sockets, ssh URIs and nothing at all", () => {
    expect(isWindowsNamedPipe("/run/user/1000/podman/podman.sock")).toBe(false);
    expect(isWindowsNamedPipe("unix:///run/user/1000/podman/podman.sock")).toBe(false);
    expect(isWindowsNamedPipe("ssh://root@127.0.0.1:56515/run/podman/podman.sock")).toBe(false);
    expect(isWindowsNamedPipe("")).toBe(false);
    expect(isWindowsNamedPipe(undefined)).toBe(false);
  });
});

describe("getWindowsPipeName", () => {
  it("reads the pipe's own name out of any spelling", () => {
    expect(getWindowsPipeName(getWindowsPipePath("dockerDesktopLinuxEngine", true))).toBe("dockerDesktopLinuxEngine");
    expect(getWindowsPipeName("npipe:////./pipe/podman-machine-default")).toBe("podman-machine-default");
    expect(getWindowsPipeName("//./pipe/docker_engine/")).toBe("docker_engine");
  });

  // The case that separates a strict rule from a loose one. A bare last-segment-after-`pipe` regexp
  // answers "socket" here, and a host that believed it would look for a NAMED PIPE called `socket` and
  // report a directory that plainly exists as absent.
  it("is not fooled by a POSIX path containing a pipe directory", () => {
    expect(getWindowsPipeName("/home/me/pipe/socket")).toBeUndefined();
    expect(getWindowsPipeName("/run/podman/podman.sock")).toBeUndefined();
  });

  it("has no name to give for a pipe address that carries none", () => {
    expect(getWindowsPipeName("\\\\.\\pipe\\")).toBeUndefined();
    expect(getWindowsPipeName("")).toBeUndefined();
  });
});
