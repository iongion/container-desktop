import { describe, expect, it } from "vitest";

import {
  isRootfulPodmanConnectionName,
  podmanMachineNameFromConnectionName,
  preferRootlessMachineConnection,
  selectDefaultMachineScopeName,
} from "./podman-machine-connections";

// The exact `podman system connection list --format json` captured on the user's Windows VM (podman 5.8.4,
// WSL machine). The ROOTFUL `-root` connection is the one marked Default — but the app targets rootless podman
// only, so every selector must pick the rootless `podman-machine-default`, never the `-root` one.
const VM_CONNECTIONS = [
  {
    Name: "podman-machine-default",
    URI: "ssh://user@127.0.0.1:56515/run/user/1000/podman/podman.sock",
    IsMachine: true,
    Default: false,
  },
  {
    Name: "podman-machine-default-root",
    URI: "ssh://root@127.0.0.1:56515/run/podman/podman.sock",
    IsMachine: true,
    Default: true,
  },
];

describe("isRootfulPodmanConnectionName", () => {
  it("recognises the `-root` rootful suffix (case-insensitive, trimmed)", () => {
    expect(isRootfulPodmanConnectionName("podman-machine-default-root")).toBe(true);
    expect(isRootfulPodmanConnectionName("  podman-machine-default-ROOT ")).toBe(true);
  });

  it("treats rootless names and empties as not rootful", () => {
    expect(isRootfulPodmanConnectionName("podman-machine-default")).toBe(false);
    expect(isRootfulPodmanConnectionName("root-machine")).toBe(false); // -root must be a suffix
    expect(isRootfulPodmanConnectionName("")).toBe(false);
    expect(isRootfulPodmanConnectionName(undefined)).toBe(false);
  });
});

describe("podmanMachineNameFromConnectionName", () => {
  it("maps a rootful connection back to its machine by stripping `-root`", () => {
    expect(podmanMachineNameFromConnectionName("podman-machine-default-root")).toBe("podman-machine-default");
  });

  it("leaves a rootless connection name unchanged and normalises whitespace/empties", () => {
    expect(podmanMachineNameFromConnectionName("podman-machine-default")).toBe("podman-machine-default");
    expect(podmanMachineNameFromConnectionName("  podman-machine-default-root  ")).toBe("podman-machine-default");
    expect(podmanMachineNameFromConnectionName(undefined)).toBe("");
  });
});

describe("preferRootlessMachineConnection", () => {
  it("prefers the rootless connection even when the rootful `-root` is marked Default", () => {
    expect(preferRootlessMachineConnection(VM_CONNECTIONS)?.Name).toBe("podman-machine-default");
  });

  it("honours the Default flag among rootless connections", () => {
    const list = [
      { Name: "podman-machine-a", Default: false },
      { Name: "podman-machine-b", Default: true },
    ];
    expect(preferRootlessMachineConnection(list)?.Name).toBe("podman-machine-b");
  });

  it("falls back to a rootful connection only when no rootless one exists", () => {
    const list = [{ Name: "podman-machine-default-root", Default: true }];
    expect(preferRootlessMachineConnection(list)?.Name).toBe("podman-machine-default-root");
  });

  it("returns undefined for an empty candidate list", () => {
    expect(preferRootlessMachineConnection([])).toBeUndefined();
  });
});

describe("selectDefaultMachineScopeName", () => {
  it("resolves the rootless machine scope for the VM's rootful-default connection list (regression)", () => {
    const result = selectDefaultMachineScopeName(VM_CONNECTIONS, ["podman-machine-default"]);
    expect(result.name).toBe("podman-machine-default");
  });

  it("maps a rootful-only default connection back to its machine", () => {
    const connections = [{ Name: "podman-machine-default-root", IsMachine: true, Default: true }];
    expect(selectDefaultMachineScopeName(connections, ["podman-machine-default"]).name).toBe("podman-machine-default");
  });

  it("uses the sole machine when the default connection names nothing known", () => {
    const connections = [{ Name: "stale-connection", IsMachine: true, Default: true }];
    const result = selectDefaultMachineScopeName(connections, ["podman-machine-default"]);
    expect(result.name).toBe("podman-machine-default");
    expect(result.reason).toMatch(/only machine/i);
  });

  it("returns no name (with a diagnostic reason) when nothing matches across multiple machines", () => {
    const connections = [{ Name: "ghost", IsMachine: true, Default: true }];
    const result = selectDefaultMachineScopeName(connections, ["m1", "m2"]);
    expect(result.name).toBeUndefined();
    expect(result.reason).toContain("ghost");
    expect(result.reason).toContain("m1");
  });

  it("returns no name for an empty/non-array connection list", () => {
    expect(selectDefaultMachineScopeName([], ["m1"]).name).toBeUndefined();
    expect(selectDefaultMachineScopeName(undefined, ["m1"]).name).toBeUndefined();
  });
});
