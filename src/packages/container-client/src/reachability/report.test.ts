import { describe, expect, it } from "vitest";

import { buildReachabilityReport, type ReachabilityFacts, type ReachabilityObservations } from "./report";

type Report = ReturnType<typeof buildReachabilityReport>;
const hop = (report: Report, name: string) => report.hops.find((h) => h.name.includes(name));
const smokingProbe = (report: Report) => report.probes.find((p) => p.smoking);

// The five demo flows from the locked mockup (.scratch/port-dns-debugger/index.html) — each pins the verdict,
// diagnosis, breaking hop and smoking-gun probe the builder must produce from the observations.

describe("buildReachabilityReport — published port refused (VM, bound to loopback)", () => {
  const facts: ReachabilityFacts = {
    checkType: "published-port",
    transport: "vm",
    engine: "podman",
    connectionName: "podman-machine-default",
    from: { kind: "host", label: "localhost:8080" },
    target: { containerName: "web-1", containerIp: "172.20.0.3", hostPort: 8080, containerPort: 80, protocol: "tcp" },
  };
  const obs: ReachabilityObservations = {
    elapsedMs: 420,
    hostDial: { ok: false, detail: "curl: (56) Recv failure: Connection reset by peer" },
    portMapping: { ok: true, detail: "80/tcp → 0.0.0.0:8080" },
    vmForward: { ok: true, detail: "active · host → VM" },
    containerPing: { ok: true, detail: "reachable · 0.3 ms" },
    listeningInside: { bind: "loopback", detail: "LISTEN 127.0.0.1:80 (nginx)" },
  };

  it("breaks at the container with an error verdict + a bind-to-loopback diagnosis", () => {
    const report = buildReachabilityReport(facts, obs);
    expect(report.verdict.tone).toBe("err");
    expect(report.verdict.text).toContain("Refused");
    // The connection is the head of the path label (not a separate badge).
    expect(report.pathLabel).toBe("podman-machine-default → host → VM → container");
    expect(hop(report, "web-1")?.state).toBe("err");
    expect(hop(report, "VM forward")?.state).toBe("ok");
    expect(report.diagnosis.tone).toBe("err");
    expect(report.diagnosis.headline).toContain("0.0.0.0");
    expect(report.diagnosis.explanation).toContain("127.0.0.1");
  });

  it("marks the `ss` listen check as the smoking-gun probe", () => {
    const report = buildReachabilityReport(facts, obs);
    const smoking = smokingProbe(report);
    expect(smoking?.command).toContain("ss");
    expect(smoking?.smoking).toBe("err");
    expect(report.probeSummary).toBe("5 probes · 0.4 s");
  });
});

describe("buildReachabilityReport — service name won't resolve (no shared network)", () => {
  const facts: ReachabilityFacts = {
    checkType: "service-to-service",
    transport: "vm",
    engine: "podman",
    connectionName: "podman-machine-default",
    from: { kind: "container", label: "api-1" },
    target: { serviceName: "web", containerPort: 80 },
  };
  const obs: ReachabilityObservations = {
    elapsedMs: 200,
    nameResolves: { ok: false, detail: "(not found)" },
    fromNetworks: ["myapp_default"],
    targetNetworks: ["dev-net"],
  };

  it("fails at DNS resolution with a shared-network diagnosis + a `network connect` fix", () => {
    const report = buildReachabilityReport(facts, obs);
    expect(report.verdict.tone).toBe("err");
    expect(hop(report, "resolve")?.state).toBe("err");
    expect(report.diagnosis.headline).toContain("shared network");
    expect(report.diagnosis.fixCommand).toContain("network connect");
    expect(smokingProbe(report)?.command).toContain("getent");
  });
});

