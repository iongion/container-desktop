// Pure, schema-free model for rendering ARBITRARY JSON as a tree. Kept separate from the React
// component so the recursion / type-detection / formatting is unit-tested without a DOM. The genuine
// Blueprint <Tree> in JsonTreeView.tsx maps this model to TreeNodeInfo[] (label + caret only).

export type JsonValueKind = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface JsonTreeNodeModel {
  // Stable, unique id derived from the path (used as the React/Tree node id).
  id: string;
  // Display key (object property) or array index.
  key: string;
  // True when the parent is an array (renders the key muted, as an index).
  isIndex: boolean;
  kind: JsonValueKind;
  // Leaves only: the JSON-formatted display value (strings quoted+escaped, e.g. `"nginx"`, `42`, `null`).
  valueText?: string;
  // Branches only: a compact count badge, e.g. `{ 3 }` / `[ 2 ]`.
  summary?: string;
  // Branches only (may be empty for `{}` / `[]`).
  children?: JsonTreeNodeModel[];
}

function kindOf(value: unknown): JsonValueKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "object") return "object";
  if (t === "number") return "number";
  if (t === "boolean") return "boolean";
  return "string";
}

function formatLeaf(value: unknown): string {
  if (value === null) return "null";
  // JSON.stringify keeps embedded quotes/escapes valid; only strings need the quoting.
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function childEntries(value: object): Array<[string, unknown, boolean]> {
  if (Array.isArray(value)) {
    return value.map((item, index) => [String(index), item, true]);
  }
  return Object.keys(value).map((key) => [key, (value as Record<string, unknown>)[key], false]);
}

function nodeFor(key: string, value: unknown, isIndex: boolean, parentPath: string): JsonTreeNodeModel {
  const id = `${parentPath}/${key}`;
  const kind = kindOf(value);
  if (kind === "object" || kind === "array") {
    const children = childEntries(value as object).map(([k, v, ix]) => nodeFor(k, v, ix, id));
    const summary = kind === "array" ? `[ ${children.length} ]` : `{ ${children.length} }`;
    return { id, key, isIndex, kind, summary, children };
  }
  return { id, key, isIndex, kind, valueText: formatLeaf(value) };
}

// Returns the TOP-LEVEL nodes: one per key (object) / index (array). A primitive root becomes a single
// keyless node so the caller can still render something.
export function buildJsonTree(value: unknown): JsonTreeNodeModel[] {
  const kind = kindOf(value);
  if (kind === "object" || kind === "array") {
    return childEntries(value as object).map(([k, v, ix]) => nodeFor(k, v, ix, "$"));
  }
  return [nodeFor("", value, false, "$")];
}

export type SafeParseResult = { ok: true; data: unknown } | { ok: false; error: string };

// Never throws: malformed / incomplete JSON is reported so the viewer can fall back to the raw text.
export function safeParseJson(text: string): SafeParseResult {
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
