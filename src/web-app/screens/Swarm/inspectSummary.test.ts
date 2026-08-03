import { describe, expect, it } from "vitest";

import type { SwarmConfig, SwarmNode, SwarmSecret, SwarmService } from "@/container-client/types/swarm";

import { buildSwarmSummary } from "./inspectSummary";

const byKey = (rows: ReturnType<typeof buildSwarmSummary>) => Object.fromEntries(rows.map((r) => [r.key, r]));

describe("buildSwarmSummary", () => {
  it("summarises a service (name, id, image, mode, replicas)", () => {
    const service: SwarmService = {
      ID: "svc1234567890abcdef",
      CreatedAt: "2026-07-02T10:06:05.000Z",
      UpdatedAt: "2026-07-03T10:06:05.000Z",
      Spec: {
        Name: "shop_web",
        Mode: { Replicated: { Replicas: 3 } },
        TaskTemplate: { ContainerSpec: { Image: "nginx:1.27" } },
      },
    };
    const rows = byKey(buildSwarmSummary(service, "service"));
    expect(rows.name.value).toBe("shop_web");
    expect(rows.id.value).toBe("svc123456789");
    expect(rows.image.value).toBe("nginx:1.27");
    expect(rows.mode.value).toBe("replicated");
    expect(rows.replicas.value).toBe("3");
    expect(String(rows.created.value)).toMatch(/\d{2} \w{3} \d{4}/);
  });

  it("reports global mode without replicas", () => {
    const service: SwarmService = { ID: "x", Spec: { Name: "agent", Mode: { Global: {} } } };
    const rows = byKey(buildSwarmSummary(service, "service"));
    expect(rows.mode.value).toBe("global");
    expect("replicas" in rows).toBe(false);
  });

  it("summarises a node (hostname, role, availability, state, engine)", () => {
    const node: SwarmNode = {
      ID: "node1234567890abcdef",
      Spec: { Role: "manager", Availability: "active" },
      Description: { Hostname: "mgr-1", Engine: { EngineVersion: "29.6.1" } },
      Status: { State: "ready" },
    };
    const rows = byKey(buildSwarmSummary(node, "node"));
    expect(rows.hostname.value).toBe("mgr-1");
    expect(rows.role.value).toBe("manager");
    expect(rows.availability.value).toBe("active");
    expect(rows.state.value).toBe("ready");
    expect(rows.engine.value).toBe("29.6.1");
  });

  it("summarises configs and secrets by name + id", () => {
    const config: SwarmConfig = { ID: "cfg1234567890abcdef", Spec: { Name: "nginx-conf" } };
    const secret: SwarmSecret = { ID: "sec1234567890abcdef", Spec: { Name: "tls-cert" } };
    expect(byKey(buildSwarmSummary(config, "config")).name.value).toBe("nginx-conf");
    expect(byKey(buildSwarmSummary(secret, "secret")).name.value).toBe("tls-cert");
    expect(byKey(buildSwarmSummary(secret, "secret")).id.value).toBe("sec123456789");
  });
});
