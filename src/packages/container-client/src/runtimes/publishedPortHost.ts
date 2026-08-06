// Where a port published by this engine actually answers.
//
// This is CONNECTION knowledge, and it lives with the rest of it. It was written inside the AI subsystem, which
// meant that package asking podman about machines and parsing podman's own rows — a second machine-aware path
// beside the podman dialects and the podman-machine transport, which already resolve a connection's machine and
// how to reach it. A caller supplies the exec seam and the image to probe with, so nothing about a session or an
// agent reaches in here. Consolidating the listing below with the dialect's own `getPodmanMachineInspect` is the
// remaining step; `UserModeNetworking` is published by `machine list`, which is why this still asks for it.
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
// does. Answering `undefined` is therefore the safe answer, and every question here fails to it.

// The address a published port answers on when nothing is in the way — the machine running the engine, as reached
// from itself.
export const LOOPBACK_ADDRESS = "127.0.0.1";

// One row of `podman machine list --format json`, in podman's own spelling and only the fields this reads.
interface MachineListRow {
  Name?: string;
  Running?: boolean;
  VMType?: string;
  UserModeNetworking?: boolean;
}

export function machineListArgv(): string[] {
  return ["machine", "list", "--format", "json"];
}

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
export function unrelayedMachineFrom(payload: string): string | undefined {
  let rows: MachineListRow[];
  try {
    rows = JSON.parse(payload) as MachineListRow[];
  } catch {
    return undefined;
  }
  if (!Array.isArray(rows)) return undefined;
  const machine = rows.find(
    (row) => row?.Running === true && row?.VMType === "wsl" && !row?.UserModeNetworking && !!row?.Name,
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

// Ask the engine what machines it has, then ask that machine where it is. `exec` is the connection's own command
// seam, so this travels wherever that connection does — over SSH for a remote engine, exactly like every other engine
// command the session runs.
//
// Never throws. An engine with no `machine` command answers with an error, and an error here means "no machine in the
// way", which is the topology that already works.
export async function resolveMachineAddress(
  exec: (args: string[]) => Promise<string>,
  imageTag: string,
): Promise<string | undefined> {
  const listing = await exec(machineListArgv()).catch(() => "");
  if (!unrelayedMachineFrom(listing)) return undefined;
  const answer = await exec(machineAddressArgv(imageTag)).catch(() => "");
  return machineAddressFrom(answer);
}
