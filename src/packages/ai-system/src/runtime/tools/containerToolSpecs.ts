// First-class TYPED container tools. The model calls these (listContainers, getContainerLogs,
// startContainer, …) instead of assembling shell strings — each runs against the engine through the
// injected EngineOps port (backed by EngineDataService). AgentSession maps the AI SDK's stream parts into
// generative-UI events. Every result is redacted before it reaches the model or renderer. Read tools are ungated;
// mutating tools use the session's native approval policy before this execution-only path runs.

import { z } from "zod";
import { type ContainerToolName, isContainerToolName } from "@/ai-system/core/toolNames";
import type {
  EngineContainer,
  EngineContainerStats,
  EngineImage,
  EngineNetwork,
  EngineOps,
  EngineVolume,
} from "@/ai-system/core/types";
import toolDescriptionsMarkdown from "@/resources/prompts/agent-tool-descriptions.md?raw";
import { parseMarkdownSections } from "@/template/markdownSections";

const TOOL_DESCRIPTIONS = parseMarkdownSections(toolDescriptionsMarkdown);

function toolDescription(name: ContainerToolName): string {
  const description = TOOL_DESCRIPTIONS[name];
  if (!description) throw new Error(`Missing container tool description: ${name}`);
  return description;
}

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

function summariseContainer(c: EngineContainer) {
  const state = c.Computed?.DecodedState ?? (typeof c.State === "string" ? c.State : c.Status);
  return {
    Id: short(c.Id),
    Name: c.Computed?.Name ?? c.Name ?? c.Names?.[0] ?? "",
    Image: c.Image ?? c.ImageName ?? "",
    State: state ?? "",
  };
}

function summariseImage(i: EngineImage) {
  return { Id: short(i.Id), Name: i.FullName ?? i.Names?.[0] ?? "", Tag: i.Tag ?? "", Size: i.Size };
}

function summariseNetwork(n: EngineNetwork) {
  return { id: short(n.id), name: n.name, driver: n.driver };
}

function summariseVolume(v: EngineVolume) {
  return { Name: v.Name, Driver: v.Driver, Mountpoint: v.Mountpoint };
}

function summariseStats(s: EngineContainerStats) {
  return { name: s.name, memoryUsage: s.memory_stats?.usage, memoryLimit: s.memory_stats?.limit };
}

function tailLines(text: string, n: number): string {
  const lines = text.split(/\r?\n/);
  return lines.length <= n ? text : lines.slice(-n).join("\n");
}

// A tool's contract: how to describe it to the model, validate its input, gate it, and run it. `run`
// returns the FULL typed payload (`result`, for the card) plus a compact `summary` (for the model);
// executeContainerTool redacts both. The session policy handles gated mutations before `run` is called.
export interface ContainerToolSpec {
  description: string;
  inputSchema: z.ZodTypeAny;
  gated: boolean;
  run: (ops: EngineOps, args: any) => Promise<{ ok: boolean; result: unknown; summary: unknown }>;
}

type SummariseFn = (value: any) => unknown;

