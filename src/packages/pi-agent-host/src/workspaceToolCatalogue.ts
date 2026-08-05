// The workspace toolset as pi needs to see it: one descriptor per operation with the TypeBox schema pi validates
// against and serializes to the model. Pure data — no rpc, no pi imports — so the shapes are testable without a
// session, exactly like the container catalogue beside it.
//
// The names are the app's OWN workspace tool names (`WORKSPACE_TOOL_NAMES`), because its cards, its gating table and
// its context report all key off them: a workspace call arrives in the GUI already understood. The prose lives in
// `src/resources/prompts/workspace-tool-descriptions.md` and is injected rather than imported, which keeps that
// markdown out of the unit-test graph.
//
// Paths are WORKSPACE-RELATIVE throughout. Confinement is the host capability's job — it canonicalizes and rejects
// `..` and symlink escapes inside the implementation — never this layer's, which only names the operation.

import { type TSchema, Type } from "typebox";

export interface WorkspaceToolSpec {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
}

const PATH = Type.Object({ path: Type.String() });

const PARAMETERS: Readonly<Record<string, TSchema>> = {
  readFile: PATH,
  // The only optional path in the set: omitting it lists the workspace root, which is where exploring starts.
  listDirectory: Type.Object({ path: Type.Optional(Type.String()) }),
  statPath: PATH,
  findFiles: Type.Object({ pattern: Type.String() }),
  searchText: Type.Object({
    pattern: Type.String(),
    glob: Type.Optional(Type.String()),
    maxResults: Type.Optional(Type.Number()),
  }),
  writeFile: Type.Object({ path: Type.String(), contents: Type.String() }),
  editFile: Type.Object({
    path: Type.String(),
    oldString: Type.String(),
    newString: Type.String(),
    replaceAll: Type.Optional(Type.Boolean()),
  }),
  removePath: PATH,
  execCommand: Type.Object({ program: Type.String(), args: Type.Optional(Type.Array(Type.String())) }),
};

// The order the app declares them in, so the registered set and `WORKSPACE_TOOL_NAMES` read the same.
const WORKSPACE_OPS = [
  "readFile",
  "listDirectory",
  "statPath",
  "findFiles",
  "searchText",
  "writeFile",
  "editFile",
  "removePath",
  "execCommand",
] as const;

// `readFile` → `Read file`. pi shows this in its own surfaces, which this GUI does not render, so it is derived
// rather than translated — a real i18n key would promise a translation nothing displays.
function humanize(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function workspaceToolSpecs(descriptions: Readonly<Record<string, string>>): WorkspaceToolSpec[] {
  return WORKSPACE_OPS.map((name) => {
    const description = descriptions[name];
    // A blank description leaves the model guessing from the name alone — which is how a model reaches for
    // `removePath` to "tidy up". Fail loudly at startup instead.
    if (!description?.trim()) {
      throw new Error(`workspace tool ${name} has no description in the tool descriptions resource`);
    }
    const parameters = PARAMETERS[name];
    if (!parameters) throw new Error(`workspace tool ${name} has no parameter schema`);
    return { name, label: humanize(name), description: description.trim(), parameters };
  });
}
