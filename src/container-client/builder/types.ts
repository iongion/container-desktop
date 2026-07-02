// Engine-agnostic data models for the Image Build Studio. A Containerfile is the canonical artifact; the
// UI is a faithful projection of it. These types are shared by the pure cores (flag mappers, progress
// parsers, linter, layer + cache analysis), the BuildAdapter and the renderer. No engine-specific fields
// leak in here — per-engine capability lives in featureMatrix.ts.

export type BuildEngineKind = "docker" | "podman" | "apple";

// Build request

export interface BuildSecret {
  id: string;
  src?: string; // file source (docker/podman/apple: --secret id=…,src=…)
  env?: string; // env source (docker/podman: --secret id=…,env=…)
}

export interface BuildSshMount {
  id: string; // "default" → the agent socket
  source?: string; // explicit key path
}

export interface NamedContext {
  name: string;
  value: string; // path or image/oci ref (docker --build-context name=value)
}

export interface ImageBuildOptions {
  engine: BuildEngineKind;
  connectionId: string;
  containerfilePath: string; // path (relative to contextDir or absolute)
  contextDir: string; // build context directory (argv last)
  containerfileContent?: string; // authored buffer; when present it is written to a temp file
  tags: string[];
  buildArgs: Record<string, string>;
  labels: Record<string, string>;
  target?: string; // --target <stage>
  platforms: string[]; // e.g. ["linux/amd64"]; length > 1 ⇒ multi-platform
  noCache: boolean;
  pull: boolean;
  push?: boolean;
  secrets: BuildSecret[];
  sshMounts: BuildSshMount[];
  namedContexts: NamedContext[];
  cacheFrom: string[];
  cacheTo: string[];
  output?: string; // --output / -o
  layers?: boolean; // podman --layers
  arch?: string; // apple -a/--arch
  os?: string; // apple --os
  cpus?: string; // apple -c/--cpus
  memory?: string; // apple -m/--memory
}

// Build run / steps

export type BuildStepStatus = "pending" | "running" | "cached" | "done" | "error" | "canceled";
export type BuildRunStatus = "idle" | "running" | "succeeded" | "failed" | "canceled";

export interface BuildStepLogLine {
  ts: number; // epoch ms
  stream: "stdout" | "stderr";
  text: string;
}

export interface BuildStep {
  key: string; // stable identity across incremental updates (digest, "STEP n/m", or "#n")
  index: number; // 1-based ordinal in the stream
  total?: number; // total steps when the engine reports "n/m"
  name: string; // the instruction/vertex label, e.g. "COPY . ."
  status: BuildStepStatus;
  cached: boolean;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  logs: BuildStepLogLine[];
  error?: string;
}

export interface BuildRun {
  id: string;
  connectionId: string;
  engine: BuildEngineKind;
  options: ImageBuildOptions;
  argvPreview: string; // redacted command preview
  status: BuildRunStatus;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number | null;
  steps: BuildStep[];
  imageId?: string;
  tags: string[];
  errorSummary?: string;
  rawLogTail?: string; // capped tail of the raw combined log
}

// Layer analysis

export interface LayerInfo {
  index: number;
  id?: string;
  createdBy: string; // the instruction that created the layer
  size: number; // bytes
  cumulativeSize: number; // running total up to and including this layer
  empty: boolean; // metadata-only layer (0 bytes)
  comment?: string;
}

export type LayerWasteKind = "large-layer" | "many-layers" | "duplicate-copy" | "no-cleanup";

export interface LayerWasteFinding {
  kind: LayerWasteKind;
  layerIndex?: number;
  bytes?: number;
  message: string;
}

export interface LayerAnalysis {
  layers: LayerInfo[];
  totalSize: number;
  largest: LayerInfo[]; // top-N by size, descending
  findings: LayerWasteFinding[];
}

// Cache analysis

export type CacheBreakerCause =
  | "context-changed" // COPY/ADD input changed
  | "command-changed" // RUN command text changed
  | "build-arg-changed" // an ARG referenced by the step changed
  | "base-image-updated" // FROM re-pulled under --pull
  | "unknown";

export interface CacheBreaker {
  stepKey: string;
  name: string; // the offending instruction label
  likelyCause: CacheBreakerCause;
  fixHint: string;
}

export interface CacheAnalysis {
  cachedCount: number;
  rebuiltCount: number;
  firstMissIndex: number; // index of the first non-cached step, or -1 if fully cached
  breaker?: CacheBreaker;
  cascadeKeys: string[]; // the miss + its downstream dependents (same-stage)
}

// Containerfile AST + linter

export interface CfRange {
  start: number; // 0-based line, inclusive
  end: number; // 0-based line, inclusive
}

export interface CfInstruction {
  id: string; // stable id, e.g. `${stageIndex}:${ordinalInStage}`
  instruction: string; // normalized UPPERCASE keyword, e.g. "FROM", "RUN"
  rawKeyword: string; // keyword exactly as written
  args: string; // argument text after the keyword (pre-serialization normalization)
  flags: Record<string, string | boolean>; // parsed --flag / --flag=value
  range: CfRange;
  comments: string[]; // leading comment lines attached to this instruction
  raw: string; // EXACT source slice (incl. continuations/here-docs) for round-trip serialize
  stageIndex: number; // owning FROM-stage (-1 before the first FROM)
}

export interface CfStage {
  index: number;
  name?: string; // FROM … AS <name>
  from: string; // base image reference
  instructions: CfInstruction[];
  range: CfRange;
}

export interface ContainerfileAst {
  source: string; // original source text (serialize fallback / range resolution)
  stages: CfStage[];
  instructions: CfInstruction[]; // flat, in document order (includes pre-FROM directives)
}

export type LintSeverity = "error" | "warning" | "info";

export interface LintFinding {
  ruleId: string; // e.g. "CF002"
  severity: LintSeverity;
  message: string;
  range: CfRange;
  fixHint?: string;
}

// Streaming progress events (emitted by the per-engine parsers)

// A parser turns raw stdout/stderr chunks into a flat stream of these. "step" carries the latest snapshot
// of a step (upserted by key — a step is re-emitted whenever its status/cached flag changes); "log" carries
// one output line attributed to a step key; "image" carries the final built image id once the engine reports
// it (podman's trailing id line, docker/apple's "writing image sha256:…") so the Layers tab can resolve it.
export type BuildEvent =
  | { type: "step"; step: BuildStep }
  | { type: "log"; key: string; line: BuildStepLogLine }
  | { type: "image"; imageId: string };

export interface BuildProgressParser {
  push: (from: "stdout" | "stderr", chunk: string) => BuildEvent[];
}

// Streaming sink contract (implemented by the BuildAdapter consumer)

export interface BuildSink {
  onStep: (step: BuildStep) => void;
  onLog: (key: string, line: BuildStepLogLine) => void;
  onImageId?: (imageId: string) => void;
  onDone: (code: number | null) => void;
  onError: (error: unknown) => void;
}
