// First-class TYPED container tools. MAIN-ONLY. The model calls these (listContainers, getContainerLogs,
// startContainer, …) instead of assembling shell strings — each runs against the engine through the
// injected EngineOps port (backed by EngineDataService) and streams a typed `tool-call`/`tool-result` the
// renderer renders as a generative-UI card. Every result is redacted (secrets scrubbed) before it reaches
// the model OR the wire. Read tools are ungated; mutating tools (Phase 3) are gated by the permission mode.
//
// `executeContainerTool` is the SINGLE execution path — used here by the tool's run branch and by the broker
// when it re-runs an APPROVED mutation, so behaviour and redaction can never drift between the two.

import { tool } from "ai";
import { z } from "zod";

import type { AgentToolDeps, EngineOps } from "@/ai-system/core";
import { redactPayload, redactText, resolveToolAction, toolKey } from "@/ai-system/core";
import type { Container, ContainerImage, ContainerStats, Network, Volume } from "@/env/Types";

// Input schemas — `.strict()` so the model can pass ONLY the declared fields (never a connection override
// it shouldn't, never an extra option). `listContainersInput` is exported for the wiring test.
const noArgs = z.object({}).strict();
export const listContainersInput = z.object({ connectionId: z.string().optional() }).strict();
const connRef = listContainersInput;
const entityRef = z.object({ connectionId: z.string().optional(), id: z.string().min(1) }).strict();
const logsInput = z
  .object({
    connectionId: z.string().optional(),
    id: z.string().min(1),
    tail: z.number().int().positive().max(5000).optional(),
    since: z.string().optional(),
  })
  .strict();

// Compact, model-facing summaries — keep the LLM context lean; the full typed object goes to the card.
const short = (id: unknown): string => String(id ?? "").slice(0, 12);

function summariseContainer(c: Container) {
  const state = c.Computed?.DecodedState ?? (typeof c.State === "string" ? c.State : c.Status);
  return {
    Id: short(c.Id),
    Name: c.Computed?.Name ?? c.Name ?? c.Names?.[0] ?? "",
    Image: c.Image ?? c.ImageName ?? "",
    State: state ?? "",
  };
}

function summariseImage(i: ContainerImage) {
  return { Id: short(i.Id), Name: i.FullName ?? i.Names?.[0] ?? "", Tag: i.Tag ?? "", Size: i.Size };
}

function summariseNetwork(n: Network) {
  return { id: short(n.id), name: n.name, driver: n.driver };
}

function summariseVolume(v: Volume) {
  return { Name: v.Name, Driver: v.Driver, Mountpoint: v.Mountpoint };
}

function summariseStats(s: ContainerStats) {
  return { name: s.name, memoryUsage: s.memory_stats?.usage, memoryLimit: s.memory_stats?.limit };
}

function tailLines(text: string, n: number): string {
  const lines = text.split(/\r?\n/);
  return lines.length <= n ? text : lines.slice(-n).join("\n");
}

// A per-process unique id for a surfaced approval (the renderer echoes it back so the broker matches the
// exact pending action). Generated MAIN-side; the renderer never invents ids.
let actionCounter = 0;
function nextActionId(): string {
  actionCounter += 1;
  return `tool-act-${actionCounter}`;
}

// The meaningful operand (id / reference) for an approval/rejection display row.
function argDisplay(args: any): string[] {
  const id = args?.id ?? args?.reference;
  return id !== undefined ? [String(id)] : [];
}

// A tool's contract: how to describe it to the model, validate its input, label it, and run it. `run`
// returns the FULL typed payload (`result`, for the card) plus a compact `summary` (for the model);
// executeContainerTool redacts both. `gated` mutations are handled in Phase 3.
interface ContainerToolSpec {
  description: string;
  inputSchema: z.ZodTypeAny;
  gated: boolean;
  title: (args: any) => string;
  run: (ops: EngineOps, args: any) => Promise<{ ok: boolean; result: unknown; summary: unknown }>;
}

