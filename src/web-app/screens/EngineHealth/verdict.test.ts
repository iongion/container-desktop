import { describe, expect, it } from "vitest";

import type { ConnectionRuntimeInfo } from "@/container-client/resourceSyncProtocol";

import { computeVerdict } from "./verdict";

const runtime = (partial: Partial<ConnectionRuntimeInfo>): ConnectionRuntimeInfo => ({
  id: "c1",
  name: "c1",
  engine: "podman",
  phase: "ready",
  running: true,
  ...partial,
});

describe("computeVerdict", () => {
  it("ready + running with no error is healthy", () => {
    const v = computeVerdict(runtime({ phase: "ready", running: true }));
    expect(v.level).toBe("healthy");
    expect(v.reasons).toEqual([]);
  });

  it("failed phase is unreachable and surfaces the error", () => {
    const v = computeVerdict(runtime({ phase: "failed", running: false, error: "dial tcp: connection refused" }));
    expect(v.level).toBe("unreachable");
    expect(v.reasons).toContain("dial tcp: connection refused");
  });

  it("failed without an error message still reports a reason", () => {
    const v = computeVerdict(runtime({ phase: "failed", running: false }));
    expect(v.level).toBe("unreachable");
    expect(v.reasons.length).toBeGreaterThan(0);
  });

  it("idle + not running is unreachable", () => {
    const v = computeVerdict(runtime({ phase: "idle", running: false }));
    expect(v.level).toBe("unreachable");
  });

  it("starting is degraded (transitional)", () => {
    const v = computeVerdict(runtime({ phase: "starting", running: false }));
    expect(v.level).toBe("degraded");
  });

  it("reconnecting is degraded and includes the attempt", () => {
    const v = computeVerdict(runtime({ phase: "reconnecting", running: false, reconnecting: true, attempt: 3 }));
    expect(v.level).toBe("degraded");
    expect(v.reasons.join(" ")).toMatch(/reconnect/i);
    expect(v.reasons.join(" ")).toContain("3");
  });

  it("running but reconnecting flag is degraded", () => {
    const v = computeVerdict(runtime({ phase: "ready", running: true, reconnecting: true, attempt: 2 }));
    expect(v.level).toBe("degraded");
  });

  it("running with a non-fatal error is degraded", () => {
    const v = computeVerdict(runtime({ phase: "ready", running: true, error: "api slow" }));
    expect(v.level).toBe("degraded");
    expect(v.reasons).toContain("api slow");
  });
});
