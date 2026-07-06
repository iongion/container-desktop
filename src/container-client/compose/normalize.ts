// Normalize a raw (parsed + interpolated + validated) compose object into the canonical
// ComposeProjectModel: short/long syntaxes expanded, env merged, unsupported keys reported.
// PURE — env_file contents are supplied via an injected `resolveEnvFile` (I/O stays in the loader).

import { parse as shellParse } from "shell-quote";

import type {
  ComposeHealthcheck,
  ComposeMount,
  ComposeNetworkModel,
  ComposePortMapping,
  ComposeProjectModel,
  ComposeServiceModel,
  ComposeServiceNetwork,
  ComposeVolumeModel,
  UnsupportedKeyReport,
} from "./types";

export interface NormalizeOptions {
  name: string; // fallback project name (dir basename or -p override)
  projectDir: string;
  resolveEnvFile?: (pathAsWritten: string) => Record<string, string>;
  activeProfiles?: string[]; // Compose profiles to activate; services with other profiles are excluded
}

// Keys we deliberately do not implement in v1 — surfaced to the user, never silently dropped.
const UNSUPPORTED_SERVICE_KEYS = ["build", "secrets", "configs", "deploy", "develop", "extends", "devices", "gpus"];
const UNSUPPORTED_TOP_KEYS = ["secrets", "configs", "include"];

type Dict = Record<string, unknown>;

const asRecord = (v: unknown): Dict => (v && typeof v === "object" && !Array.isArray(v) ? (v as Dict) : {});
const asArray = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v == null ? [] : [v as T]);
const asStringList = (v: unknown): string[] => asArray(v).map((x) => String(x));

function toArgv(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v.map((x) => String(x));
  const str = String(v);
  if (str.trim() === "") return undefined;
  // Compose runs a string command/entrypoint as exec args (not through a shell). shell-quote respects
  // quotes + escapes; its shell-operator/glob/comment tokens are flattened back to literal text so we get
  // a faithful argv split (mirrors compose-go's go-shellwords) instead of a naive whitespace split.
  return shellParse(str).map((tok) => {
    if (typeof tok === "string") return tok;
    if ("pattern" in tok && typeof tok.pattern === "string") return tok.pattern;
    if ("op" in tok) return tok.op;
    if ("comment" in tok) return `#${tok.comment}`;
    return "";
  });
}

// Parse a `low[-high]` port token into [low, count]. A malformed/absent high yields count 1.
function parsePortRange(token: string): [number, number] {
  const dash = token.indexOf("-");
  if (dash > 0) {
    const lo = Number(token.slice(0, dash));
    const hi = Number(token.slice(dash + 1));
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo) return [lo, hi - lo + 1];
  }
  return [Number(token), 1];
}

function toEnvRecord(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(v)) {
    for (const entry of v) {
      const s = String(entry);
      const eq = s.indexOf("=");
      if (eq === -1) out[s] = "";
      else out[s.slice(0, eq)] = s.slice(eq + 1);
    }
  } else {
    for (const [k, val] of Object.entries(asRecord(v))) out[k] = val == null ? "" : String(val);
  }
  return out;
}

const isBindSource = (s: string): boolean => /^[./~]/.test(s) || /^[A-Za-z]:[\\/]/.test(s);

// Short syntax: `[HOST_IP:][HOST_PORT:]CONTAINER_PORT[/PROTOCOL]` — HOST_IP may be a bracketed IPv6
// (`[::1]`), and host/container may be ranges (`8000-8005`). Splitting naively on ":" breaks both.
function parsePort(entry: unknown): ComposePortMapping {
  if (typeof entry === "object" && entry !== null) {
    const o = entry as Dict;
    const [target, range] = parsePortRange(String(o.target));
    const mapping: ComposePortMapping = { target, protocol: (o.protocol as "tcp" | "udp") || "tcp" };
    if (range > 1) mapping.range = range;
    if (o.published != null) mapping.published = String(o.published);
    if (o.host_ip != null) mapping.hostIp = String(o.host_ip);
    return mapping;
  }
  let raw = String(entry).trim();
  let protocol: "tcp" | "udp" = "tcp";
  const slash = raw.lastIndexOf("/");
  if (slash !== -1) {
    const proto = raw.slice(slash + 1).toLowerCase();
    if (proto === "tcp" || proto === "udp") {
      protocol = proto;
      raw = raw.slice(0, slash);
    }
  }
  let hostIp: string | undefined;
  if (raw.startsWith("[")) {
    const close = raw.indexOf("]");
    if (close !== -1) {
      hostIp = raw.slice(1, close);
      raw = raw.slice(close + 1).replace(/^:/, "");
    }
  }
  const parts = raw.split(":");
  let targetTok = parts[0];
  let publishedTok: string | undefined;
  if (parts.length >= 3) {
    if (!hostIp) hostIp = parts[0];
    publishedTok = parts[1];
    targetTok = parts[2];
  } else if (parts.length === 2) {
    publishedTok = parts[0];
    targetTok = parts[1];
  }
  const [target, range] = parsePortRange(targetTok);
  const mapping: ComposePortMapping = { target, protocol };
  if (range > 1) mapping.range = range;
  if (publishedTok != null && publishedTok !== "") mapping.published = String(parsePortRange(publishedTok)[0]);
  if (hostIp != null) mapping.hostIp = hostIp;
  return mapping;
}

