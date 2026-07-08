import { describe, expect, it } from "vitest";

import type { PodmanMachine, PodmanMachineInspect } from "@/env/Types";

import { buildMachineSummary } from "./inspectSummary";

const byKey = (rows: ReturnType<typeof buildMachineSummary>) => Object.fromEntries(rows.map((r) => [r.key, r]));

describe("buildMachineSummary", () => {
  it("reads the inspect shape (nested Resources + State)", () => {
    const inspect = {
      Name: "podman-machine-default",
      Created: "2026-06-01T00:00:00.000Z",
      LastUp: "2026-07-02T09:00:00.000Z",
      Resources: { CPUs: "4", DiskSize: 107_374_182_400, Memory: 2_147_483_648, USBs: [] },
      State: "running",
      Rootful: true,
    } as unknown as PodmanMachineInspect;
    const rows = byKey(buildMachineSummary(inspect));
    expect(rows.name.value).toBe("podman-machine-default");
    expect(rows.state.value).toBe("running");
    expect(rows.cpus.value).toBe("4");
    expect(String(rows.memory.value)).toContain("GB");
    expect(String(rows.disk.value)).toContain("GB");
    expect(rows.rootful.value).toBe("Yes");
  });

  it("reads the list-placeholder shape (top-level fields + Running boolean)", () => {
    const listItem = {
      Name: "podman-machine-default",
      Running: false,
      CPUs: "2",
      Memory: 1_073_741_824,
      DiskSize: 53_687_091_200,
      Created: "2026-06-01T00:00:00.000Z",
      LastUp: "Currently running",
    } as unknown as PodmanMachine;
    const rows = byKey(buildMachineSummary(listItem));
    expect(rows.state.value).toBe("stopped");
    expect(rows.cpus.value).toBe("2");
    expect(String(rows.memory.value)).toContain("GB");
    // Non-date LastUp is passed through verbatim (never "Invalid Date").
    expect(rows.lastup.value).toBe("Currently running");
    // The list shape has no Rootful flag → no row.
    expect("rootful" in rows).toBe(false);
  });
});
