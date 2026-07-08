// Reachability debugger — the transport-aware trace assembler. Pure + node-free (shared by the renderer and the
// main-process prober). Given the resolved facts (what we're asking) + observations (what the probes found), it
// produces the ChainPipe hops, the verdict pill, the plain-language diagnosis (with a copyable fix), and the
// "What I checked" probe log. The diagnostic reasoning lives HERE (not in the prober) so it is unit-tested; the
// prober only gathers observations. Headline/explanation carry inline `code` spans as markdown backticks.

import type {
  ReachabilityCheckType,
  ReachabilityDiagnosis,
  ReachabilityHop,
  ReachabilityProbe,
  ReachabilityReport,
  ReachabilityTransport,
  ReachabilityVerdict,
} from "./model";

export interface ProbeOutcome {
  ok: boolean;
  detail?: string;
  ms?: number;
}
export interface ListenOutcome {
  bind: "all" | "loopback" | "none" | "unknown";
  detail?: string;
}
export interface RouteOutcome {
  viaVpn?: boolean;
  dev?: string;
  detail?: string;
}
export interface TunnelOutcome {
  name: string;
  app?: string;
  routes?: string[];
}

export interface ReachabilityFacts {
  checkType: ReachabilityCheckType;
  transport: ReachabilityTransport;
  engine: string; // "podman" | "docker" | "container"
  connectionName: string;
  remoteHostLabel?: string; // ssh: "root@10.0.0.42"
  from: { kind: "host" | "container"; label: string; containerIp?: string };
  target: {
    containerName?: string;
    containerIp?: string;
    hostPort?: number;
    containerPort?: number;
    protocol?: string;
    serviceName?: string;
    externalHost?: string;
    externalPort?: number;
    lookupName?: string;
  };
}

export interface ReachabilityObservations {
  elapsedMs: number;
  // published-port / ssh-remote
  hostDial?: ProbeOutcome;
  portMapping?: ProbeOutcome;
  vmForward?: ProbeOutcome;
  containerPing?: ProbeOutcome;
  listeningInside?: ListenOutcome;
  remoteDial?: ProbeOutcome;
  sshTunnel?: ProbeOutcome;
  // service-to-service / dns-lookup
  nameResolves?: ProbeOutcome;
  fromNetworks?: string[];
  targetNetworks?: string[];
  // reach-out
  egress?: ProbeOutcome;
  egressDns?: ProbeOutcome;
  route?: RouteOutcome;
  tunnels?: TunnelOutcome[];
}

type ReportCore = Omit<ReachabilityReport, "probeSummary">;

const engineDnsName = (engine: string): string => (engine === "podman" ? "aardvark-dns" : "embedded DNS");
const remoteIpOf = (label?: string): string => `${label ?? ""}`.split("@").pop() || `${label ?? ""}`;
const dial = (ok: boolean): "ok" | "err" => (ok ? "ok" : "err");

// container IP → a /16 CIDR guess, for the VPN split-tunnel fix hint (best-effort, host-side subnet isn't gathered).
const guessSubnet = (ip?: string): string => {
  const octets = `${ip ?? ""}`.split(".");
  return octets.length === 4 ? `${octets[0]}.${octets[1]}.0.0/16` : "your container subnet";
};