// Split `SOURCE:TARGET[:MODE]` on ":" while keeping Windows drive letters (`C:\…`) attached to their path,
// so `C:\Users\me:/data:ro` yields ["C:\\Users\\me", "/data", "ro"] rather than source "C".
function splitMountSpec(raw: string): string[] {
  const segs = raw.split(":");
  const parts: string[] = [];
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i];
    if (seg.length === 1 && /[A-Za-z]/.test(seg) && i + 1 < segs.length && /^[\\/]/.test(segs[i + 1])) {
      parts.push(`${seg}:${segs[i + 1]}`);
      i += 1;
    } else {
      parts.push(seg);
    }
  }
  return parts;
}

function parseMount(entry: unknown): ComposeMount {
  if (typeof entry === "object" && entry !== null) {
    const o = entry as Dict;
    return {
      type: (o.type as "volume" | "bind") || "volume",
      ...(o.source != null ? { source: String(o.source) } : {}),
      target: String(o.target),
      ...(o.read_only ? { readOnly: true } : {}),
    };
  }
  const parts = splitMountSpec(String(entry));
  if (parts.length === 1) return { type: "volume", target: parts[0] };
  const source = parts[0];
  const target = parts[1];
  const mode = parts[2] ?? "";
  const mount: ComposeMount = { type: isBindSource(source) ? "bind" : "volume", source, target };
  if (/(^|,)ro(,|$)/.test(mode)) mount.readOnly = true;
  return mount;
}

function parseServiceNetworks(v: unknown): ComposeServiceNetwork[] {
  if (v == null) return [{ name: "default", aliases: [] }];
  if (Array.isArray(v)) return v.map((name) => ({ name: String(name), aliases: [] }));
  return Object.entries(asRecord(v)).map(([name, def]) => ({
    name,
    aliases: asStringList(asRecord(def).aliases),
  }));
}

// Compose duration ("10s", "1m30s", "500ms", "1h") → nanoseconds (libpod's int64 healthconfig unit). A bare
// number is treated as seconds (compose accepts integer seconds). Undefined for empty/unparseable input.
const DURATION_UNIT_NS: Record<string, number> = { ns: 1, us: 1e3, µs: 1e3, ms: 1e6, s: 1e9, m: 60e9, h: 3600e9 };
function parseDurationNs(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "number") return Math.round(value * 1e9);
  const text = String(value).trim().toLowerCase();
  const re = /(\d+(?:\.\d+)?)\s*(ns|us|µs|ms|s|m|h)/g;
  let total = 0;
  let matched = false;
  let match: RegExpExecArray | null = re.exec(text);
  while (match !== null) {
    matched = true;
    total += Number.parseFloat(match[1]) * DURATION_UNIT_NS[match[2]];
    match = re.exec(text);
  }
  return matched ? Math.round(total) : undefined;
}

// Compose `healthcheck.test`: a bare string → `["CMD-SHELL", str]`; a list (["CMD", …] / ["CMD-SHELL", …] /
// ["NONE"]) → verbatim. Undefined when absent.
function parseHealthTest(test: unknown): string[] | undefined {
  if (test == null) return undefined;
  if (Array.isArray(test)) return test.map(String);
  const text = String(test).trim();
  return text ? ["CMD-SHELL", text] : undefined;
}

function parseHealthcheck(raw: unknown): ComposeHealthcheck | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const h = asRecord(raw);
  if (h.disable === true) return { test: ["NONE"] };
  const test = parseHealthTest(h.test);
  if (!test) return undefined; // no test declared → leave the image's own HEALTHCHECK in force
  const healthcheck: ComposeHealthcheck = { test };
  const interval = parseDurationNs(h.interval);
  const timeout = parseDurationNs(h.timeout);
  const startPeriod = parseDurationNs(h.start_period);
  if (interval != null) healthcheck.intervalNs = interval;
  if (timeout != null) healthcheck.timeoutNs = timeout;
  if (startPeriod != null) healthcheck.startPeriodNs = startPeriod;
  if (h.retries != null) healthcheck.retries = Number(h.retries);
  return healthcheck;
}