// Read tools are ungated. The two genuinely one-off shapes stay explicit; the repeating list/single-entity
// shapes are driven by the tables below (mirroring ENTITY_MUTATIONS).
export const CONTAINER_TOOL_SPECS: Partial<Record<ContainerToolName, ContainerToolSpec>> = {
  listConnections: {
    description: toolDescription("listConnections"),
    inputSchema: noArgs,
    gated: false,
    run: async (ops) => {
      const items = ops.listConnections();
      return { ok: true, result: items, summary: items };
    },
  },
  getContainerLogs: {
    description: toolDescription("getContainerLogs"),
    inputSchema: logsInput,
    gated: false,
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
};

// List reads: connRef input; the full array goes to the card, a per-item summary to the model.
const LIST_READS: ReadonlyArray<{ name: ContainerToolName; method: keyof EngineOps; summarise: SummariseFn }> = [
  { name: "listContainers", method: "listContainers", summarise: summariseContainer },
  { name: "listImages", method: "listImages", summarise: summariseImage },
  { name: "listNetworks", method: "listNetworks", summarise: summariseNetwork },
  { name: "listVolumes", method: "listVolumes", summarise: summariseVolume },
];
for (const t of LIST_READS) {
  CONTAINER_TOOL_SPECS[t.name] = {
    description: toolDescription(t.name),
    inputSchema: connRef,
    gated: false,
    run: async (ops, args) => {
      const list = ops[t.method] as (a: { connectionId?: string }) => Promise<unknown[]>;
      const items = await list({ connectionId: args.connectionId });
      return { ok: true, result: items, summary: items.map(t.summarise) };
    },
  };
}

// Single-entity reads: entityRef input. `reportMissing` tools (container/image) surface a not-found result;
// the rest (network/volume/stats) assume the entity exists, matching each op's original contract.
const ENTITY_READS: ReadonlyArray<{
  name: ContainerToolName;
  method: keyof EngineOps;
  summarise: SummariseFn;
  reportMissing: boolean;
}> = [
  { name: "inspectContainer", method: "inspectContainer", summarise: summariseContainer, reportMissing: true },
  { name: "inspectImage", method: "inspectImage", summarise: summariseImage, reportMissing: true },
  { name: "inspectNetwork", method: "inspectNetwork", summarise: summariseNetwork, reportMissing: false },
  { name: "inspectVolume", method: "inspectVolume", summarise: summariseVolume, reportMissing: false },
  { name: "getContainerStats", method: "getContainerStats", summarise: summariseStats, reportMissing: false },
];
for (const t of ENTITY_READS) {
  CONTAINER_TOOL_SPECS[t.name] = {
    description: toolDescription(t.name),
    inputSchema: entityRef,
    gated: false,
    run: async (ops, args) => {
      const read = ops[t.method] as (a: { connectionId?: string; id: string }) => Promise<unknown>;
      const item = await read({ connectionId: args.connectionId, id: args.id });
      if (t.reportMissing) {
        return { ok: !!item, result: item ?? null, summary: item ? t.summarise(item) : { error: "not found" } };
      }
      return { ok: true, result: item, summary: t.summarise(item) };
    },
  };
}

export function describeContainerTool(name: string): { gated: boolean } | undefined {
  if (!isContainerToolName(name)) return undefined;
  const spec = CONTAINER_TOOL_SPECS[name];
  return spec ? { gated: spec.gated } : undefined;
}

// Mutating tools — gated by the permission mode (run / ask / reject). Each returns a compact { ok, op, id }
// action result (rendered by ActionResultCard). The lifecycle ops route through performAction in the adapter
// so the resource store refreshes; removes/pull refresh their domain.
const pullImageInput = z.object({ connectionId: z.string().optional(), reference: z.string().min(1) }).strict();

const ENTITY_MUTATIONS: ReadonlyArray<{
  name: ContainerToolName;
  method: keyof EngineOps;
  op: string;
  description: string;
}> = [
  {
    name: "startContainer",
    method: "startContainer",
    op: "start",
    description: toolDescription("startContainer"),
  },
  {
    name: "stopContainer",
    method: "stopContainer",
    op: "stop",
    description: toolDescription("stopContainer"),
  },
  {
    name: "restartContainer",
    method: "restartContainer",
    op: "restart",
    description: toolDescription("restartContainer"),
  },
  {
    name: "pauseContainer",
    method: "pauseContainer",
    op: "pause",
    description: toolDescription("pauseContainer"),
  },
  {
    name: "unpauseContainer",
    method: "unpauseContainer",
    op: "unpause",
    description: toolDescription("unpauseContainer"),
  },
  {
    name: "removeContainer",
    method: "removeContainer",
    op: "remove",
    description: toolDescription("removeContainer"),
  },
  {
    name: "removeImage",
    method: "removeImage",
    op: "remove",
    description: toolDescription("removeImage"),
  },
  {
    name: "removeNetwork",
    method: "removeNetwork",
    op: "remove",
    description: toolDescription("removeNetwork"),
  },
  {
    name: "removeVolume",
    method: "removeVolume",
    op: "remove",
    description: toolDescription("removeVolume"),
  },
];

for (const m of ENTITY_MUTATIONS) {
  CONTAINER_TOOL_SPECS[m.name] = {
    description: m.description,
    inputSchema: entityRef,
    gated: true,
    run: async (ops, args) => {
      const call = ops[m.method] as (a: { connectionId?: string; id: string }) => Promise<boolean>;
      const ok = !!(await call({ connectionId: args.connectionId, id: args.id }));
      const payload = { ok, op: m.op, id: args.id };
      return { ok, result: payload, summary: payload };
    },
  };
}

CONTAINER_TOOL_SPECS.pullImage = {
  description: toolDescription("pullImage"),
  inputSchema: pullImageInput,
  gated: true,
  run: async (ops, args) => {
    const ok = await ops.pullImage({ connectionId: args.connectionId, reference: args.reference });
    const payload = { ok, op: "pull", id: args.reference };
    return { ok, result: payload, summary: payload };
  },
};