function buildPublishedPort(facts: ReachabilityFacts, obs: ReachabilityObservations): ReportCore {
  const { engine, transport, target } = facts;
  const cport = target.containerPort ?? 0;
  const hostPort = target.hostPort ?? 0;
  const container = target.containerName ?? "the container";

  // SSH-remote is its own flow: the SSH connection tunnels the API only, so `-p` binds on the REMOTE host and
  // `localhost` on the laptop reaches nothing. The remote hops nest inside the dashed "remote host" wrapper.
  if (transport === "ssh") {
    const remoteHost = facts.remoteHostLabel ?? "the remote host";
    const remoteIp = remoteIpOf(facts.remoteHostLabel);
    const hops: ReachabilityHop[] = [
      { id: "host", icon: "desktop", name: facts.from.label, meta: "your laptop · nothing bound", state: "warn" },
      { id: "ssh", icon: "globe-network", name: "SSH tunnel", meta: "API only", state: "ok", remote: true },
      {
        id: "remote-port",
        icon: "import",
        name: `:${hostPort} on remote`,
        meta: `0.0.0.0:${hostPort} (there)`,
        state: "ok",
        remote: true,
      },
      { id: "container", icon: "tick", name: `${container}:${cport}`, meta: "listening", state: "ok", remote: true },
    ];
    const verdict: ReachabilityVerdict = { tone: "warn", text: "Published on the remote host, not your laptop" };
    const diagnosis: ReachabilityDiagnosis = {
      tone: "warn",
      icon: "warning-sign",
      headline: `The engine is remote — the port is published on \`${remoteIp}\`, not your laptop`,
      explanation: `The SSH connection tunnels the ${engine} API only, not published ports. \`-p ${hostPort}:${cport}\` bound \`0.0.0.0:${hostPort}\` on the remote host, where \`${container}\` is listening — so \`${facts.from.label}\` here reaches nothing. Open it on the remote IP, or forward the port over SSH.`,
      fixCommand: `ssh -L ${hostPort}:localhost:${hostPort} ${remoteHost}`,
      actions: [
        { id: "forward-ssh", icon: "data-connection", text: `Forward ${hostPort} over SSH`, primary: true },
        {
          id: "open-remote",
          icon: "globe",
          text: `Open http://${remoteIp}:${hostPort}`,
          href: `http://${remoteIp}:${hostPort}`,
        },
      ],
      learnMore: true,
    };
    const probes: ReachabilityProbe[] = [
      {
        id: "host-dial",
        command: `curl -sS -m2 http://localhost:${hostPort}  (laptop)`,
        result: obs.hostDial?.detail ?? "Connection refused — nothing bound locally",
        state: "warn",
      },
      {
        id: "port-mapping",
        command: `${engine} -r port ${container}  (remote)`,
        result: obs.portMapping?.detail ?? `${cport}/tcp → 0.0.0.0:${hostPort}`,
        state: "ok",
      },
      {
        id: "remote-dial",
        command: `ssh ${remoteHost} curl -sS localhost:${hostPort}`,
        result: obs.remoteDial?.detail ?? "HTTP/1.1 200 OK",
        state: "ok",
        smoking: "warn",
      },
      { id: "ssh-tunnel", command: "ssh tunnel (API)", result: obs.sshTunnel?.detail ?? "up", state: "ok" },
    ];
    return {
      verdict,
      pathLabel: "laptop → SSH → remote host → container",
      hops,
      diagnosis,
      probes,
      remoteLabel: `remote host · ${remoteHost}`,
    };
  }

  // Local flows (native / vm / wsl): host → port binding → [VM|WSL relay] → engine net → container. The break is
  // "bound to loopback inside the container" (nothing on 0.0.0.0), the most-cited published-port pain.
  const boundOk = obs.listeningInside ? obs.listeningInside.bind === "all" : true;
  const hops: ReachabilityHop[] = [
    { id: "host", icon: "desktop", name: facts.from.label, meta: "host client", state: "ok" },
    { id: "port", icon: "import", name: "Port binding", meta: `0.0.0.0:${hostPort}`, state: "ok" },
  ];
  if (transport === "vm") {
    hops.push({
      id: "vm",
      icon: "heat-grid",
      name: "VM forward",
      meta: obs.vmForward?.detail ?? "gvproxy",
      state: "ok",
    });
  } else if (transport === "wsl") {
    hops.push({ id: "wsl", icon: "heat-grid", name: "WSL relay", meta: "localhost", state: "ok" });
  }
  hops.push({
    id: "net",
    icon: "graph",
    name: `${engine} net`,
    meta: target.containerIp ?? "container",
    state: "ok",
  });
  hops.push({
    id: "container",
    icon: boundOk ? "tick" : "cross",
    name: `:${cport} in ${container}`,
    meta: boundOk ? "listening" : "refused",
    state: boundOk ? "ok" : "err",
  });

  const pathLabel =
    transport === "vm" ? "host → VM → container" : transport === "wsl" ? "host → WSL → container" : "host → container";
  const probes: ReachabilityProbe[] = [
    {
      id: "host-dial",
      command: `curl -sS -m2 http://localhost:${hostPort}`,
      result: obs.hostDial?.detail ?? (boundOk ? "HTTP/1.1 200 OK" : "Connection reset by peer"),
      state: dial(obs.hostDial?.ok ?? boundOk),
    },
    {
      id: "port-mapping",
      command: `${engine} port ${container}`,
      result: obs.portMapping?.detail ?? `${cport}/tcp → 0.0.0.0:${hostPort}`,
      state: "ok",
    },
  ];
  if (transport === "vm") {
    probes.push({
      id: "vm-forward",
      command: `gvproxy forward ${hostPort}`,
      result: obs.vmForward?.detail ?? "active · host → VM",
      state: "ok",
    });
  }
  probes.push({
    id: "container-ping",
    command: `ping -c1 ${target.containerIp ?? "the container"}`,
    result: obs.containerPing?.detail ?? "reachable",
    state: "ok",
  });
  probes.push({
    id: "listening-inside",
    command: `${engine} exec ${container} ss -tlnp`,
    result:
      obs.listeningInside?.detail ??
      (boundOk ? `LISTEN 0.0.0.0:${cport}` : `LISTEN 127.0.0.1:${cport}  ← localhost only`),
    state: boundOk ? "ok" : "err",
    smoking: boundOk ? undefined : "err",
  });

  if (boundOk) {
    return {
      verdict: { tone: "ok", text: "Reachable end-to-end" },
      pathLabel,
      hops,
      diagnosis: {
        tone: "ok",
        icon: "tick-circle",
        headline: "Reachable end-to-end",
        explanation: `\`${facts.from.label}\` reaches \`${container}:${cport}\`; the service is listening on \`0.0.0.0:${cport}\` and answered. Nothing to fix.`,
        actions: [],
      },
      probes,
    };
  }
  return {
    verdict: { tone: "err", text: "Refused at the container" },
    pathLabel,
    hops,
    diagnosis: {
      tone: "err",
      icon: "error",
      headline: `Nothing is listening on \`0.0.0.0:${cport}\` inside \`${container}\``,
      explanation: `The forward reaches the container fine, but the service is bound to \`127.0.0.1:${cport}\` — so it rejects the connection arriving on the container's network interface. Bind the service to \`0.0.0.0\` (all interfaces).`,
      fixCommand: `listen 0.0.0.0:${cport}   # in ${container}'s app/server bind config`,
      actions: [{ id: "open-config", icon: "manually-entered-data", text: `Open ${container} config`, primary: true }],
      learnMore: true,
    },
    probes,
  };
}