// Long-form depends_on targets whose condition is `service_healthy` — the deps that must be healthy first.
function parseHealthDeps(dependsOn: unknown): string[] {
  if (!dependsOn || Array.isArray(dependsOn) || typeof dependsOn !== "object") return [];
  return Object.entries(asRecord(dependsOn))
    .filter(([, cond]) => String(asRecord(cond).condition ?? "") === "service_healthy")
    .map(([target]) => target);
}

function normalizeService(name: string, raw: unknown, opts: NormalizeOptions): ComposeServiceModel {
  const s = asRecord(raw);
  const resolveEnvFile = opts.resolveEnvFile ?? (() => ({}));
  const environment: Record<string, string> = {};
  for (const ref of asArray(s.env_file)) {
    const path = typeof ref === "object" && ref !== null ? String((ref as Dict).path) : String(ref);
    Object.assign(environment, resolveEnvFile(path));
  }
  Object.assign(environment, toEnvRecord(s.environment));

  return {
    name,
    image: s.image != null ? String(s.image) : undefined,
    containerName: s.container_name != null ? String(s.container_name) : undefined,
    command: toArgv(s.command),
    entrypoint: toArgv(s.entrypoint),
    environment,
    ports: asArray(s.ports).map(parsePort),
    mounts: asArray(s.volumes).map(parseMount),
    networks: parseServiceNetworks(s.networks),
    dependsOn: Array.isArray(s.depends_on) ? s.depends_on.map(String) : Object.keys(asRecord(s.depends_on)),
    healthDeps: parseHealthDeps(s.depends_on),
    healthcheck: parseHealthcheck(s.healthcheck),
    restart: s.restart != null ? String(s.restart) : undefined,
    labels: toEnvRecord(s.labels),
    profiles: asStringList(s.profiles),
    workingDir: s.working_dir != null ? String(s.working_dir) : undefined,
    user: s.user != null ? String(s.user) : undefined,
    hostname: s.hostname != null ? String(s.hostname) : undefined,
    expose: asStringList(s.expose),
    capAdd: asStringList(s.cap_add),
    capDrop: asStringList(s.cap_drop),
    privileged: s.privileged === true ? true : undefined,
    extraHosts: asStringList(s.extra_hosts),
  };
}

function normalizeNamed<T extends ComposeNetworkModel | ComposeVolumeModel>(raw: unknown): T[] {
  return Object.entries(asRecord(raw)).map(([name, def]) => {
    const d = asRecord(def);
    return {
      name,
      ...(d.external ? { external: true } : {}),
      ...(d.driver != null ? { driver: String(d.driver) } : {}),
    } as T;
  });
}

function collectUnsupported(services: Dict, raw: Dict): UnsupportedKeyReport[] {
  const reports: UnsupportedKeyReport[] = [];
  for (const [name, def] of Object.entries(services)) {
    const s = asRecord(def);
    for (const key of UNSUPPORTED_SERVICE_KEYS) {
      if (key in s) reports.push({ path: `services.${name}.${key}` });
    }
    // depends_on ordering is honored, and `service_healthy` is now waited on (health-gated start). Any OTHER
    // long-form condition (e.g. service_completed_successfully) is still not implemented — surface it rather
    // than silently approximating.
    const dep = s.depends_on;
    if (dep && typeof dep === "object" && !Array.isArray(dep)) {
      for (const [target, cond] of Object.entries(dep as Dict)) {
        const condition = String(asRecord(cond).condition ?? "service_started");
        if (condition !== "service_started" && condition !== "service_healthy") {
          reports.push({ path: `services.${name}.depends_on.${target} (condition: ${condition})` });
        }
      }
    }
  }
  for (const key of UNSUPPORTED_TOP_KEYS) {
    if (key in raw) reports.push({ path: key });
  }
  return reports;
}

/** Normalize a raw compose object into the canonical model. */
export function normalizeProject(raw: unknown, opts: NormalizeOptions): ComposeProjectModel {
  const doc = asRecord(raw);
  const servicesRaw = asRecord(doc.services);
  const activeProfiles = new Set(opts.activeProfiles ?? []);

  // A service with `profiles:` is deployed only when one of its profiles is active (Compose semantics);
  // services without profiles always deploy. Inactive-profile services are excluded from the plan.
  const services = Object.entries(servicesRaw)
    .map(([name, def]) => normalizeService(name, def, opts))
    .filter((s) => s.profiles.length === 0 || s.profiles.some((p) => activeProfiles.has(p)));

  const networks: ComposeNetworkModel[] = normalizeNamed<ComposeNetworkModel>(doc.networks);
  if (!networks.some((n) => n.name === "default")) networks.push({ name: "default" });

  return {
    name: doc.name != null ? String(doc.name) : opts.name,
    projectDir: opts.projectDir,
    services,
    networks,
    volumes: normalizeNamed<ComposeVolumeModel>(doc.volumes),
    unsupported: collectUnsupported(servicesRaw, doc),
  };
}
