import { describe, expect, it, vi } from "vitest";

import type { HostClientFacade } from "@/container-client/runtimes/facade";
import {
  machineAddressArgv,
  machineAddressFrom,
  publishedPortAddress,
  unrelayedMachine,
} from "@/container-client/runtimes/publishedPortHost";
import { ContainerEngineHost } from "@/container-client/types/engine";
import type { PodmanMachine } from "@/container-client/types/machine";

// podman on Windows runs its engine inside a WSL machine, and that machine is a network realm of its own: a port
// published there does not appear on the Windows host at all. Measured on a real one — `netstat` on the host finds
// nothing, at either bind address — so the `ssh -NL` that reaches a remote engine's loopback lands one hop short of
// the container. What the host CAN reach is the machine's own address, which is what these answers are for.

// A real `podman machine list --format json` row, as a Windows host answers it — measured on win11, including the
// `UserModeNetworking` flag — with one fact at a time varied.
function machine(overrides: Partial<PodmanMachine> = {}): PodmanMachine {
  return {
    Name: "podman-machine-default",
    Default: false,
    Running: true,
    VMType: "wsl",
    UserModeNetworking: false,
    ...overrides,
  } as PodmanMachine;
}

const WSL_MACHINE = [machine()];

// What the probe prints, from a container sharing the machine's own network namespace.
const ROUTE = "172.24.186.248\n";
const IMAGE = "container-desktop/pi-agent:6.0.0";

// A connection, answering the two questions this asks of one: which machines its engine has, and which scope its
// commands run through. `podman machine list` is the DIALECT's now, so a fake connection answers machines, not text.
function connection(
  over: {
    host?: ContainerEngineHost;
    machines?: PodmanMachine[] | (() => Promise<PodmanMachine[]>);
    scope?: string;
    output?: string | (() => Promise<never>);
  } = {},
) {
  const machines = over.machines ?? [];
  const answer = over.output ?? ROUTE;
  const result = async () => {
    if (typeof answer !== "string") return await answer();
    return { pid: 1, code: 0, success: true, stdout: answer, stderr: "" };
  };
  return {
    PROGRAM: "podman",
    HOST: over.host ?? ContainerEngineHost.PODMAN_REMOTE,
    isScoped: () => !!over.scope,
    getSettings: vi.fn(async () => ({ controller: over.scope ? { scope: over.scope } : undefined })),
    getPodmanMachines: vi.fn(async () => (typeof machines === "function" ? await machines() : machines)),
    runHostCommand: vi.fn(result),
    runScopeCommand: vi.fn(result),
  } as unknown as HostClientFacade;
}

describe("unrelayedMachine", () => {
  it("names the machine whose published ports stop at its own network", () => {
    expect(unrelayedMachine(WSL_MACHINE)).toBe("podman-machine-default");
  });

  // `--user-mode-networking` IS podman's own relay: with it on, gvproxy carries a published port out to the machine's
  // host, so the port answers where the app already dials and a hop would send it somewhere nothing is listening.
  it("says nothing about a machine that relays its own ports", () => {
    expect(unrelayedMachine([machine({ UserModeNetworking: true })])).toBe(undefined);
  });

  // The flag is WSL-only in podman's vocabulary, so it reads `false` on an applehv or hyperv machine that does relay.
  // Those keep the loopback dial they have today rather than being sent to an address nobody measured.
  it("says nothing about a machine type this was never measured on", () => {
    expect(unrelayedMachine([machine({ VMType: "applehv" })])).toBe(undefined);
  });

  it("says nothing about a machine that is not running", () => {
    expect(unrelayedMachine([machine({ Running: false })])).toBe(undefined);
  });

  // A native engine — the topology the forward already serves. Measured: `podman machine list` answers `[]` on Linux,
  // and the docker dialect answers no machines at all.
  it("says nothing for an engine that runs its containers itself", () => {
    expect(unrelayedMachine([])).toBe(undefined);
  });

  // A listing old enough not to publish the flag is one nobody measured, and this fails to the loopback bind that
  // already ships rather than binding a machine interface on a guess.
  it("says nothing about a machine whose listing does not publish the flag", () => {
    expect(unrelayedMachine([machine({ UserModeNetworking: undefined })])).toBe(undefined);
  });

  it("picks the running machine when several are defined", () => {
    expect(
      unrelayedMachine([machine({ Name: "stopped-one", Running: false }), machine({ Name: "the-live-one" })]),
    ).toBe("the-live-one");
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

describe("the probe's argv", () => {
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

describe("publishedPortAddress", () => {
  it("answers the address a published port really answers on", async () => {
    const host = connection({ machines: WSL_MACHINE, scope: "win11" });

    expect(await publishedPortAddress(host, IMAGE)).toBe("172.24.186.248");
    expect(host.getPodmanMachines).toHaveBeenCalled();
    expect(host.runScopeCommand).toHaveBeenCalledWith("podman", machineAddressArgv(IMAGE), "win11");
  });

  // The connection's own scope, asked of the connection: the probe travels the same wrapper every other engine command
  // on it does, so for a remote engine the question is asked ON that machine rather than on this one.
  it("runs the probe on this machine only when the connection is not scoped", async () => {
    const host = connection({ machines: WSL_MACHINE });

    expect(await publishedPortAddress(host, IMAGE)).toBe("172.24.186.248");
    expect(host.runHostCommand).toHaveBeenCalledWith("podman", machineAddressArgv(IMAGE));
    expect(host.runScopeCommand).not.toHaveBeenCalled();
  });

  // A local machine-backed connection runs its engine commands THROUGH the machine, so the question would reach a
  // podman inside the guest, which has no machines of its own. It costs a round trip to be told nothing.
  it("asks nothing at all of an engine that runs its containers itself", async () => {
    const host = connection({ host: ContainerEngineHost.PODMAN_VIRTUALIZED_WSL, machines: WSL_MACHINE });

    expect(await publishedPortAddress(host, IMAGE)).toBe(undefined);
    expect(host.getPodmanMachines).not.toHaveBeenCalled();
  });

  // The whole point of answering `undefined`: it is what leaves every other topology on the loopback bind and the
  // loopback dial that ship today, so a wrong guess here can never take a working connection away.
  it("runs no probe when there is no machine in the way", async () => {
    const host = connection({ machines: [] });

    expect(await publishedPortAddress(host, IMAGE)).toBe(undefined);
    expect(host.runHostCommand).not.toHaveBeenCalled();
    expect(host.runScopeCommand).not.toHaveBeenCalled();
  });

  // An engine that cannot be asked is not a failure to start a session over: it is an engine without machines.
  it("answers nothing when the engine could not be asked for its machines", async () => {
    const host = connection({
      machines: async () => {
        throw new Error("SSH connection is not established");
      },
    });

    expect(await publishedPortAddress(host, IMAGE)).toBe(undefined);
  });

  it("answers nothing when the probe itself could not run", async () => {
    const host = connection({
      machines: WSL_MACHINE,
      output: async () => {
        throw new Error("Error: unable to find image");
      },
    });

    expect(await publishedPortAddress(host, IMAGE)).toBe(undefined);
  });
});