function buildServiceToService(facts: ReachabilityFacts, obs: ReachabilityObservations): ReportCore {
  const { engine } = facts;
  const service = facts.target.serviceName ?? "the service";
  const cport = facts.target.containerPort ?? 0;
  const fromNetworks = obs.fromNetworks ?? [];
  const targetNetworks = obs.targetNetworks ?? [];
  const shared = fromNetworks.some((net) => targetNetworks.includes(net));
  const resolved = obs.nameResolves ? obs.nameResolves.ok : shared;

  const hops: ReachabilityHop[] = [
    {
      id: "from",
      icon: "cube",
      name: facts.from.label,
      meta: fromNetworks[0] ? `on ${fromNetworks[0]}` : undefined,
      state: "ok",
    },
    { id: "dns", icon: "search-template", name: engineDnsName(engine), meta: "up", state: "ok" },
    {
      id: "resolve",
      icon: resolved ? "tick" : "cross",
      name: `resolve "${service}"`,
      meta: resolved ? "resolved" : "NXDOMAIN",
      state: resolved ? "ok" : "err",
    },
    {
      id: "service",
      icon: "cube",
      name: `${service}:${cport}`,
      meta: resolved ? "reachable" : "—",
      state: resolved ? "ok" : "dead",
    },
  ];
  const probes: ReachabilityProbe[] = [
    {
      id: "getent",
      command: `${engine} exec ${facts.from.label} getent hosts ${service}`,
      result: obs.nameResolves?.detail ?? (resolved ? (fromNetworks[0] ?? "resolved") : "(not found)"),
      state: resolved ? "ok" : "err",
      smoking: resolved ? undefined : "err",
    },
    {
      id: "from-nets",
      command: `networks of ${facts.from.label}`,
      result: fromNetworks.join(", ") || "—",
      state: "ok",
    },
    {
      id: "target-nets",
      command: `networks of ${service}`,
      result: `${targetNetworks.join(", ") || "—"}${shared ? "" : `  ← not shared with ${facts.from.label}`}`,
      state: shared ? "ok" : "warn",
      smoking: shared ? undefined : "warn",
    },
    { id: "shared", command: "shared network?", result: shared ? "yes" : "none", state: shared ? "ok" : "err" },
  ];
  if (resolved) {
    return {
      verdict: { tone: "ok", text: "Resolves and reachable" },
      pathLabel: "container → container",
      hops,
      diagnosis: {
        tone: "ok",
        icon: "tick-circle",
        headline: `\`${facts.from.label}\` can reach \`${service}\``,
        explanation: `\`${service}\` resolves on a network shared with \`${facts.from.label}\` and answered on port ${cport}. Nothing to fix.`,
        actions: [],
      },
      probes,
    };
  }
  return {
    verdict: { tone: "err", text: "Name doesn't resolve" },
    pathLabel: "container → container",
    hops,
    diagnosis: {
      tone: "err",
      icon: "error",
      headline: `\`${service}\` and \`${facts.from.label}\` aren't on a shared network`,
      explanation: `${engine}'s DNS only resolves container names within the same network. \`${facts.from.label}\` is on \`${fromNetworks.join(", ") || "no network"}\`; \`${service}\` is only on \`${targetNetworks.join(", ") || "another network"}\` — no overlap, so the name can't resolve. Attach one to the other's network.`,
      fixCommand: `${engine} network connect ${fromNetworks[0] ?? "<network>"} ${service}`,
      actions: [
        {
          id: "connect",
          icon: "link",
          text: `Connect ${service} to ${fromNetworks[0] ?? "the network"}`,
          primary: true,
        },
      ],
      learnMore: true,
    },
    probes,
  };
}