describe("buildReachabilityReport — VPN blackhole (reach out)", () => {
  const facts: ReachabilityFacts = {
    checkType: "reach-out",
    transport: "vm",
    engine: "podman",
    connectionName: "podman-machine-default",
    from: { kind: "container", label: "api-1", containerIp: "172.20.0.3" } as any,
    target: { externalHost: "api.stripe.com", externalPort: 443 },
  };
  const obs: ReachabilityObservations = {
    elapsedMs: 3100,
    egress: { ok: false, detail: "timed out after 3s" },
    egressDns: { ok: true, detail: "34.196.0.0" },
    route: { viaVpn: true, dev: "utun4", detail: "dev utun4" },
    tunnels: [{ name: "utun4", app: "AnyConnect", routes: ["0.0.0.0/1", "128.0.0.0/1"] }],
  };

  it("blames the VPN route at the host-route hop", () => {
    const report = buildReachabilityReport(facts, obs);
    expect(report.verdict.tone).toBe("err");
    expect(report.verdict.text).toContain("VPN");
    expect(hop(report, "host route")?.state).toBe("err");
    expect(report.diagnosis.headline).toContain("VPN");
    expect(smokingProbe(report)?.command).toContain("ip route");
  });
});

describe("buildReachabilityReport — SSH remote (port published on the remote host)", () => {
  const facts: ReachabilityFacts = {
    checkType: "published-port",
    transport: "ssh",
    engine: "podman",
    connectionName: "build-server",
    remoteHostLabel: "root@10.0.0.42",
    from: { kind: "host", label: "localhost:8080" },
    target: { containerName: "web-1", hostPort: 8080, containerPort: 80, protocol: "tcp" },
  };
  const obs: ReachabilityObservations = {
    elapsedMs: 300,
    hostDial: { ok: false, detail: "Connection refused — nothing bound locally" },
    portMapping: { ok: true, detail: "80/tcp → 0.0.0.0:8080 on 10.0.0.42" },
    remoteDial: { ok: true, detail: "HTTP/1.1 200 OK" },
    sshTunnel: { ok: true, detail: "up · root@10.0.0.42:22 · 22 ms" },
  };

  it("warns that the port lives on the remote host + groups the remote hops + offers an SSH forward", () => {
    const report = buildReachabilityReport(facts, obs);
    expect(report.verdict.tone).toBe("warn");
    expect(hop(report, "localhost:8080")?.state).toBe("warn");
    expect(report.hops.some((h) => h.remote)).toBe(true);
    expect(report.diagnosis.headline).toContain("remote");
    expect(report.diagnosis.fixCommand).toContain("ssh -L");
    expect(report.diagnosis.actions.some((a) => a.href?.includes("10.0.0.42"))).toBe(true);
  });
});

describe("buildReachabilityReport — reachable end-to-end (VM, all green)", () => {
  const facts: ReachabilityFacts = {
    checkType: "published-port",
    transport: "vm",
    engine: "podman",
    connectionName: "podman-machine-default",
    from: { kind: "host", label: "localhost:8080" },
    target: { containerName: "web-1", containerIp: "172.20.0.3", hostPort: 8080, containerPort: 80, protocol: "tcp" },
  };
  const obs: ReachabilityObservations = {
    elapsedMs: 100,
    hostDial: { ok: true, detail: "HTTP/1.1 200 OK · 3 ms" },
    portMapping: { ok: true, detail: "80/tcp → 0.0.0.0:8080" },
    vmForward: { ok: true, detail: "active · host → VM" },
    containerPing: { ok: true, detail: "reachable · 0.3 ms" },
    listeningInside: { bind: "all", detail: "LISTEN 0.0.0.0:80 (nginx)" },
  };

  it("reports success with no break and no fix", () => {
    const report = buildReachabilityReport(facts, obs);
    expect(report.verdict.tone).toBe("ok");
    expect(report.hops.every((h) => h.state === "ok")).toBe(true);
    expect(report.diagnosis.tone).toBe("ok");
    expect(report.diagnosis.fixCommand).toBeUndefined();
    expect(report.diagnosis.actions).toHaveLength(0);
  });

  it("omits the VM forward hop for a native transport", () => {
    const report = buildReachabilityReport({ ...facts, transport: "native" }, obs);
    expect(hop(report, "VM forward")).toBeUndefined();
    expect(report.verdict.tone).toBe("ok");
  });
});
