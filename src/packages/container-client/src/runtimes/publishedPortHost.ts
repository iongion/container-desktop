// Where a port published by this connection's engine actually answers.
//
// This is CONNECTION knowledge and it is asked of the connection: the machines come from the dialect that already
// owns them (`getPodmanMachines`, routed through the scope for a remote engine), the scope from the connection, and
// the address from a container the engine runs itself. Nothing about a session or an agent reaches in here — the
// caller names only the image to probe with.
//
// An engine that runs its containers itself publishes on the loopback of the machine running it, which is what the
// bridge dials and what `ssh -NL` forwards for a remote one. podman on Windows does not: its engine lives inside a
// WSL machine, a network realm of its own, and a port published there never appears on the Windows host — measured
// on a real one, at BOTH bind addresses, with `netstat` on the host finding nothing. So the forward that reaches a
// remote engine's loopback lands one hop short of the container, and a session on such a connection built its pair
// and then dialled nothing.
//
// What the machine's host CAN reach is the machine's own address, so that is what the pair publishes on and what the
// forward is pointed at. It is a NARROWER bind than the loopback one it replaces: measured, `-p <machine-ip>:p:8787`
// binds that one interface and the machine's own loopback stops answering.
//
// Everything else keeps the loopback bind and the loopback dial it has today, because everything else relays: that is
// what `--user-mode-networking` IS on podman, what gvproxy does on macOS, and what Docker Desktop's own forwarder
// does — measured too, on a real Docker Desktop, where a port published inside its WSL machine answers on the
// Windows host at both bind addresses. Answering `undefined` is therefore the safe answer, and every question here
// fails to it.

import { engineIsRemote } from "@/container-client/proxy-route";
import type { PodmanMachine } from "@/container-client/types/machine";
import { createLogger } from "@/logger";

import { connectionCommandScope } from "./commandScope";
import type { HostClientFacade } from "./facade";

const logger = createLogger("container-client.publishedPortHost");

// The address a published port answers on when nothing is in the way — the machine running the engine, as reached
// from itself.
export const LOOPBACK_ADDRESS = "127.0.0.1";

// Asking the kernel which source address it would use to leave the machine, from a container that shares the
// MACHINE's own network namespace. A `connect` on a UDP socket sends nothing — it only resolves the route — so this
// answers the same thing `ip route get` does, without depending on an interface being called `eth0`.
//
// Written with no spaces and no `>`: every argument of a remote engine's command is joined by ssh and re-split by
// ITS shell, so a space splits the argument and cmd.exe takes a `>` as a redirect. Measured both — an arrow function
// here came back as `Parenthesized expression cannot be empty`, with the rest of it written to a file on that machine.
const MACHINE_ADDRESS_SCRIPT =
  "s=require('dgram').createSocket('udp4');s.connect(53,'1.1.1.1',function(){console.log(s.address().address);s.close()})";

// Through the ENGINE and not `podman machine ssh`: that one prints its answer and then never exits over a
// non-interactive SSH session — measured, it holds the connection until the caller's timeout kills it, which is
// exactly how this probe first came back empty while every other engine command answered in under a second.
export function machineAddressArgv(imageTag: string): string[] {
  return ["run", "--rm", "--network", "host", "--entrypoint", "node", imageTag, "-e", MACHINE_ADDRESS_SCRIPT];
}

// The machine whose published ports stop at its own network, if this engine has one. `UserModeNetworking` is a
// WSL-only flag in podman's vocabulary — it reads `false` on the machine types that relay by other means — so the
// pair with `VMType` is the exact expression of "nothing carries this machine's ports out to its host".
//
// Explicitly `false`, never merely falsy: a listing that does not publish the flag at all is one nobody measured, and
// this fails to the loopback bind that already ships rather than binding a machine interface on a guess.
export function unrelayedMachine(machines: PodmanMachine[]): string | undefined {
  const machine = machines.find(
    (row) => row?.Running === true && row?.VMType === "wsl" && row?.UserModeNetworking === false && !!row?.Name,
  );
  return machine?.Name;
}

// The one address the probe prints. Taken from the LAST line that is one, because an engine may put a pull or a
// warning above it, and refused unless it is a real IPv4 — a forward pointed at a fragment of an error message fails
// in a way that reads like the machine being unreachable.
export function machineAddressFrom(output: string): string | undefined {
  const found = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(line) && line.split(".").every((part) => Number(part) < 256));
  return found.at(-1);
}

// Where this connection's published ports answer, or `undefined` for the loopback the app already dials.
//
// Asked only of a REMOTE engine, and not because a local one cannot live inside a machine: a local machine-backed
// connection runs its engine commands THROUGH the machine (`podman machine ssh <scope> podman …`), so the question
// would reach a podman inside the guest, which has no machines of its own and answers with none. It costs a round
// trip to be told nothing.
//
// Never throws. An engine with no machines — every docker one, since the dialect answers those with none at all —
// means "nothing in the way", which is the topology that already works.
export async function publishedPortAddress(host: HostClientFacade, imageTag: string): Promise<string | undefined> {
  if (!engineIsRemote(host.HOST)) return undefined;
  const machines = await host.getPodmanMachines().catch((error) => {
    logger.debug("the engine could not be asked for its machines", error);
    return [];
  });
  const machine = unrelayedMachine(machines);
  if (!machine) {
    logger.debug("the engine publishes on its own host");
    return undefined;
  }
  const scope = await connectionCommandScope(host);
  const argv = machineAddressArgv(imageTag);
  // Both answers are logged, because "the machine would not say" and "the machine has no address" look identical
  // from the outside and the difference decides whether a session is dialling the right address or nothing at all.
  const answer = await runEngine(host, argv, scope).catch((error) => {
    logger.debug(`the engine refused \`${argv.join(" ")}\``, error);
    return "";
  });
  const address = machineAddressFrom(answer);
  logger.debug(
    address
      ? `the engine runs inside ${machine}, reachable at ${address}`
      : `${machine} did not answer with an address: ${answer.slice(0, 200)}`,
  );
  return address;
}

async function runEngine(host: HostClientFacade, argv: string[], scope: string | undefined): Promise<string> {
  const result = scope
    ? await host.runScopeCommand(host.PROGRAM, argv, scope)
    : await host.runHostCommand(host.PROGRAM, argv);
  if (!result.success) throw new Error(result.stderr?.trim() || `engine command failed: ${argv[0]}`);
  return (result.stdout ?? "").trim();
}
