// Normalized Compose model + libpod plan types. Pure data — shared by the parser, translator, and
// orchestration layers. The RAW parsed compose object is kept as `unknown` and narrowed here.

export interface ComposePortMapping {
  target: number; // container port (low end of the range)
  published?: string; // host port (low end)
  hostIp?: string;
  protocol: "tcp" | "udp";
  range?: number; // count of consecutive ports when a range like "8000-8005" is given
}

export interface ComposeMount {
  type: "volume" | "bind";
  source?: string; // named volume name, or (bind) an absolute/relative host path
  target: string; // container path
  readOnly?: boolean;
}

export interface ComposeServiceNetwork {
  name: string; // compose network key (e.g. "default", "backend")
  aliases: string[];
}

// A compose `healthcheck:` translated toward the libpod `healthconfig` create body. Durations are stored in
// NANOSECONDS (libpod's int64 unit); `test` is the libpod Test array (["CMD-SHELL", "…"] | ["CMD", …] |
// ["NONE"] to disable). Undefined fields fall back to the engine/image defaults.
export interface ComposeHealthcheck {
  test: string[];
  intervalNs?: number;
  timeoutNs?: number;
  startPeriodNs?: number;
  retries?: number;
}

export interface ComposeServiceModel {
  name: string;
  image?: string;
  containerName?: string;
  command?: string[];
  entrypoint?: string[];
  environment: Record<string, string>; // env_file merged first, then inline environment (inline wins)
  ports: ComposePortMapping[];
  mounts: ComposeMount[];
  networks: ComposeServiceNetwork[];
  dependsOn: string[]; // all depends_on targets (ordering)
  healthDeps: string[]; // subset of dependsOn whose condition is `service_healthy` (must be healthy first)
  healthcheck?: ComposeHealthcheck;
  restart?: string;
  labels: Record<string, string>;
  profiles: string[];
  workingDir?: string;
  user?: string;
  hostname?: string;
  expose: string[];
  capAdd: string[];
  capDrop: string[];
  privileged?: boolean;
  extraHosts: string[];
}

export interface ComposeNetworkModel {
  name: string; // compose key
  external?: boolean;
  driver?: string;
}

export interface ComposeVolumeModel {
  name: string; // compose key
  external?: boolean;
  driver?: string;
}

export interface UnsupportedKeyReport {
  path: string; // e.g. "services.web.build"
  note?: string;
}

export interface ComposeProjectModel {
  name: string;
  projectDir: string; // directory of the compose file — relative paths resolve against this
  services: ComposeServiceModel[];
  networks: ComposeNetworkModel[];
  volumes: ComposeVolumeModel[];
  unsupported: UnsupportedKeyReport[];
}

// Translator output — a declarative plan of libpod REST create bodies. `body` fields are the raw
// request payloads (kept as records so the translator is the single place shapes are adjusted).

export interface ComposePlanResource {
  name: string;
  body: Record<string, unknown>;
}

export interface ComposePlanContainer extends ComposePlanResource {
  service: string;
  configHash: string;
}

export interface ComposePlan {
  project: string;
  networks: ComposePlanResource[];
  volumes: ComposePlanResource[];
  pod?: ComposePlanResource;
  containers: ComposePlanContainer[];
  startOrder: string[]; // container names, topologically sorted
  // Health gates keyed by container name (startOrder space) → the dep container names that must report
  // healthy before this one starts (from `depends_on: {condition: service_healthy}`). Absent when none.
  healthGates?: Record<string, string[]>;
  warnings: string[]; // e.g. port conflicts (single-pod), unsupported keys
}

// UI-facing summaries + operation options/results.

export interface ComposeProject {
  Name: string;
  Services: number;
  Running: number;
  PodMode?: boolean;
}

export interface ComposeUpOptions {
  podMode?: boolean;
  removeOrphans?: boolean;
}

export interface ComposeDownOptions {
  removeVolumes?: boolean;
}

// Where the compose file to deploy lives on disk. Docker shells `docker compose -f <path>` (it parses the
// file itself); Podman ignores this and deploys the parsed `model` via libpod translation.
export interface ComposeSource {
  path: string;
}

// The host-facade request shapes (typed `composeUp`/`composeDown` params).
export interface ComposeUpRequest extends ComposeUpOptions {
  model: ComposeProjectModel;
}

export interface ComposeDownRequest extends ComposeDownOptions {
  project: string;
}

// What an `up` actually did — surfaced to the user so a no-op reconcile never "lies".
export interface ComposeChangeSummary {
  created: string[];
  recreated: string[];
  unchanged: string[];
  started: string[];
  orphansRemoved: string[];
}
