import { describe, expect, it, vi } from "vitest";

import {
  machineAddressArgv,
  machineAddressFrom,
  machineListArgv,
  resolveMachineAddress,
  unrelayedMachineFrom,
} from "@/container-client/runtimes/publishedPortHost";

// podman on Windows runs its engine inside a WSL machine, and that machine is a network realm of its own: a port
// published there does not appear on the Windows host at all. Measured on a real one — `netstat` on the host finds
// nothing, at either bind address — so the `ssh -NL` that reaches a remote engine's loopback lands one hop short of
// the container. What the host CAN reach is the machine's own address, which is what these answers are for.

// A real `podman machine list --format json`, as a Windows host answers it, with one fact at a time varied.
function machineList(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify([
    {
      Name: "podman-machine-default",
      Default: false,
      Running: true,
      Starting: false,
      VMType: "wsl",
      Port: 54069,
      RemoteUsername: "user",
      UserModeNetworking: false,
      ...overrides,
    },
  ]);
}

const WSL_MACHINE = machineList();

// What the probe prints, from a container sharing the machine's own network namespace.
const ROUTE = "172.24.186.248\n";
const IMAGE = "container-desktop/pi-agent:6.0.0";

describe("unrelayedMachineFrom", () => {
  it("names the machine whose published ports stop at its own network", () => {
    expect(unrelayedMachineFrom(WSL_MACHINE)).toBe("podman-machine-default");
  });

  // `--user-mode-networking` IS podman's own relay: with it on, gvproxy carries a published port out to the machine's
  // host, so the port answers where the app already dials and a hop would send it somewhere nothing is listening.
  it("says nothing about a machine that relays its own ports", () => {
    expect(unrelayedMachineFrom(machineList({ UserModeNetworking: true }))).toBe(undefined);
  });

  // The flag is WSL-only in podman's vocabulary, so it reads `false` on an applehv or hyperv machine that does relay.
  // Those keep the loopback dial they have today rather than being sent to an address nobody measured.
  it("says nothing about a machine type this was never measured on", () => {
    expect(unrelayedMachineFrom(machineList({ VMType: "applehv" }))).toBe(undefined);
  });

  it("says nothing about a machine that is not running", () => {
    expect(unrelayedMachineFrom(machineList({ Running: false }))).toBe(undefined);
  });

  // A native engine — the topology the forward already serves. Measured: `podman machine list` answers `[]` on Linux.
  it("says nothing for an engine that runs its containers itself", () => {
    expect(unrelayedMachineFrom("[]")).toBe(undefined);
  });

  // docker has no `machine` command at all, and an engine that cannot answer is not an engine with a machine.
  it("says nothing when the answer is not a machine listing", () => {
    expect(unrelayedMachineFrom("unknown command: machine")).toBe(undefined);
    expect(unrelayedMachineFrom("")).toBe(undefined);
  });

  it("picks the running machine when several are defined", () => {
    const several = JSON.stringify([
      { Name: "stopped-one", Running: false, VMType: "wsl", UserModeNetworking: false },
      { Name: "the-live-one", Running: true, VMType: "wsl", UserModeNetworking: false },
    ]);
    expect(unrelayedMachineFrom(several)).toBe("the-live-one");
  });
});

describe("machineAddressFrom", () => {
  it("reads the address the machine reaches anything through", () => {
    expect(machineAddressFrom(ROUTE)).toBe("172.24.186.248");
  });

  // An engine that could not run the probe says so in prose, and a fragment of an error is not an address: a forward
  // pointed at one fails in a way that reads like the machine being unreachable.
  it("answers nothing when what came back is not an address", () => {
    expect(machineAddressFrom("Error: unable to start container")).toBe(undefined);
    expect(machineAddressFrom("999.1.1.1")).toBe(undefined);
    expect(machineAddressFrom("")).toBe(undefined);
  });

  // An engine may print a pull, a warning or a progress line above the answer.
  it("takes the address out of whatever the engine printed around it", () => {
    expect(machineAddressFrom("Trying to pull …\nWARN[0000] something\n172.24.186.248\n")).toBe("172.24.186.248");
  });
});

describe("the argv", () => {
  it("asks the engine for its machines as JSON", () => {
    expect(machineListArgv()).toEqual(["machine", "list", "--format", "json"]);
  });

  // Through the engine, in the MACHINE's own network namespace — not `podman machine ssh`, which prints its answer
  // and then never exits over a non-interactive SSH session (measured: it held the connection until the caller's
  // timeout, while every other engine command answered in under a second).
  it("asks from inside the machine's own network, with a container that exits", () => {
    const argv = machineAddressArgv(IMAGE);
    expect(argv.slice(0, 6)).toEqual(["run", "--rm", "--network", "host", "--entrypoint", "node"]);
    expect(argv).toContain(IMAGE);
    expect(argv).not.toContain("ssh");
  });

  // Every argument is joined by ssh and re-split by the REMOTE shell, so a space splits this in two and cmd.exe takes
  // a `>` as a redirect — an arrow function in this script came back as `Parenthesized expression cannot be empty`,
  // with the rest of it written to a file on that machine.
  it("composes a script no remote shell can take apart", () => {
    for (const argument of machineAddressArgv(IMAGE)) {
      expect(argument).not.toMatch(/[\s><|&^%"]/u);
    }
  });
});

describe("resolveMachineAddress", () => {
  it("answers the address a published port really answers on", async () => {
    const exec = vi.fn(async (args: string[]) => (args[0] === "machine" ? WSL_MACHINE : ROUTE));

    expect(await resolveMachineAddress(exec, IMAGE)).toBe("172.24.186.248");
    expect(exec).toHaveBeenCalledWith(machineListArgv());
    expect(exec).toHaveBeenCalledWith(machineAddressArgv(IMAGE));
  });

  // The whole point of answering `undefined`: it is what leaves every other topology on the loopback bind and the
  // loopback dial that ship today, so a wrong guess here can never take a working connection away.
  it("runs nothing at all when there is no machine in the way", async () => {
    const exec = vi.fn(async () => "[]");

    expect(await resolveMachineAddress(exec, IMAGE)).toBe(undefined);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  // An engine that refuses the question is not a failure to start a session over: it is an engine without machines.
  it("answers nothing when the engine refuses the question", async () => {
    const exec = vi.fn(async () => {
      throw new Error("unknown shorthand flag");
    });

    expect(await resolveMachineAddress(exec, IMAGE)).toBe(undefined);
  });

  it("answers nothing when the probe itself could not run", async () => {
    const exec = vi.fn(async (args: string[]) => {
      if (args[0] === "machine") return WSL_MACHINE;
      throw new Error("Error: unable to find image");
    });

    expect(await resolveMachineAddress(exec, IMAGE)).toBe(undefined);
  });
});
