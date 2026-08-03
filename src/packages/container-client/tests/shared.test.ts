import { describe, expect, it } from "vitest";
import { parseLIMAForwardedSocket, parseLIMAInstances } from "@/container-client/shared";

// Read off a real Mac, limactl 2.2.0: the table carries VMTYPE between SSH and ARCH. Both trees split
// by POSITION, so every field after it shifted — Arch took `vz`, CPUs took the arch, and Dir fell off
// the end. Name and Status sit before the new column, which is why nothing noticed.
const REAL = [
  "NAME         STATUS     SSH                VMTYPE    ARCH       CPUS    MEMORY    DISK      DIR",
  "ubuntu-vm    Running    127.0.0.1:50058    vz        aarch64    4       4GiB      100GiB    /Users/iongion/.lima/ubuntu-vm",
].join("\n");

// The shape the parser was written against, before lima added the column.
const OLDER = [
  "NAME          STATUS     SSH                ARCH       CPUS    MEMORY    DISK      DIR",
  "lima-podman   Running    127.0.0.1:60022    aarch64    4       4GiB      100GiB    /Users/tester/.lima/lima-podman",
].join("\n");

describe("parseLIMAInstances", () => {
  it("reads columns by header, so the added VMTYPE shifts nothing", () => {
    const [instance] = parseLIMAInstances(REAL);
    expect(instance.Name).toBe("ubuntu-vm");
    expect(instance.Usable).toBe(true);
    expect(instance.Arch).toBe("aarch64");
    expect(instance.CPUs).toBe("4");
    expect(instance.Memory).toBe("4GiB");
    expect(instance.Disk).toBe("100GiB");
    expect(instance.Dir).toBe("/Users/iongion/.lima/ubuntu-vm");
  });

  it("still reads the table shape that had no VMTYPE", () => {
    const [instance] = parseLIMAInstances(OLDER);
    expect(instance.Name).toBe("lima-podman");
    expect(instance.Arch).toBe("aarch64");
    expect(instance.Dir).toBe("/Users/tester/.lima/lima-podman");
  });

  it("lists nothing from a header alone, and nothing from nothing", () => {
    expect(parseLIMAInstances("NAME  STATUS")).toEqual([]);
    expect(parseLIMAInstances("")).toEqual([]);
  });

  it("keeps a partial row, marked unusable rather than hidden", () => {
    const [instance] = parseLIMAInstances("NAME  STATUS\nlima-podman");
    expect(instance.Name).toBe("lima-podman");
    expect(instance.Status).toBe("");
    expect(instance.Usable).toBe(false);
    expect(instance.Dir).toBe("");
  });
});

// `limactl list --format json <name>`, read off a real Mac and then given two more rules so the
// choice between them is asserted: the port-only rule names no socket, and of the two that do, LIMA
// takes the first ("Rules are checked sequentially until the first one matches").
const REPORT = JSON.stringify({
  name: "lima-podman",
  status: "Running",
  config: {
    portForwards: [
      { guestPortRange: [1, 65535], hostPortRange: [1, 65535] },
      {
        guestSocket: "/run/user/501/podman/podman.sock",
        hostSocket: "/Users/tester/.lima/lima-podman/sock/podman.sock",
      },
      { guestSocket: "/var/run/docker.sock", hostSocket: "/Users/tester/.lima/lima-podman/sock/second.sock" },
    ],
  },
});

describe("parseLIMAForwardedSocket", () => {
  it("takes the forward whose guestSocket the engine reported", () => {
    expect(parseLIMAForwardedSocket(REPORT, "/run/user/501/podman/podman.sock")).toBe(
      "/Users/tester/.lima/lima-podman/sock/podman.sock",
    );
    expect(parseLIMAForwardedSocket(REPORT, "/var/run/docker.sock")).toBe(
      "/Users/tester/.lima/lima-podman/sock/second.sock",
    );
  });

  it("takes the first forwarded socket when the engine matched none", () => {
    for (const guest of ["", "/run/nowhere.sock"]) {
      expect(parseLIMAForwardedSocket(REPORT, guest)).toBe("/Users/tester/.lima/lima-podman/sock/podman.sock");
    }
  });

  it("names nothing when LIMA forwards no socket, or cannot be read", () => {
    for (const report of [
      "",
      "not json",
      JSON.stringify({ name: "i", config: { portForwards: null } }),
      JSON.stringify({ name: "i", config: { portForwards: [] } }),
      JSON.stringify({ name: "i", config: {} }),
      JSON.stringify({ name: "i" }),
      JSON.stringify({ name: "i", config: { portForwards: [{ hostSocket: "" }] } }),
    ]) {
      expect(parseLIMAForwardedSocket(report, "/var/run/docker.sock")).toBe("");
      expect(parseLIMAForwardedSocket(report, "")).toBe("");
    }
  });
});
