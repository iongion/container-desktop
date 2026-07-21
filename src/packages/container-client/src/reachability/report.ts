// Reachability debugger — the transport-aware trace assembler. Pure + node-free (shared by the renderer and the
// main-process prober). Given the resolved facts (what we're asking) + observations (what the probes found), it
// produces the ChainPipe hops, the verdict pill, the plain-language diagnosis (with a copyable fix), and the
// "What I checked" probe log. The diagnostic reasoning lives HERE (not in the prober) so it is unit-tested; the
// prober only gathers observations. Headline/explanation carry inline `code` spans as markdown backticks.

import i18n from "@/i18n";

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

const engineDnsName = (engine: string): string =>
  engine === "podman" ? i18n.t("aardvark-dns") : i18n.t("embedded DNS");
const remoteIpOf = (label?: string): string => `${label ?? ""}`.split("@").pop() || `${label ?? ""}`;
const dial = (ok: boolean): "ok" | "err" => (ok ? "ok" : "err");

// container IP → a /16 CIDR guess, for the VPN split-tunnel fix hint (best-effort, host-side subnet isn't gathered).
const guessSubnet = (ip?: string): string => {
  const octets = `${ip ?? ""}`.split(".");
  return octets.length === 4 ? `${octets[0]}.${octets[1]}.0.0/16` : i18n.t("your container subnet");
};

