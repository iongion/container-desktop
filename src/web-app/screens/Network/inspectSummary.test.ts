import { describe, expect, it } from "vitest";

import type { Network } from "@/container-client/types/network";

import { buildNetworkSummary } from "./inspectSummary";

const baseNetwork = (overrides: Partial<Network> = {}): Network =>
  ({
    created: "2026-07-02T10:06:05.000Z",
    dns_enabled: false,
    driver: "bridge",
    id: "netid1234567890abcdef",
    internal: false,
    ipam_options: {},
    ipv6_enabled: true,
    labels: {},
    name: "my-net",
    network_interface: "n/a",
    options: {},
    subnets: [],
    ...overrides,
  }) as Network;

const byKey = (rows: ReturnType<typeof buildNetworkSummary>) => Object.fromEntries(rows.map((r) => [r.key, r]));

describe("buildNetworkSummary", () => {
  it("surfaces name, short id, driver, internal/ipv6 as yes/no and created", () => {
    const rows = byKey(buildNetworkSummary(baseNetwork()));
    expect(rows.name.value).toBe("my-net");
    expect(rows.id.value).toBe("netid1234567");
    expect(rows.driver.value).toBe("bridge");
    expect(rows.internal.value).toBe("No");
    expect(rows.ipv6.value).toBe("Yes");
    expect(String(rows.created.value)).toMatch(/\d{2} \w{3} \d{4}/);
  });

  it("never shows the engine-specific interface/dns/subnets fields", () => {
    const keys = buildNetworkSummary(baseNetwork()).map((r) => r.key);
    expect(keys).not.toContain("interface");
    expect(keys).not.toContain("dns");
    expect(keys).not.toContain("subnets");
  });

  it("always shows internal/ipv6 rows even when false", () => {
    const rows = byKey(buildNetworkSummary(baseNetwork({ internal: false, ipv6_enabled: false })));
    expect(rows.internal.value).toBe("No");
    expect(rows.ipv6.value).toBe("No");
  });
});
