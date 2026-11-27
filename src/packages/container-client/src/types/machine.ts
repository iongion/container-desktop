import type { SSHHost } from "./connection";
import type { ControllerScopeType } from "./os";

export interface PodmanMachineInspect {
  Name: string;
  ConfigDir: {
    Path: string;
  };
  ConnectionInfo: {
    PodmanSocket?: {
      Path?: string | null;
    };
    PodmanPipe?: {
      Path?: string | null;
    };
  };
  Created: string;
  LastUp: string;
  Resources: {
    CPUs: string;
    DiskSize: number;
    Memory: number;
    USBs: string[];
  };
  SSHConfig: {
    IdentityPath: string;
    Port: number;
    RemoteUsername: string;
  };
  State: string;
  UserModeNetworking: boolean;
  Rootful: boolean;
  Rosetta: boolean;
}

export interface PodmanMachine {
  Name: string;
  Usable: boolean;
  Type: ControllerScopeType;
  // Podman
  Active: boolean;
  Running: boolean;
  LastUp: string;
  VMType: string;
  // Whether something carries this machine's published ports out to the host running it. WSL-only in podman's
  // vocabulary — it reads `false` on the machine types that relay by other means — so it only means "unrelayed"
  // paired with `VMType`. Optional because only `machine list` publishes it: measured against a real WSL machine,
  // `machine inspect` publishes the flag but not `VMType`, so the pair exists on the listing alone.
  UserModeNetworking?: boolean;
  CPUs?: string;
  Default?: boolean;
  DiskSize?: number;
  Memory?: number;
  Created: string;
}

export interface WSLDistribution {
  Name: string;
  Usable?: boolean;
  Type: ControllerScopeType;
  // WSL
  State: string;
  Version: string;
  Default: boolean;
  Current: boolean;
}

export interface LIMAInstance {
  Name: string;
  Usable?: boolean;
  Type: ControllerScopeType;
  // LIMA
  Status: string;
  SSH: string;
  Arch: string;
  CPUs: string;
  Memory: string;
  Disk: string;
  Dir: string;
}

export type ControllerScope = PodmanMachine | WSLDistribution | LIMAInstance | SSHHost;

export interface GenerateKubeOptions {
  entityId: string;
}

export interface CreateMachineOptions {
  cpus: number;
  diskSize: number;
  ramSize: number;
  name: string;
}

export interface FetchMachineOptions {
  Name: string; // name or id
}