function buildPublishedPort(facts: ReachabilityFacts, obs: ReachabilityObservations): ReportCore {
  const { engine, transport, target } = facts;
  const cport = target.containerPort ?? 0;
  const hostPort = target.hostPort ?? 0;
  const container = target.containerName ?? i18n.t("the container");

  // SSH-remote is its own flow: the SSH connection tunnels the API only, so `-p` binds on the REMOTE host and
  // `localhost` on the laptop reaches nothing. The remote hops nest inside the dashed "remote host" wrapper.
  if (transport === "ssh") {
    const remoteHost = facts.remoteHostLabel ?? i18n.t("the remote host");
    const remoteIp = remoteIpOf(facts.remoteHostLabel);
    const hops: ReachabilityHop[] = [
      {
        id: "host",
        icon: "desktop",
        name: facts.from.label,
        meta: i18n.t("your laptop · nothing bound"),
        state: "warn",
      },
      {
        id: "ssh",
        icon: "globe-network",
        name: i18n.t("SSH tunnel"),
        meta: i18n.t("API only"),
        state: "ok",
        remote: true,
      },
      {
        id: "remote-port",
        icon: "import",
        name: i18n.t(":{{hostPort}} on remote", { hostPort }),
        meta: i18n.t("0.0.0.0:{{hostPort}} (there)", { hostPort }),
        state: "ok",
        remote: true,
      },
      {
        id: "container",
        icon: "tick",
        name: i18n.t("{{container}}:{{containerPort}}", { container, containerPort: cport }),
        meta: i18n.t("listening"),
        state: "ok",
        remote: true,
      },
    ];
    const verdict: ReachabilityVerdict = {
      tone: "warn",
      text: i18n.t("Published on the remote host, not your laptop"),
    };
    const diagnosis: ReachabilityDiagnosis = {
      tone: "warn",
      icon: "warning-sign",
      headline: i18n.t("The engine is remote — the port is published on `{{remoteIp}}`, not your laptop", {
        remoteIp,
      }),
      explanation: i18n.t(
        "The SSH connection tunnels the {{engine}} API only, not published ports. `-p {{hostPort}}:{{containerPort}}` bound `0.0.0.0:{{hostPort}}` on the remote host, where `{{container}}` is listening — so `{{from}}` here reaches nothing. Open it on the remote IP, or forward the port over SSH.",
        { engine, hostPort, containerPort: cport, container, from: facts.from.label },
      ),
      fixCommand: `ssh -L ${hostPort}:localhost:${hostPort} ${remoteHost}`,
      actions: [
        {
          id: "forward-ssh",
          icon: "data-connection",
          text: i18n.t("Forward {{hostPort}} over SSH", { hostPort }),
          primary: true,
        },
        {
          id: "open-remote",
          icon: "globe",
          text: i18n.t("Open http://{{remoteIp}}:{{hostPort}}", { remoteIp, hostPort }),
          href: `http://${remoteIp}:${hostPort}`,
        },
      ],
      learnMore: true,
    };
    const probes: ReachabilityProbe[] = [
      {
        id: "host-dial",
        command: `curl -sS -m2 http://localhost:${hostPort}  (laptop)`,
        result: obs.hostDial?.detail ?? i18n.t("Connection refused — nothing bound locally"),
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
        result: obs.remoteDial?.detail ?? i18n.t("HTTP/1.1 200 OK"),
        state: "ok",
        smoking: "warn",
      },
      {
        id: "ssh-tunnel",
        command: "ssh tunnel (API)",
        result: obs.sshTunnel?.detail ?? i18n.t("up"),
        state: "ok",
      },
    ];
    return {
      verdict,
      pathLabel: i18n.t("laptop → SSH → remote host → container"),
      hops,
      diagnosis,
      probes,
      remoteLabel: i18n.t("remote host · {{remoteHost}}", { remoteHost }),
    };
  }

  // Local flows (native / vm / wsl): host → port binding → [VM|WSL relay] → engine net → container. The break is
  // "bound to loopback inside the container" (nothing on 0.0.0.0), the most-cited published-port pain.
  const boundOk = obs.listeningInside ? obs.listeningInside.bind === "all" : true;
  const hops: ReachabilityHop[] = [
    { id: "host", icon: "desktop", name: facts.from.label, meta: i18n.t("host client"), state: "ok" },
    {
      id: "port",
      icon: "import",
      name: i18n.t("Port binding"),
      meta: `0.0.0.0:${hostPort}`,
      state: "ok",
    },
  ];
  if (transport === "vm") {
    hops.push({
      id: "vm",
      icon: "heat-grid",
      name: i18n.t("VM forward"),
      meta: obs.vmForward?.detail ?? i18n.t("gvproxy"),
      state: "ok",
    });
  } else if (transport === "wsl") {
    hops.push({ id: "wsl", icon: "heat-grid", name: i18n.t("WSL relay"), meta: i18n.t("localhost"), state: "ok" });
  }
  hops.push({
    id: "net",
    icon: "graph",
    name: i18n.t("{{engine}} net", { engine }),
    meta: target.containerIp ?? i18n.t("container"),
    state: "ok",
  });
  hops.push({
    id: "container",
    icon: boundOk ? "tick" : "cross",
    name: i18n.t(":{{containerPort}} in {{container}}", { containerPort: cport, container }),
    meta: boundOk ? i18n.t("listening") : i18n.t("refused"),
    state: boundOk ? "ok" : "err",
  });

  const pathLabel =
    transport === "vm"
      ? i18n.t("host → VM → container")
      : transport === "wsl"
        ? i18n.t("host → WSL → container")
        : i18n.t("host → container");
  const probes: ReachabilityProbe[] = [
    {
      id: "host-dial",
      command: `curl -sS -m2 http://localhost:${hostPort}`,
      result: obs.hostDial?.detail ?? (boundOk ? i18n.t("HTTP/1.1 200 OK") : i18n.t("Connection reset by peer")),
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
      result: obs.vmForward?.detail ?? i18n.t("active · host → VM"),
      state: "ok",
    });
  }
  probes.push({
    id: "container-ping",
    command: `ping -c1 ${target.containerIp ?? i18n.t("the container")}`,
    result: obs.containerPing?.detail ?? i18n.t("reachable"),
    state: "ok",
  });
  probes.push({
    id: "listening-inside",
    command: `${engine} exec ${container} ss -tlnp`,
    result:
      obs.listeningInside?.detail ??
      (boundOk
        ? i18n.t("LISTEN 0.0.0.0:{{containerPort}}", { containerPort: cport })
        : i18n.t("LISTEN 127.0.0.1:{{containerPort}}  ← localhost only", { containerPort: cport })),
    state: boundOk ? "ok" : "err",
    smoking: boundOk ? undefined : "err",
  });

  if (boundOk) {
    return {
      verdict: { tone: "ok", text: i18n.t("Reachable end-to-end") },
      pathLabel,
      hops,
      diagnosis: {
        tone: "ok",
        icon: "tick-circle",
        headline: i18n.t("Reachable end-to-end"),
        explanation: i18n.t(
          "`{{from}}` reaches `{{container}}:{{containerPort}}`; the service is listening on `0.0.0.0:{{containerPort}}` and answered. Nothing to fix.",
          { from: facts.from.label, container, containerPort: cport },
        ),
        actions: [],
      },
      probes,
    };
  }
  return {
    verdict: { tone: "err", text: i18n.t("Refused at the container") },
    pathLabel,
    hops,
    diagnosis: {
      tone: "err",
      icon: "error",
      headline: i18n.t("Nothing is listening on `0.0.0.0:{{containerPort}}` inside `{{container}}`", {
        containerPort: cport,
        container,
      }),
      explanation: i18n.t(
        "The forward reaches the container fine, but the service is bound to `127.0.0.1:{{containerPort}}` — so it rejects the connection arriving on the container's network interface. Bind the service to `0.0.0.0` (all interfaces).",
        { containerPort: cport },
      ),
      fixCommand: `listen 0.0.0.0:${cport}   # in ${container}'s app/server bind config`,
      actions: [
        {
          id: "open-config",
          icon: "manually-entered-data",
          text: i18n.t("Open {{container}} config", { container }),
          primary: true,
        },
      ],
      learnMore: true,
    },
    probes,
  };
}

