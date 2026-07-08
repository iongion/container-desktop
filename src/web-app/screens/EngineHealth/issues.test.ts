import { describe, expect, it } from "vitest";

import type { ReachabilityDiagnosis } from "@/container-client/reachability/model";
import type { ConnectionRuntimeInfo } from "@/container-client/resourceSyncProtocol";

import type { FleetConnection } from "./fleet";
import { buildDiagnoses, type FleetEntry, foldLevel, serializeDiagnostics, summarizeEntries } from "./issues";

const card = (partial: Partial<FleetConnection>): FleetConnection => ({
  id: "c",
  name: "c",
  engine: "podman",
  engineLabel: "Podman",
  transport: "native",
  transportLabel: "native",
  subtitle: "Podman · native",
  verdict: { level: "healthy", reasons: [] },
  runtime: {} as ConnectionRuntimeInfo,
  ...partial,
});

const warn: ReachabilityDiagnosis = { tone: "warn", icon: "warning-sign", headline: "w", explanation: "", actions: [] };

describe("buildDiagnoses", () => {
  it("emits an error diagnosis for an unreachable connection", () => {
    const diagnoses = buildDiagnoses(
      card({ name: "web", verdict: { level: "unreachable", reasons: ["connection refused"] } }),
      [],
    );
    expect(diagnoses).toHaveLength(1);
    expect(diagnoses[0].tone).toBe("err");
    expect(diagnoses[0].explanation).toBe("connection refused");
  });

  it("emits a warning diagnosis with a fix command per subnet overlap", () => {
    const diagnoses = buildDiagnoses(card({ engine: "podman" }), [{ a: "dev-net", b: "myapp", cidr: "10.89.0.0/24" }]);
    expect(diagnoses).toHaveLength(1);
    expect(diagnoses[0].tone).toBe("warn");
    expect(diagnoses[0].headline).toContain("dev-net");
    expect(diagnoses[0].fixCommand).toBe("podman network rm dev-net");
  });
});

describe("foldLevel", () => {
  it("downgrades a healthy connection to degraded when it has issues", () => {
    expect(foldLevel("healthy", [warn])).toBe("degraded");
    expect(foldLevel("healthy", [])).toBe("healthy");
  });
  it("preserves a non-healthy base level", () => {
    expect(foldLevel("unreachable", [])).toBe("unreachable");
    expect(foldLevel("degraded", [warn])).toBe("degraded");
  });
});

describe("summarizeEntries + serializeDiagnostics", () => {
  const entries: FleetEntry[] = [
    {
      card: card({
        name: "web",
        subtitle: "Podman · SSH · x@h",
        verdict: { level: "unreachable", reasons: ["refused"] },
      }),
      level: "unreachable",
      diagnoses: buildDiagnoses(card({ name: "web", verdict: { level: "unreachable", reasons: ["refused"] } }), []),
    },
    { card: card({ name: "local" }), level: "degraded", diagnoses: [warn] },
  ];

  it("counts by the effective (folded) level", () => {
    expect(summarizeEntries(entries)).toEqual({ healthy: 0, degraded: 1, unreachable: 1, total: 2 });
  });

  it("serializes the summary, connections and their diagnoses", () => {
    const text = serializeDiagnostics(entries);
    expect(text).toContain("2 connection");
    expect(text).toContain("1 degraded");
    expect(text).toContain("web");
    expect(text).toContain("refused");
    expect(text).toContain("is unreachable");
  });
});
