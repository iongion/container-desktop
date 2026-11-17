// The container toolset as pi needs to see it: one descriptor per operation, with the TypeBox parameter schema
// pi validates against and serializes to the model. Pure data — no rpc, no pi imports — so the shapes are
// testable without a session.
//
// The names are the app's own container tool names, deliberately: its cards, presentations and permission gating
// all key off them, so reusing them means a container tool arrives in the GUI already understood. The
// descriptions are model-facing prose and therefore live in `src/resources/prompts/agent-tool-descriptions.md`,
// injected here rather than imported, which keeps that markdown out of the unit-test graph.

import { type TSchema, Type } from "typebox";

export interface ContainerToolSpec {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
}

// Optional everywhere: a model that omits it acts on the connection its session runs against, which the app
// fills in when it dispatches. Naming one reaches that engine instead.
const connectionId = Type.Optional(Type.String());

const NO_ARGS = Type.Object({});
const CONNECTION_ONLY = Type.Object({ connectionId });
const ENTITY = Type.Object({ id: Type.String(), connectionId });

// Operation name → parameter schema. Anything absent takes the entity shape, which is what every inspect and
// every lifecycle or removal action uses.
const PARAMETERS: Readonly<Record<string, TSchema>> = {
  listConnections: NO_ARGS,
  listContainers: CONNECTION_ONLY,
  listImages: CONNECTION_ONLY,
  listNetworks: CONNECTION_ONLY,
  listVolumes: CONNECTION_ONLY,
  getContainerLogs: Type.Object({
    id: Type.String(),
    tail: Type.Optional(Type.Number()),
    since: Type.Optional(Type.String()),
    connectionId,
  }),
  pullImage: Type.Object({ reference: Type.String(), connectionId }),
};

// The order the app declares them in, kept so the registered set and CONTAINER_TOOL_NAMES read the same.
const CONTAINER_OPS = [
  "listConnections",
  "listContainers",
  "inspectContainer",
  "getContainerLogs",
  "getContainerStats",
  "listImages",
  "inspectImage",
  "listNetworks",
  "inspectNetwork",
  "listVolumes",
  "inspectVolume",
  "startContainer",
  "stopContainer",
  "restartContainer",
  "pauseContainer",
  "unpauseContainer",
  "removeContainer",
  "removeImage",
  "removeNetwork",
  "removeVolume",
  "pullImage",
] as const;

// `listContainers` → `List containers`. pi shows this in its own surfaces, which this GUI does not render, so it
// is derived rather than translated — a real i18n key would promise a translation nothing displays.
function humanize(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function containerToolSpecs(descriptions: Readonly<Record<string, string>>): ContainerToolSpec[] {
  return CONTAINER_OPS.map((name) => {
    const description = descriptions[name];
    // A blank description would leave the model guessing what the tool does from its name alone, which is how a
    // model ends up calling `removeVolume` to "clean up". Fail loudly at startup instead.
    if (!description?.trim()) {
      throw new Error(`container tool ${name} has no description in the tool descriptions resource`);
    }
    return { name, label: humanize(name), description: description.trim(), parameters: PARAMETERS[name] ?? ENTITY };
  });
}