const SPECS: Record<string, ContainerToolSpec> = {
  listConnections: {
    description:
      "List the configured container-engine connections (id, name, engine, running). Pass a connection's id as `connectionId` on other tools to target a specific engine; omit it to use the primary connection.",
    inputSchema: noArgs,
    gated: false,
    title: () => "List connections",
    run: async (ops) => {
      const items = ops.listConnections();
      return { ok: true, result: items, summary: items };
    },
  },
  listContainers: {
    description: "List containers (all states) for a connection. Returns id, name, image and state.",
    inputSchema: connRef,
    gated: false,
    title: () => "List containers",
    run: async (ops, args) => {
      const items = await ops.listContainers({ connectionId: args.connectionId });
      return { ok: true, result: items, summary: items.map(summariseContainer) };
    },
  },
  inspectContainer: {
    description: "Inspect one container by id or name; returns its full configuration and state.",
    inputSchema: entityRef,
    gated: false,
    title: (args) => `Inspect container ${short(args.id)}`,
    run: async (ops, args) => {
      const item = await ops.inspectContainer({ connectionId: args.connectionId, id: args.id });
      return { ok: !!item, result: item ?? null, summary: item ? summariseContainer(item) : { error: "not found" } };
    },
  },
  getContainerLogs: {
    description:
      "Fetch recent logs for a container. `tail` caps the number of lines (default 200); `since` is an optional timestamp.",
    inputSchema: logsInput,
    gated: false,
    title: (args) => `Logs for ${short(args.id)}`,
    run: async (ops, args) => {
      const text = await ops.getContainerLogs({
        connectionId: args.connectionId,
        id: args.id,
        tail: args.tail ?? 200,
        since: args.since,
      });
      return { ok: true, result: { id: args.id, logs: text }, summary: { id: args.id, logs: tailLines(text, 60) } };
    },
  },
  getContainerStats: {
    description: "Get a one-shot CPU/memory usage snapshot for a container.",
    inputSchema: entityRef,
    gated: false,
    title: (args) => `Stats for ${short(args.id)}`,
    run: async (ops, args) => {
      const stats = await ops.getContainerStats({ connectionId: args.connectionId, id: args.id });
      return { ok: true, result: stats, summary: summariseStats(stats) };
    },
  },
  listImages: {
    description: "List images for a connection. Returns id, name, tag and size.",
    inputSchema: connRef,
    gated: false,
    title: () => "List images",
    run: async (ops, args) => {
      const items = await ops.listImages({ connectionId: args.connectionId });
      return { ok: true, result: items, summary: items.map(summariseImage) };
    },
  },
  inspectImage: {
    description: "Inspect one image by id or name; returns its full configuration.",
    inputSchema: entityRef,
    gated: false,
    title: (args) => `Inspect image ${short(args.id)}`,
    run: async (ops, args) => {
      const item = await ops.inspectImage({ connectionId: args.connectionId, id: args.id });
      return { ok: !!item, result: item ?? null, summary: item ? summariseImage(item) : { error: "not found" } };
    },
  },
  listNetworks: {
    description: "List networks for a connection. Returns id, name and driver.",
    inputSchema: connRef,
    gated: false,
    title: () => "List networks",
    run: async (ops, args) => {
      const items = await ops.listNetworks({ connectionId: args.connectionId });
      return { ok: true, result: items, summary: items.map(summariseNetwork) };
    },
  },
  inspectNetwork: {
    description: "Inspect one network by id or name.",
    inputSchema: entityRef,
    gated: false,
    title: (args) => `Inspect network ${short(args.id)}`,
    run: async (ops, args) => {
      const item = await ops.inspectNetwork({ connectionId: args.connectionId, id: args.id });
      return { ok: true, result: item, summary: summariseNetwork(item) };
    },
  },
  listVolumes: {
    description: "List volumes for a connection. Returns name, driver and mountpoint.",
    inputSchema: connRef,
    gated: false,
    title: () => "List volumes",
    run: async (ops, args) => {
      const items = await ops.listVolumes({ connectionId: args.connectionId });
      return { ok: true, result: items, summary: items.map(summariseVolume) };
    },
  },
  inspectVolume: {
    description: "Inspect one volume by name.",
    inputSchema: entityRef,
    gated: false,
    title: (args) => `Inspect volume ${short(args.id)}`,
    run: async (ops, args) => {
      const item = await ops.inspectVolume({ connectionId: args.connectionId, id: args.id });
      return { ok: true, result: item, summary: summariseVolume(item) };
    },
  },
};

// Mutating tools — gated by the permission mode (run / ask / reject). Each returns a compact { ok, op, id }
// action result (rendered by ActionResultCard). The lifecycle ops route through performAction in the adapter
// so the resource store refreshes; removes/pull refresh their domain.
const pullImageInput = z.object({ connectionId: z.string().optional(), reference: z.string().min(1) }).strict();

const ENTITY_MUTATIONS: ReadonlyArray<{
  name: string;
  method: keyof EngineOps;
  op: string;
  label: string;
  description: string;
}> = [
  {
    name: "startContainer",
    method: "startContainer",
    op: "start",
    label: "Start container",
    description: "Start a container by id or name.",
  },
  {
    name: "stopContainer",
    method: "stopContainer",
    op: "stop",
    label: "Stop container",
    description: "Stop a running container by id or name.",
  },
  {
    name: "restartContainer",
    method: "restartContainer",
    op: "restart",
    label: "Restart container",
    description: "Restart a container by id or name.",
  },
  {
    name: "pauseContainer",
    method: "pauseContainer",
    op: "pause",
    label: "Pause container",
    description: "Pause a running container by id or name.",
  },
  {
    name: "unpauseContainer",
    method: "unpauseContainer",
    op: "unpause",
    label: "Unpause container",
    description: "Resume a paused container by id or name.",
  },
  {
    name: "removeContainer",
    method: "removeContainer",
    op: "remove",
    label: "Remove container",
    description: "Remove a container (forced) by id or name. Destructive.",
  },
  {
    name: "removeImage",
    method: "removeImage",
    op: "remove",
    label: "Remove image",
    description: "Remove an image by id or name. Destructive.",
  },
  {
    name: "removeNetwork",
    method: "removeNetwork",
    op: "remove",
    label: "Remove network",
    description: "Remove a network by id or name. Destructive.",
  },
  {
    name: "removeVolume",
    method: "removeVolume",
    op: "remove",
    label: "Remove volume",
    description: "Remove a volume by name. Destructive.",
  },
];