function buildReachOut(facts: ReachabilityFacts, obs: ReachabilityObservations): ReportCore {
  const { engine } = facts;
  const host = facts.target.externalHost ?? "the host";
  const port = facts.target.externalPort ?? 443;
  const fromIp = facts.from.containerIp ?? facts.target.containerIp;
  const viaVpn = obs.route?.viaVpn ?? false;
  const dev = obs.route?.dev ?? "utun";
  const tunnel = obs.tunnels?.[0];
  const egressOk = obs.egress?.ok ?? !viaVpn;

  const hops: ReachabilityHop[] = [
    { id: "from", icon: "cube", name: facts.from.label, meta: fromIp, state: "ok" },
    {
      id: "dns",
      icon: "search-template",
      name: "DNS",
      meta: obs.egressDns?.ok === false ? "fail" : "resolves",
      state: obs.egressDns?.ok === false ? "err" : "ok",
    },
    { id: "gateway", icon: "graph", name: "net gateway", meta: undefined, state: "ok" },
    {
      id: "route",
      icon: viaVpn ? "shield" : "globe",
      name: "host route",
      meta: viaVpn ? `captured by ${dev}` : "direct",
      state: viaVpn ? "err" : "ok",
    },
    {
      id: "external",
      icon: "globe",
      name: host,
      meta: egressOk ? "reachable" : "— timeout",
      state: egressOk ? "ok" : "dead",
    },
  ];
  const probes: ReachabilityProbe[] = [
    {
      id: "egress",
      command: `${engine} exec ${facts.from.label} curl -sS -m3 https://${host}`,
      result: obs.egress?.detail ?? (egressOk ? "HTTP/1.1 200 OK" : "timed out after 3s"),
      state: dial(egressOk),
    },
    {
      id: "egress-dns",
      command: `${engine} exec ${facts.from.label} getent hosts ${host}`,
      result: obs.egressDns?.detail ?? "resolved (DNS is fine)",
      state: "ok",
    },
  ];
  if (viaVpn) {
    probes.push({
      id: "route",
      command: `ip route get ${fromIp ?? host}`,
      result: `${obs.route?.detail ?? `dev ${dev}`}  ← via VPN, not the bridge`,
      state: "err",
      smoking: "err",
    });
    probes.push({
      id: "tunnels",
      command: "active tunnels",
      result: tunnel ? `${tunnel.name} · ${tunnel.app ?? "VPN"} · routes ${(tunnel.routes ?? []).join(", ")}` : "none",
      state: "warn",
      smoking: "warn",
    });
    return {
      verdict: { tone: "err", text: "Blackholed by VPN" },
      pathLabel: "container → internet",
      hops,
      diagnosis: {
        tone: "err",
        icon: "error",
        headline: "A VPN is capturing your container subnet",
        explanation: `\`${dev}\`${tunnel?.app ? ` (${tunnel.app})` : ""} installed full-tunnel routes ${(tunnel?.routes ?? ["0.0.0.0/1", "128.0.0.0/1"]).join(" + ")}, which swallow traffic leaving your container's subnet — so container egress is dropped while the VPN is up. Add a split-tunnel exclusion, or move the network onto a range the VPN doesn't claim.`,
        fixCommand: `sudo route -n add -net ${guessSubnet(fromIp)} -interface bridge100`,
        actions: [{ id: "resubnet", icon: "graph", text: `Re-subnet ${engine} net`, primary: true }],
        learnMore: true,
      },
      probes,
    };
  }
  return {
    verdict: egressOk ? { tone: "ok", text: `Reachable · ${host}` } : { tone: "err", text: "Unreachable" },
    pathLabel: "container → internet",
    hops,
    diagnosis: egressOk
      ? {
          tone: "ok",
          icon: "tick-circle",
          headline: `\`${facts.from.label}\` can reach \`${host}\``,
          explanation: `Egress to \`${host}:${port}\` succeeded — DNS resolved and the route left the container network cleanly. Nothing to fix.`,
          actions: [],
        }
      : {
          tone: "err",
          icon: "error",
          headline: `\`${facts.from.label}\` can't reach \`${host}\``,
          explanation:
            obs.egress?.detail ??
            `The connection to \`${host}:${port}\` failed. Check the container's egress route and DNS.`,
          actions: [],
          learnMore: true,
        },
    probes,
  };
}

