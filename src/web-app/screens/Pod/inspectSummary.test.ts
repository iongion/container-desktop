import { describe, expect, it } from "vitest";

import { type Pod, PodStatusList } from "@/env/Types";

import { buildPodSummary } from "./inspectSummary";

const basePod = (overrides: Partial<Pod> = {}): Pod =>
  ({
    Cgroup: "",
    Created: "2026-07-02T10:06:05.000Z",
    Id: "podid1234567890abcdef",
    InfraId: "",
    Labels: {},
    Name: "web-pod",
    NameSpace: "default",
    Networks: [],
    Status: PodStatusList.RUNNING,
    Pid: "1",
    NumContainers: 3,
    Containers: [],
    Processes: { Processes: [], Titles: [] },
    ...overrides,
  }) as Pod;

const byKey = (rows: ReturnType<typeof buildPodSummary>) => Object.fromEntries(rows.map((r) => [r.key, r]));

describe("buildPodSummary", () => {
  it("surfaces name, status, containers, short id and created", () => {
    const rows = byKey(buildPodSummary(basePod()));
    expect(rows.name.value).toBe("web-pod");
    expect(rows.status.value).toBe("Running");
    expect(rows.containers.value).toBe("3");
    expect(rows.id.value).toBe("podid1234567");
    expect(rows.id.copyText).toBe("podid1234567890abcdef");
    expect(rows.namespace.value).toBe("default");
    expect(String(rows.created.value)).toMatch(/\d{2} \w{3} \d{4}/);
  });

  it("omits namespace when empty and keeps zero container counts", () => {
    const rows = byKey(buildPodSummary(basePod({ NameSpace: "", NumContainers: 0 })));
    expect("namespace" in rows).toBe(false);
    expect(rows.containers.value).toBe("0");
  });
});
