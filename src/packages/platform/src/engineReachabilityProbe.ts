// Reachability debugger — run ONE probe for a framed question ("can X reach Y?") and return the assembled
// report. Mirrors the mount probe: resolve the target's facts from cached resources, gather observations (mock
// synthesizes them; real mode runs the tractable container-exec probes), then hand both to the shared,
// unit-tested buildReachabilityReport. Host-side probes (VPN/route/host-port conflicts) are NOT gathered yet —
// they need OS-aware host commands (the host can be Windows, so no `sh`/`curl` assumption); the builder reports
// honestly from what it has rather than fabricating them.

import { isMockMode } from "@/container-client/mock/mode";
import { resolveTransport } from "@/container-client/reachability/model";
import {
  buildReachabilityReport,
  type ListenOutcome,
  type ProbeOutcome,
  type ReachabilityFacts,
  type ReachabilityObservations,
} from "@/container-client/reachability/report";
import type { ReachabilityProbeRequest, ReachabilityProbeResponse } from "@/container-client/resourceSyncProtocol";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import type { CommandExecutionResult } from "@/host-contract/exec";
import {
  type EngineProbeView,
  firstOutputLine,
  settleWithin,
  singleQuotePosix,
  sleep,
} from "@/platform/engineProbeSupport";

const REACHABILITY_PROBE_TIMEOUT_MS = 6000;
const MOCK_REACHABILITY_PROBE_DELAY_MS = 900;

// Parse `ss`/`netstat` output from INSIDE a container to decide whether the service is bound to all interfaces
// (reachable from the container's network) or only to loopback (the "published but refused" pain). Pure text —
// the shell that produced it runs inside the Linux container, never on the (possibly Windows) host.
function parseListeningBind(stdout: string, cport: number): ListenOutcome {
  const port = `${cport}`;
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const onPort = lines.filter((line) => line.includes(`:${port}`));
  if (!onPort.length) {
    return { bind: "none", detail: `nothing listening on :${port}` };
  }
  const all = onPort.find((line) =>
    [`0.0.0.0:${port}`, `*:${port}`, `:::${port}`, `[::]:${port}`].some((needle) => line.includes(needle)),
  );
  if (all) {
    return { bind: "all", detail: all };
  }
  const loopback = onPort.find(
    (line) => line.includes(`127.0.0.1:${port}`) || line.includes(`::1]:${port}`) || line.includes(`::1:${port}`),
  );
  if (loopback) {
    return { bind: "loopback", detail: `${loopback}  ← localhost only` };
  }
  return { bind: "unknown", detail: onPort[0] };
}

export async function probeReachability(
  view: EngineProbeView,
  request: ReachabilityProbeRequest,
): Promise<ReachabilityProbeResponse> {
  const facts = resolveReachabilityFacts(view, request);
  const startedAt = Date.now();
  const observations = isMockMode()
    ? await mockReachabilityObservations(view, facts, request)
    : await gatherReachabilityObservations(view, facts, request);
  if (typeof observations.elapsedMs !== "number") {
    observations.elapsedMs = Math.max(0, Date.now() - startedAt);
  }
  return buildReachabilityReport(facts, observations);
}

function resolveReachabilityFacts(view: EngineProbeView, request: ReachabilityProbeRequest): ReachabilityFacts {
  const connection = view.connections.find((item) => item.id === request.connectionId);
  const engine = `${connection?.engine ?? "podman"}`;
  const transport = resolveTransport(connection?.host);
  const runtime = view.runtimes.get(request.connectionId);
  const remoteHostLabel =
    transport === "ssh"
      ? runtime?.scope || `${connection?.host ?? request.connectionId}`.replace(/\.remote$/, "")
      : undefined;
  const fromContainer = request.fromContainerId
    ? findContainer(view, request.connectionId, request.fromContainerId)
    : undefined;
  const targetContainer = request.targetContainerId
    ? findContainer(view, request.connectionId, request.targetContainerId)
    : undefined;
  const from: ReachabilityFacts["from"] = fromContainer
    ? {
        kind: "container",
        label: containerDisplayName(fromContainer),
        containerIp: containerIp(fromContainer),
      }
    : { kind: "host", label: `localhost:${request.hostPort ?? 0}` };
  return {
    checkType: request.checkType,
    transport,
    engine,
    connectionName: connection?.name ?? request.connectionId,
    remoteHostLabel,
    from,
    target: {
      containerName: targetContainer ? containerDisplayName(targetContainer) : undefined,
      containerIp: targetContainer ? containerIp(targetContainer) : undefined,
      hostPort: request.hostPort,
      containerPort: request.containerPort,
      protocol: request.protocol,
      serviceName: request.serviceName,
      externalHost: request.externalHost,
      externalPort: request.externalPort,
      lookupName: request.lookupName,
    },
  };
}

