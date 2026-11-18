// The container tools as MCP clients see them in `tools/list`: a TypeBox input schema (plain JSON Schema), the
// description from `src/resources/prompts/mcp-tool-descriptions.md`, and the behaviour annotations MCP defines.
// Every schema is closed (`additionalProperties: false`), so only declared arguments ever reach an engine.

import { type TSchema, Type } from "typebox";
import descriptionsSource from "@/resources/prompts/mcp-tool-descriptions.md?raw";
import { parseMarkdownSections } from "./markdownSections";
import { CONTAINER_TOOL_NAMES, type ContainerToolName } from "./toolNames";

// MCP's tool annotations. The spec defaults leave a tool destructive and open-world, so every hint is set here.
export interface McpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
}

export interface McpTool {
  name: ContainerToolName;
  title: string;
  description: string;
  inputSchema: TSchema;
  annotations: McpToolAnnotations;
}

// Optional everywhere: left out, the call acts on the current connection.
const connectionId = Type.Optional(Type.String());
const id = Type.String({ minLength: 1 });
const closed = { additionalProperties: false };

const NO_ARGS = Type.Object({}, closed);
const CONNECTION_ONLY = Type.Object({ connectionId }, closed);
const ENTITY = Type.Object({ id, connectionId }, closed);
const LOGS = Type.Object(
  {
    id,
    tail: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
    since: Type.Optional(Type.String()),
    connectionId,
  },
  closed,
);
const PULL = Type.Object({ reference: Type.String({ minLength: 1 }), connectionId }, closed);

const READ: McpToolAnnotations = { readOnlyHint: true, openWorldHint: false };
// Repeating one of these leaves the engine as the first call did: a started container stays started.
const CHANGE: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const REMOVAL: McpToolAnnotations = { ...CHANGE, destructiveHint: true };

const TOOLS: Readonly<Record<ContainerToolName, { inputSchema: TSchema; annotations: McpToolAnnotations }>> = {
  listConnections: { inputSchema: NO_ARGS, annotations: READ },
  listContainers: { inputSchema: CONNECTION_ONLY, annotations: READ },
  inspectContainer: { inputSchema: ENTITY, annotations: READ },
  getContainerLogs: { inputSchema: LOGS, annotations: READ },
  getContainerStats: { inputSchema: ENTITY, annotations: READ },
  listImages: { inputSchema: CONNECTION_ONLY, annotations: READ },
  inspectImage: { inputSchema: ENTITY, annotations: READ },
  listNetworks: { inputSchema: CONNECTION_ONLY, annotations: READ },
  inspectNetwork: { inputSchema: ENTITY, annotations: READ },
  listVolumes: { inputSchema: CONNECTION_ONLY, annotations: READ },
  inspectVolume: { inputSchema: ENTITY, annotations: READ },
  startContainer: { inputSchema: ENTITY, annotations: CHANGE },
  stopContainer: { inputSchema: ENTITY, annotations: CHANGE },
  // Each call restarts the container again.
  restartContainer: { inputSchema: ENTITY, annotations: { ...CHANGE, idempotentHint: false } },
  pauseContainer: { inputSchema: ENTITY, annotations: CHANGE },
  unpauseContainer: { inputSchema: ENTITY, annotations: CHANGE },
  removeContainer: { inputSchema: ENTITY, annotations: REMOVAL },
  removeImage: { inputSchema: ENTITY, annotations: REMOVAL },
  removeNetwork: { inputSchema: ENTITY, annotations: REMOVAL },
  removeVolume: { inputSchema: ENTITY, annotations: REMOVAL },
  // A pull reaches a registry, and pulling a moving tag again can fetch a newer image.
  pullImage: { inputSchema: PULL, annotations: { ...CHANGE, idempotentHint: false, openWorldHint: true } },
};

// The tools that change an engine: the permission mode decides whether these are listed and run.
export const GATED_CONTAINER_TOOLS: ReadonlySet<ContainerToolName> = new Set(
  CONTAINER_TOOL_NAMES.filter((name) => !TOOLS[name].annotations.readOnlyHint),
);

export function toolInputSchema(name: ContainerToolName): TSchema {
  return TOOLS[name].inputSchema;
}

// `listContainers` → `List containers`.
function humanize(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function buildMcpTools(descriptions: Readonly<Record<string, string>>): McpTool[] {
  return CONTAINER_TOOL_NAMES.map((name) => {
    const description = descriptions[name]?.trim();
    // A tool known only by its name invites a guess at what it does, and a guess can be `removeVolume`.
    if (!description) {
      throw new Error(`MCP tool ${name} has no description in mcp-tool-descriptions.md`);
    }
    return { name, title: humanize(name), description, ...TOOLS[name] };
  });
}

let shipped: readonly McpTool[] | undefined;

// Built on first use rather than at import, so a broken resource fails the MCP request, not the whole app.
export function shippedMcpTools(): readonly McpTool[] {
  shipped ??= buildMcpTools(parseMarkdownSections(descriptionsSource));
  return shipped;
}
