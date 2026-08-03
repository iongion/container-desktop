import { describe, expect, it } from "vitest";

import type { PodmanMachine } from "@/container-client/types/machine";
import { machineCanStop } from "./bulkActions";

// Stop is the only state-dependent bulk button for machines; it applies only to running machines.
// Restart/Remove are always enabled. Running is detected via a "running" State or the Running flag,
// mirroring Machine/ActionsMenu.tsx.
describe("machine bulk eligibility", () => {
  it("stop applies only to running machines", () => {
    expect(machineCanStop({ Running: true } as PodmanMachine)).toBe(true);
    expect(machineCanStop({ State: "running" } as unknown as PodmanMachine)).toBe(true);
    expect(machineCanStop({ Running: false } as PodmanMachine)).toBe(false);
    expect(machineCanStop({ State: "stopped" } as unknown as PodmanMachine)).toBe(false);
    expect(machineCanStop({} as PodmanMachine)).toBe(false);
  });
});