function buildDnsLookup(facts: ReachabilityFacts, obs: ReachabilityObservations): ReportCore {
  const { engine } = facts;
  const name = facts.target.lookupName ?? facts.target.serviceName ?? "the name";
  const resolved = obs.nameResolves?.ok ?? false;
  const hops: ReachabilityHop[] = [
    { id: "from", icon: "cube", name: facts.from.label, state: "ok" },
    { id: "dns", icon: "search-template", name: engineDnsName(engine), meta: "up", state: "ok" },
    {
      id: "resolve",
      icon: resolved ? "tick" : "cross",
      name: `resolve "${name}"`,
      meta: resolved ? (obs.nameResolves?.detail ?? "resolved") : "NXDOMAIN",
      state: resolved ? "ok" : "err",
    },
  ];
  const probes: ReachabilityProbe[] = [
    {
      id: "getent",
      command: `${engine} exec ${facts.from.label} getent hosts ${name}`,
      result: obs.nameResolves?.detail ?? (resolved ? "resolved" : "(not found)"),
      state: resolved ? "ok" : "err",
      smoking: resolved ? undefined : "err",
    },
  ];
  return {
    verdict: resolved ? { tone: "ok", text: "Resolves" } : { tone: "err", text: "Name doesn't resolve" },
    pathLabel: "container → DNS",
    hops,
    diagnosis: resolved
      ? {
          tone: "ok",
          icon: "tick-circle",
          headline: `\`${name}\` resolves`,
          explanation: `\`${facts.from.label}\` resolved \`${name}\` via ${engineDnsName(engine)}. Nothing to fix.`,
          actions: [],
        }
      : {
          tone: "err",
          icon: "error",
          headline: `\`${name}\` does not resolve from \`${facts.from.label}\``,
          explanation: `The lookup returned NXDOMAIN. If it's a container name, attach both containers to a shared network; if it's an external name, check the container's DNS servers.`,
          actions: [],
          learnMore: true,
        },
    probes,
  };
}

const BUILDERS: Record<ReachabilityCheckType, (facts: ReachabilityFacts, obs: ReachabilityObservations) => ReportCore> =
  {
    "published-port": buildPublishedPort,
    "service-to-service": buildServiceToService,
    "reach-out": buildReachOut,
    "dns-lookup": buildDnsLookup,
  };

export function buildReachabilityReport(facts: ReachabilityFacts, obs: ReachabilityObservations): ReachabilityReport {
  const core = BUILDERS[facts.checkType](facts, obs);
  const seconds = Math.max(0, obs.elapsedMs) / 1000;
  const probeSummary = `${core.probes.length} ${core.probes.length === 1 ? "probe" : "probes"} · ${seconds.toFixed(1)} s`;
  // The connection is the head of the path (e.g. "System Docker → host → container") — it owns the trace, so it
  // reads as the first leg rather than a separate badge.
  return { ...core, pathLabel: `${facts.connectionName} → ${core.pathLabel}`, probeSummary };
}
