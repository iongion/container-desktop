import { describe, expect, it } from "vitest";
import {
  appleMachineCreateArgs,
  parseAppleMachineInspect,
  parseAppleMachines,
} from "@/container-client/runtimes/dialects/apple-machines";
import { ControllerScopeType } from "@/container-client/types/os";

// `container machine list --format json` and `container machine inspect <id>`, as Apple's 1.7.1 CLI printed them on a
// real Mac (temp/ANALYSIS-apple-container.md). Memory and disk size are bytes, as the Machines screen expects.
const LIST = JSON.stringify([
  {
    status: "running",
    cpus: 6,
    id: "dev",
    ipAddress: "192.168.64.3",
    diskSize: 43831296,
    memory: 17179869184,
    createdDate: "2026-11-27T14:51:48Z",
    default: true,
  },
  { status: "stopped", cpus: 2, id: "lab", diskSize: 1000, memory: 2147483648, createdDate: "2026-11-26T10:00:00Z" },
]);

const INSPECT = JSON.stringify([
  {
    containerId: "dev-5f1c34",
    cpus: 6,
    createdDate: "2026-11-27T14:51:48Z",
    diskSize: 43323392,
    homeMount: "rw",
    id: "dev",
    image: { reference: "docker.io/library/alpine:3.22" },
    ipAddress: "192.168.64.2",
    memory: 17179869184,
    platform: { architecture: "arm64", os: "linux" },
    startedDate: "2026-11-27T14:52:27Z",
    status: "running",
    userSetup: { gid: 20, home: "/home/me", uid: 501, username: "me" },
  },
]);

describe("parseAppleMachines — Apple machines in the Machines screen's shape", () => {
  it("maps every machine, its state, resources and default flag", () => {
    const [dev, lab] = parseAppleMachines(LIST);
    expect(dev).toMatchObject({
      Name: "dev",
      Running: true,
      Default: true,
      Active: true,
      CPUs: "6",
      Memory: 17179869184,
      DiskSize: 43831296,
      Created: "2026-11-27T14:51:48Z",
      VMType: "apple",
      Type: ControllerScopeType.PodmanMachine,
      Usable: true,
    });
    expect(lab).toMatchObject({ Name: "lab", Running: false, Default: false });
  });

  it("is empty when the CLI printed no list", () => {
    expect(parseAppleMachines("")).toEqual([]);
    expect(parseAppleMachines("Error: apiserver is not running")).toEqual([]);
  });
});

describe("parseAppleMachineInspect — one machine's detail", () => {
  it("maps the named machine's state, resources and dates", () => {
    expect(parseAppleMachineInspect(INSPECT, "dev")).toMatchObject({
      Name: "dev",
      State: "running",
      Created: "2026-11-27T14:51:48Z",
      LastUp: "2026-11-27T14:52:27Z",
      Resources: { CPUs: "6", Memory: 17179869184, DiskSize: 43323392, USBs: [] },
    });
  });

  // Rootful is Podman's notion: the detail would otherwise read "Rootful: No" for every Apple machine.
  it("claims no Rootful", () => {
    expect(parseAppleMachineInspect(INSPECT, "dev")).not.toHaveProperty("Rootful");
  });

  it("is undefined for another name or no output", () => {
    expect(parseAppleMachineInspect(INSPECT, "other")).toBeUndefined();
    expect(parseAppleMachineInspect("", "dev")).toBeUndefined();
  });
});

describe("appleMachineCreateArgs — `container machine create`", () => {
  // The form's RAM size is MiB, as for Podman; Apple has no disk size option.
  it("names the machine, sets CPUs and memory, and boots the image", () => {
    expect(
      appleMachineCreateArgs({ name: "dev", cpus: 4, ramSize: 4096, diskSize: 100, image: "alpine:3.22" }),
    ).toEqual(["machine", "create", "--name", "dev", "--cpus", "4", "--memory", "4096M", "alpine:3.22"]);
  });

  it("leaves CPUs and memory to Apple's defaults when not set", () => {
    expect(appleMachineCreateArgs({ name: "dev", cpus: 0, ramSize: 0, diskSize: 0, image: "alpine:3.22" })).toEqual([
      "machine",
      "create",
      "--name",
      "dev",
      "alpine:3.22",
    ]);
  });
});