function findContainer(view: EngineProbeView, connectionId: string, containerId: string): any {
  const containers = view.resources.get(connectionId)?.containers ?? [];
  return containers.find((item: any) => {
    const id = `${item?.Id ?? ""}`;
    return id === containerId || (containerId.length >= 6 && id.startsWith(containerId));
  });
}

function containerDisplayName(container: any): string {
  const raw =
    container?.Computed?.Name ||
    container?.Name ||
    (Array.isArray(container?.Names) ? container.Names[0] : container?.Names) ||
    container?.Id ||
    "container";
  return `${raw}`.replace(/^\//, "");
}

function containerIp(container: any): string | undefined {
  const ip = container?.NetworkSettings?.IPAddress;
  return ip ? `${ip}` : undefined;
}

function reachabilityNetworksOf(container: any): string[] {
  const networks = container?.Networks;
  if (Array.isArray(networks)) {
    return networks.map((name) => `${name}`);
  }
  if (networks && typeof networks === "object") {
    return Object.keys(networks);
  }
  return [];
}

// Deterministic 0..buckets-1 from a stable key — MOCK-ONLY demo variety (there is no live probe in mock mode),
// so different targets showcase different reachability outcomes (reachable / refused / VPN) reproducibly.
function reachabilityMockBucket(key: string | undefined, buckets: number): number {
  const text = `${key ?? ""}`;
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return buckets > 0 ? hash % buckets : 0;
}

async function mockReachabilityObservations(
  view: EngineProbeView,
  facts: ReachabilityFacts,
  request: ReachabilityProbeRequest,
): Promise<ReachabilityObservations> {
  await sleep(MOCK_REACHABILITY_PROBE_DELAY_MS);
  const cport = facts.target.containerPort ?? 0;
  const hostPort = facts.target.hostPort ?? 0;
  switch (facts.checkType) {
    case "published-port": {
      if (facts.transport === "ssh") {
        const remoteIp = `${facts.remoteHostLabel ?? ""}`.split("@").pop() || "the remote host";
        return {
          elapsedMs: 300,
          hostDial: { ok: false, detail: "Connection refused — nothing bound locally" },
          portMapping: { ok: true, detail: `${cport}/tcp → 0.0.0.0:${hostPort} on ${remoteIp}` },
          remoteDial: { ok: true, detail: "HTTP/1.1 200 OK" },
          sshTunnel: { ok: true, detail: `up · ${facts.remoteHostLabel} · 22 ms` },
        };
      }
      const vmForward = facts.transport === "vm" ? { ok: true, detail: "active · host → VM" } : undefined;
      const refused = reachabilityMockBucket(request.targetContainerId, 3) === 0;
      if (refused) {
        return {
          elapsedMs: 420,
          hostDial: { ok: false, detail: "curl: (56) Recv failure: Connection reset by peer" },
          portMapping: { ok: true, detail: `${cport}/tcp → 0.0.0.0:${hostPort}` },
          vmForward,
          containerPing: { ok: true, detail: "reachable · 0.3 ms" },
          listeningInside: { bind: "loopback", detail: `LISTEN 127.0.0.1:${cport}  ← localhost only` },
        };
      }
      return {
        elapsedMs: 110,
        hostDial: { ok: true, detail: "HTTP/1.1 200 OK · 3 ms" },
        portMapping: { ok: true, detail: `${cport}/tcp → 0.0.0.0:${hostPort}` },
        vmForward,
        containerPing: { ok: true, detail: "reachable · 0.3 ms" },
        listeningInside: { bind: "all", detail: `LISTEN 0.0.0.0:${cport}` },
      };
    }
    case "service-to-service": {
      const fromNetworks = reachabilityNetworksOf(
        findContainer(view, request.connectionId, request.fromContainerId ?? ""),
      );
      const targetNetworks = reachabilityNetworksOf(
        findContainer(view, request.connectionId, request.targetContainerId ?? ""),
      );
      const shared = fromNetworks.some((net) => targetNetworks.includes(net));
      return {
        elapsedMs: 200,
        nameResolves: { ok: shared, detail: shared ? (fromNetworks[0] ?? "resolved") : "(not found)" },
        fromNetworks,
        targetNetworks,
      };
    }
    case "reach-out": {
      const vpn = reachabilityMockBucket(request.externalHost || request.fromContainerId, 3) === 0;
      if (vpn) {
        return {
          elapsedMs: 3100,
          egress: { ok: false, detail: "timed out after 3s" },
          egressDns: { ok: true, detail: "34.196.0.0 (DNS is fine)" },
          route: { viaVpn: true, dev: "utun4", detail: "dev utun4" },
          tunnels: [{ name: "utun4", app: "AnyConnect", routes: ["0.0.0.0/1", "128.0.0.0/1"] }],
        };
      }
      return {
        elapsedMs: 180,
        egress: { ok: true, detail: "HTTP/1.1 200 OK" },
        egressDns: { ok: true, detail: "resolved" },
        route: { viaVpn: false },
      };
    }
    case "dns-lookup": {
      const name = `${request.lookupName ?? ""}`;
      const resolves = name.length > 0 && !/nope|bogus|does-not-exist|invalid/i.test(name);
      return { elapsedMs: 120, nameResolves: { ok: resolves, detail: resolves ? "resolved" : "(not found)" } };
    }
    default:
      return { elapsedMs: 0 };
  }
}

async function gatherReachabilityObservations(
  view: EngineProbeView,
  facts: ReachabilityFacts,
  request: ReachabilityProbeRequest,
): Promise<ReachabilityObservations> {
  const host = view.hosts.get(request.connectionId);
  if (!host) {
    return { elapsedMs: 0 };
  }
  const { engine } = facts;
  const fromId = request.fromContainerId ?? "";
  const targetId = request.targetContainerId ?? "";
  const cport = facts.target.containerPort ?? 0;
  const hostPort = facts.target.hostPort ?? 0;
  switch (facts.checkType) {
    case "published-port": {
      const listeningInside = await probeContainerListening(host, engine, targetId, cport);
      return {
        elapsedMs: 0,
        portMapping: { ok: true, detail: `${cport}/tcp → 0.0.0.0:${hostPort}` },
        vmForward: facts.transport === "vm" ? { ok: true, detail: "active · host → VM" } : undefined,
        containerPing: { ok: true },
        listeningInside,
      };
    }
    case "service-to-service": {
      const nameResolves = await probeContainerResolves(host, engine, fromId, facts.target.serviceName ?? "");
      return {
        elapsedMs: 0,
        nameResolves,
        fromNetworks: reachabilityNetworksOf(findContainer(view, request.connectionId, fromId)),
        targetNetworks: reachabilityNetworksOf(findContainer(view, request.connectionId, targetId)),
      };
    }
    case "reach-out": {
      const target = facts.target.externalHost ?? "";
      const [egress, egressDns] = await Promise.all([
        probeContainerEgress(host, engine, fromId, target, facts.target.externalPort ?? 443),
        probeContainerResolves(host, engine, fromId, target),
      ]);
      return { elapsedMs: 0, egress, egressDns };
    }
    case "dns-lookup": {
      const nameResolves = await probeContainerResolves(
        host,
        engine,
        fromId,
        facts.target.lookupName ?? facts.target.serviceName ?? "",
      );
      return { elapsedMs: 0, nameResolves };
    }
    default:
      return { elapsedMs: 0 };
  }
}

// Run a probe INSIDE a container via the engine's own `exec` (podman/docker are cross-platform binaries, so
// this is safe on a Windows host); the `sh -lc` shell runs in the always-Linux container, not on the host.
async function runReachabilityExec(
  host: HostClientFacade,
  engine: string,
  containerId: string,
  script: string,
): Promise<CommandExecutionResult | undefined> {
  if (!containerId) {
    return undefined;
  }
  const argv = ["exec", containerId, "sh", "-lc", script];
  const run = host.isScoped()
    ? host
        .getSettings()
        .then((settings) => host.runScopeCommand(engine, argv, settings.controller?.scope || "", settings))
    : host.runHostCommand(engine, argv);
  return await settleWithin(
    run.then((result) => result).catch(() => undefined),
    REACHABILITY_PROBE_TIMEOUT_MS,
  );
}

async function probeContainerListening(
  host: HostClientFacade,
  engine: string,
  containerId: string,
  cport: number,
): Promise<ListenOutcome> {
  const result = await runReachabilityExec(
    host,
    engine,
    containerId,
    "ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || true",
  );
  return parseListeningBind(`${result?.stdout ?? ""}`, cport);
}

async function probeContainerResolves(
  host: HostClientFacade,
  engine: string,
  containerId: string,
  name: string,
): Promise<ProbeOutcome> {
  if (!name) {
    return { ok: false, detail: "no name" };
  }
  const result = await runReachabilityExec(
    host,
    engine,
    containerId,
    `getent hosts ${singleQuotePosix(name)} 2>/dev/null || true`,
  );
  const line = firstOutputLine(result?.stdout);
  const ok = Boolean(result?.success) && Boolean(line);
  return { ok, detail: ok ? line : "(not found)" };
}

async function probeContainerEgress(
  host: HostClientFacade,
  engine: string,
  containerId: string,
  target: string,
  port: number,
): Promise<ProbeOutcome> {
  if (!target) {
    return { ok: false, detail: "no target" };
  }
  const script = `curl -sS -m3 -o /dev/null -w '%{http_code}' https://${target}:${port} 2>&1 || true`;
  const result = await runReachabilityExec(host, engine, containerId, script);
  const output = firstOutputLine(result?.stdout) ?? "";
  const ok = /^[23]\d\d$/.test(output);
  return { ok, detail: ok ? `HTTP ${output}` : output || "timed out" };
}