function buildServiceToService(facts: ReachabilityFacts, obs: ReachabilityObservations): ReportCore {
  const { engine } = facts;
  const service = facts.target.serviceName ?? i18n.t("the service");
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
      meta: fromNetworks[0] ? i18n.t("on {{network}}", { network: fromNetworks[0] }) : undefined,
      state: "ok",
    },
    { id: "dns", icon: "search-template", name: engineDnsName(engine), meta: i18n.t("up"), state: "ok" },
    {
      id: "resolve",
      icon: resolved ? "tick" : "cross",
      name: i18n.t('resolve "{{service}}"', { service }),
      meta: resolved ? i18n.t("resolved") : i18n.t("NXDOMAIN"),
      state: resolved ? "ok" : "err",
    },
    {
      id: "service",
      icon: "cube",
      name: `${service}:${cport}`,
      meta: resolved ? i18n.t("reachable") : "—",
      state: resolved ? "ok" : "dead",
    },
  ];
  const probes: ReachabilityProbe[] = [
    {
      id: "getent",
      command: `${engine} exec ${facts.from.label} getent hosts ${service}`,
      result: obs.nameResolves?.detail ?? (resolved ? (fromNetworks[0] ?? i18n.t("resolved")) : i18n.t("(not found)")),
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
      result: `${targetNetworks.join(", ") || "—"}${
        shared ? "" : i18n.t("  ← not shared with {{from}}", { from: facts.from.label })
      }`,
      state: shared ? "ok" : "warn",
      smoking: shared ? undefined : "warn",
    },
    {
      id: "shared",
      command: i18n.t("shared network?"),
      result: shared ? i18n.t("yes") : i18n.t("none"),
      state: shared ? "ok" : "err",
    },
  ];
  if (resolved) {
    return {
      verdict: { tone: "ok", text: i18n.t("Resolves and reachable") },
      pathLabel: i18n.t("container → container"),
      hops,
      diagnosis: {
        tone: "ok",
        icon: "tick-circle",
        headline: i18n.t("`{{from}}` can reach `{{service}}`", { from: facts.from.label, service }),
        explanation: i18n.t(
          "`{{service}}` resolves on a network shared with `{{from}}` and answered on port {{containerPort}}. Nothing to fix.",
          { service, from: facts.from.label, containerPort: cport },
        ),
        actions: [],
      },
      probes,
    };
  }
  return {
    verdict: { tone: "err", text: i18n.t("Name doesn't resolve") },
    pathLabel: i18n.t("container → container"),
    hops,
    diagnosis: {
      tone: "err",
      icon: "error",
      headline: i18n.t("`{{service}}` and `{{from}}` aren't on a shared network", {
        service,
        from: facts.from.label,
      }),
      explanation: i18n.t(
        "{{engine}}'s DNS only resolves container names within the same network. `{{from}}` is on `{{fromNetworks}}`; `{{service}}` is only on `{{targetNetworks}}` — no overlap, so the name can't resolve. Attach one to the other's network.",
        {
          engine,
          from: facts.from.label,
          fromNetworks: fromNetworks.join(", ") || i18n.t("no network"),
          service,
          targetNetworks: targetNetworks.join(", ") || i18n.t("another network"),
        },
      ),
      fixCommand: `${engine} network connect ${fromNetworks[0] ?? "<network>"} ${service}`,
      actions: [
        {
          id: "connect",
          icon: "link",
          text: i18n.t("Connect {{service}} to {{network}}", {
            service,
            network: fromNetworks[0] ?? i18n.t("the network"),
          }),
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
  const host = facts.target.externalHost ?? i18n.t("the host");
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
      name: i18n.t("DNS"),
      meta: obs.egressDns?.ok === false ? i18n.t("fail") : i18n.t("resolves"),
      state: obs.egressDns?.ok === false ? "err" : "ok",
    },
    { id: "gateway", icon: "graph", name: i18n.t("net gateway"), meta: undefined, state: "ok" },
    {
      id: "route",
      icon: viaVpn ? "shield" : "globe",
      name: i18n.t("host route"),
      meta: viaVpn ? i18n.t("captured by {{dev}}", { dev }) : i18n.t("direct"),
      state: viaVpn ? "err" : "ok",
    },
    {
      id: "external",
      icon: "globe",
      name: host,
      meta: egressOk ? i18n.t("reachable") : i18n.t("— timeout"),
      state: egressOk ? "ok" : "dead",
    },
  ];
  const probes: ReachabilityProbe[] = [
    {
      id: "egress",
      command: `${engine} exec ${facts.from.label} curl -sS -m3 https://${host}`,
      result: obs.egress?.detail ?? (egressOk ? i18n.t("HTTP/1.1 200 OK") : i18n.t("timed out after 3s")),
      state: dial(egressOk),
    },
    {
      id: "egress-dns",
      command: `${engine} exec ${facts.from.label} getent hosts ${host}`,
      result: obs.egressDns?.detail ?? i18n.t("resolved (DNS is fine)"),
      state: "ok",
    },
  ];
  if (viaVpn) {
    probes.push({
      id: "route",
      command: `ip route get ${fromIp ?? host}`,
      result: i18n.t("{{route}}  ← via VPN, not the bridge", { route: obs.route?.detail ?? `dev ${dev}` }),
      state: "err",
      smoking: "err",
    });
    probes.push({
      id: "tunnels",
      command: i18n.t("active tunnels"),
      result: tunnel
        ? i18n.t("{{name}} · {{app}} · routes {{routes}}", {
            name: tunnel.name,
            app: tunnel.app ?? i18n.t("VPN"),
            routes: (tunnel.routes ?? []).join(", "),
          })
        : i18n.t("none"),
      state: "warn",
      smoking: "warn",
    });
    return {
      verdict: { tone: "err", text: i18n.t("Blackholed by VPN") },
      pathLabel: i18n.t("container → internet"),
      hops,
      diagnosis: {
        tone: "err",
        icon: "error",
        headline: i18n.t("A VPN is capturing your container subnet"),
        explanation: i18n.t(
          "`{{dev}}`{{app}} installed full-tunnel routes {{routes}}, which swallow traffic leaving your container's subnet — so container egress is dropped while the VPN is up. Add a split-tunnel exclusion, or move the network onto a range the VPN doesn't claim.",
          {
            dev,
            app: tunnel?.app ? ` (${tunnel.app})` : "",
            routes: (tunnel?.routes ?? ["0.0.0.0/1", "128.0.0.0/1"]).join(" + "),
          },
        ),
        fixCommand: `sudo route -n add -net ${guessSubnet(fromIp)} -interface bridge100`,
        actions: [
          { id: "resubnet", icon: "graph", text: i18n.t("Re-subnet {{engine}} net", { engine }), primary: true },
        ],
        learnMore: true,
      },
      probes,
    };
  }
  return {
    verdict: egressOk
      ? { tone: "ok", text: i18n.t("Reachable · {{host}}", { host }) }
      : { tone: "err", text: i18n.t("Unreachable") },
    pathLabel: i18n.t("container → internet"),
    hops,
    diagnosis: egressOk
      ? {
          tone: "ok",
          icon: "tick-circle",
          headline: i18n.t("`{{from}}` can reach `{{host}}`", { from: facts.from.label, host }),
          explanation: i18n.t(
            "Egress to `{{host}}:{{port}}` succeeded — DNS resolved and the route left the container network cleanly. Nothing to fix.",
            { host, port },
          ),
          actions: [],
        }
      : {
          tone: "err",
          icon: "error",
          headline: i18n.t("`{{from}}` can't reach `{{host}}`", { from: facts.from.label, host }),
          explanation:
            obs.egress?.detail ??
            i18n.t("The connection to `{{host}}:{{port}}` failed. Check the container's egress route and DNS.", {
              host,
              port,
            }),
          actions: [],
          learnMore: true,
        },
    probes,
  };
}

function buildDnsLookup(facts: ReachabilityFacts, obs: ReachabilityObservations): ReportCore {
  const { engine } = facts;
  const name = facts.target.lookupName ?? facts.target.serviceName ?? i18n.t("the name");
  const resolved = obs.nameResolves?.ok ?? false;
  const hops: ReachabilityHop[] = [
    { id: "from", icon: "cube", name: facts.from.label, state: "ok" },
    { id: "dns", icon: "search-template", name: engineDnsName(engine), meta: i18n.t("up"), state: "ok" },
    {
      id: "resolve",
      icon: resolved ? "tick" : "cross",
      name: i18n.t('resolve "{{name}}"', { name }),
      meta: resolved ? (obs.nameResolves?.detail ?? i18n.t("resolved")) : i18n.t("NXDOMAIN"),
      state: resolved ? "ok" : "err",
    },
  ];
  const probes: ReachabilityProbe[] = [
    {
      id: "getent",
      command: `${engine} exec ${facts.from.label} getent hosts ${name}`,
      result: obs.nameResolves?.detail ?? (resolved ? i18n.t("resolved") : i18n.t("(not found)")),
      state: resolved ? "ok" : "err",
      smoking: resolved ? undefined : "err",
    },
  ];
  return {
    verdict: resolved
      ? { tone: "ok", text: i18n.t("Resolves") }
      : { tone: "err", text: i18n.t("Name doesn't resolve") },
    pathLabel: i18n.t("container → DNS"),
    hops,
    diagnosis: resolved
      ? {
          tone: "ok",
          icon: "tick-circle",
          headline: i18n.t("`{{name}}` resolves", { name }),
          explanation: i18n.t("`{{from}}` resolved `{{name}}` via {{dns}}. Nothing to fix.", {
            from: facts.from.label,
            name,
            dns: engineDnsName(engine),
          }),
          actions: [],
        }
      : {
          tone: "err",
          icon: "error",
          headline: i18n.t("`{{name}}` does not resolve from `{{from}}`", { name, from: facts.from.label }),
          explanation: i18n.t(
            "The lookup returned NXDOMAIN. If it's a container name, attach both containers to a shared network; if it's an external name, check the container's DNS servers.",
          ),
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
  const probeSummary = i18n.t("{{count}} {{label}} · {{seconds}} s", {
    count: core.probes.length,
    label: core.probes.length === 1 ? i18n.t("probe") : i18n.t("probes"),
    seconds: seconds.toFixed(1),
  });
  // The connection is the head of the path (e.g. "System Docker → host → container") — it owns the trace, so it
  // reads as the first leg rather than a separate badge.
  return {
    ...core,
    pathLabel: i18n.t("{{connectionName}} → {{pathLabel}}", {
      connectionName: facts.connectionName,
      pathLabel: core.pathLabel,
    }),
    probeSummary,
  };
}
