// runtimes/dialects/apple-machines.ts — Apple's `container machine` (1.7) in the Machines screen's shapes.
//
// An Apple machine is a long-lived Linux VM booted from an image. `list --format json` and `inspect` print bytes for
// memory and disk size and `status` running/stopped; the machines extension reuses the Podman-named shapes the
// Machines screen already renders. Pure, so the mapping is tested without a Mac.

import type { CreateMachineOptions, PodmanMachine, PodmanMachineInspect } from "@/container-client/types/machine";
import { ControllerScopeType } from "@/container-client/types/os";
import { parseJSON } from "./shared";

interface AppleMachine {
  id?: string;
  status?: string;
  cpus?: number;
  memory?: number;
  diskSize?: number;
  createdDate?: string;
  startedDate?: string;
  default?: boolean;
}

function machinesOf(stdout: string): AppleMachine[] {
  const value = parseJSON(`${stdout || ""}`.trim());
  return Array.isArray(value) ? (value as AppleMachine[]).filter((machine) => typeof machine?.id === "string") : [];
}

export function parseAppleMachines(stdout: string): PodmanMachine[] {
  return machinesOf(stdout).map((machine) => ({
    Name: `${machine.id}`,
    Usable: true,
    Type: ControllerScopeType.PodmanMachine,
    Active: machine.default === true,
    Default: machine.default === true,
    Running: machine.status === "running",
    LastUp: machine.startedDate || "",
    VMType: "apple",
    CPUs: machine.cpus === undefined ? undefined : `${machine.cpus}`,
    Memory: machine.memory,
    DiskSize: machine.diskSize,
    Created: machine.createdDate || "",
  }));
}

// `inspect` prints an array of one; undefined when it names another machine or printed nothing.
export function parseAppleMachineInspect(stdout: string, name: string): PodmanMachineInspect | undefined {
  const machine = machinesOf(stdout).find((candidate) => candidate.id === name);
  if (!machine) {
    return undefined;
  }
  return {
    Name: name,
    ConfigDir: { Path: "" },
    ConnectionInfo: {},
    Created: machine.createdDate || "",
    LastUp: machine.startedDate || "",
    Resources: {
      CPUs: machine.cpus === undefined ? "" : `${machine.cpus}`,
      DiskSize: machine.diskSize ?? 0,
      Memory: machine.memory ?? 0,
      USBs: [],
    },
    SSHConfig: { IdentityPath: "", Port: 0, RemoteUsername: "" },
    State: machine.status || "",
    UserModeNetworking: false,
    Rosetta: false,
  };
}

// `container machine create`, which boots the machine. RAM size is MiB, as in the form; Apple has no disk size.
export function appleMachineCreateArgs(opts: CreateMachineOptions): string[] {
  const args = ["machine", "create", "--name", opts.name];
  if (opts.cpus > 0) {
    args.push("--cpus", `${opts.cpus}`);
  }
  if (opts.ramSize > 0) {
    args.push("--memory", `${opts.ramSize}M`);
  }
  args.push(opts.image || "");
  return args;
}