for (const m of ENTITY_MUTATIONS) {
  SPECS[m.name] = {
    description: m.description,
    inputSchema: entityRef,
    gated: true,
    title: (args) => `${m.label} ${short(args.id)}`,
    run: async (ops, args) => {
      const call = ops[m.method] as (a: { connectionId?: string; id: string }) => Promise<boolean>;
      const ok = !!(await call({ connectionId: args.connectionId, id: args.id }));
      const payload = { ok, op: m.op, id: args.id };
      return { ok, result: payload, summary: payload };
    },
  };
}

SPECS.pullImage = {
  description: "Pull an image by reference (e.g. docker.io/library/nginx:latest). Reaches the network.",
  inputSchema: pullImageInput,
  gated: true,
  title: (args) => `Pull ${args.reference}`,
  run: async (ops, args) => {
    const ok = await ops.pullImage({ connectionId: args.connectionId, reference: args.reference });
    const payload = { ok, op: "pull", id: args.reference };
    return { ok, result: payload, summary: payload };
  },
};

export interface EngineToolOutcome {
  ok: boolean;
  /** Full typed payload for the renderer card — already redacted. */
  result: unknown;
  /** Compact, model-facing summary — already redacted. */
  summary: unknown;
  /** Friendly one-line label for the tool call/result/approval. */
  title: string;
}

// THE single execution path (tool run branch + broker approved-resume). Dispatches by name, then redacts
// both the card payload and the model summary so secrets never cross either boundary.
export async function executeContainerTool(engineOps: EngineOps, name: string, args: any): Promise<EngineToolOutcome> {
  const spec = SPECS[name];
  if (!spec) {
    throw new Error(`Unknown container tool: ${name}`);
  }
  const raw = await spec.run(engineOps, args ?? {});
  return {
    ok: raw.ok,
    result: redactPayload(raw.result),
    summary: redactPayload(raw.summary),
    title: spec.title(args ?? {}),
  };
}

// Run a READ tool: emit the call badge, execute, emit the typed result, and return the compact summary to
// the model. (Gated mutating tools layer their permission check on top of this in Phase 3.)
export async function runContainerTool(deps: AgentToolDeps, name: string, args: any): Promise<unknown> {
  const spec = SPECS[name];
  if (!spec || !deps.engineOps) {
    throw new Error(`Container tool unavailable: ${name}`);
  }
  const title = spec.title(args ?? {});
  // Gated mutations: the user's permission mode (not a heuristic) decides run / ask / reject. On "ask" we
  // surface an approval-request and STOP — the broker re-runs the op via executeContainerTool on approval.
  if (spec.gated) {
    const cached = deps.cacheLookup?.(toolKey(name, args ?? {}));
    const action = resolveToolAction({ mode: deps.mode, floorBlocked: false, cached });
    if (action === "reject") {
      const reason = "Blocked by your saved permissions.";
      deps.onEvent?.({ type: "rejected", program: name, args: argDisplay(args), reason });
      return { ok: false, rejected: true, reason };
    }
    if (action === "ask") {
      deps.onEvent?.({
        type: "approval-request",
        actionId: nextActionId(),
        kind: "tool",
        program: name,
        args: argDisplay(args),
        reason: "Requires your approval before it runs.",
        tool: name,
        toolArgs: (args ?? {}) as Record<string, unknown>,
        title,
      });
      return {
        ok: false,
        awaitingApproval: true,
        reason:
          "This action requires the user's approval before it runs. Do NOT assume it ran or invent its outcome — stop and let the user decide.",
      };
    }
    // action === "run" → execute below (allow mode, or a remembered allow).
  }
  deps.onEvent?.({ type: "tool-call", tool: name, title, args: (args ?? {}) as Record<string, unknown> });
  try {
    const outcome = await executeContainerTool(deps.engineOps, name, args ?? {});
    deps.onEvent?.({ type: "tool-result", tool: name, title, ok: outcome.ok, result: outcome.result });
    return outcome.summary;
  } catch (error: any) {
    const message = redactText(String(error?.message ?? error));
    deps.onEvent?.({ type: "tool-result", tool: name, title, ok: false, result: { error: message } });
    return { ok: false, error: message };
  }
}

// Build the AI-SDK tool set the model is offered. Empty when no EngineOps is wired (e.g. a host without an
// engine surface) so the assistant simply falls back to the generic runCommand/knowledge tools.
export function createContainerTools(deps: AgentToolDeps): Record<string, any> {
  if (!deps.engineOps) {
    return {};
  }
  const tools: Record<string, any> = {};
  for (const [name, spec] of Object.entries(SPECS)) {
    tools[name] = tool({
      description: spec.description,
      inputSchema: spec.inputSchema,
      execute: (args: any) => runContainerTool(deps, name, args),
    });
  }
  return tools;
}
