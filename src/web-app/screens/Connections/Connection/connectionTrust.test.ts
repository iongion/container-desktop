import { describe, expect, it } from "vitest";

import type { ProxyConfig } from "@/container-client/proxy";
import { type CertAuthority, ContainerEngineHost, type RegistryTrustEntry } from "@/env/Types";
import {
  connectionProxySummary,
  diffCertificates,
  isGuestHost,
  makeCertAuthorityFromFile,
  removedRegistryLocations,
} from "./connectionTrust";

describe("isGuestHost", () => {
  it("true for VM/remote hosts, false for native", () => {
    expect(isGuestHost(ContainerEngineHost.PODMAN_VIRTUALIZED_WSL)).toBe(true);
    expect(isGuestHost(ContainerEngineHost.DOCKER_REMOTE)).toBe(true);
    expect(isGuestHost(ContainerEngineHost.PODMAN_NATIVE)).toBe(false);
    expect(isGuestHost(ContainerEngineHost.DOCKER_NATIVE)).toBe(false);
    expect(isGuestHost(undefined)).toBe(false);
  });
});

const global: Partial<ProxyConfig> = { mode: "manual", protocol: "http", host: "proxy.corp", port: 3128 };

describe("connectionProxySummary", () => {
  it("off → No proxy", () => {
    expect(connectionProxySummary({ mode: "off" }, global)).toBe("No proxy");
  });
  it("inherit → the global endpoint", () => {
    expect(connectionProxySummary({ mode: "inherit" }, global)).toBe("Inherit — proxy.corp:3128");
    expect(connectionProxySummary(undefined, global)).toBe("Inherit — proxy.corp:3128");
  });
  it("inherit with no global → helpful text", () => {
    expect(connectionProxySummary({ mode: "inherit" }, undefined)).toBe("Inherit — no global proxy");
  });
  it("override → the per-connection endpoint", () => {
    const per = { mode: "override" as const, config: { ...(global as ProxyConfig), host: "p2", port: 8080 } };
    expect(connectionProxySummary(per, global)).toBe("Override — p2:8080");
  });
});

describe("makeCertAuthorityFromFile", () => {
  it("carries the PEM content + host + fileName", () => {
    const ca = makeCertAuthorityFromFile("ca.crt", "PEM-BYTES", "reg.local");
    expect(ca.host).toBe("reg.local");
    expect(ca.fileName).toBe("ca.crt");
    expect(ca.pem).toBe("PEM-BYTES");
    expect(ca.installedAt).toBeTruthy();
  });
});

function ca(id: string, host: string): CertAuthority {
  return { id, host, fileName: `${host}.crt`, installedAt: "2026-07-07T00:00:00.000Z", pem: "PEM" };
}

describe("diffCertificates", () => {
  it("classifies added (new id) and removed (gone id) by id, ignoring unchanged", () => {
    const prev = [ca("a", "reg.a"), ca("b", "reg.b")];
    const next = [ca("b", "reg.b"), ca("c", "reg.c")];
    const { added, removed } = diffCertificates(prev, next);
    expect(added.map((c) => c.id)).toEqual(["c"]);
    expect(removed.map((c) => c.id)).toEqual(["a"]);
  });
  it("handles undefined lists as empty", () => {
    expect(diffCertificates(undefined, [ca("a", "reg.a")])).toEqual({ added: [ca("a", "reg.a")], removed: [] });
    expect(diffCertificates([ca("a", "reg.a")], undefined)).toEqual({ added: [], removed: [ca("a", "reg.a")] });
  });
});

function reg(name: string): RegistryTrustEntry {
  return { name, tls: "insecure", order: 1, enabled: true };
}

describe("removedRegistryLocations", () => {
  it("returns names present before but gone now, by name", () => {
    expect(removedRegistryLocations([reg("a"), reg("b")], [reg("b")])).toEqual(["a"]);
    expect(removedRegistryLocations([reg("a")], [reg("a")])).toEqual([]);
    expect(removedRegistryLocations(undefined, [reg("a")])).toEqual([]);
    expect(removedRegistryLocations([reg("a")], undefined)).toEqual(["a"]);
  });
});
