import type { LLMToolDef } from "@open-multi-agent/core";

// A Toolset is the engine-neutral surface the owned loop drives: the LLMToolDef[] offered to the adapter plus
// the validate/gate/run/title operations keyed by tool name. Both the container toolset (EngineOps-backed) and
// the workspace toolset (IWorkspaceAccess-backed) implement it, so the loop is agnostic to what a tool does.

// The outcome of running one tool: `result` is the full typed payload the UI card renders; `summary` is the
// compact value fed back to the model. Both are redacted at the trust boundary before leaving the toolset.
export interface ToolRunResult {
  ok: boolean;
  result: unknown;
  summary: unknown;
}

export interface Toolset {
  // LLMToolDef[] handed to the adapter (JSON Schema via Zod v4's native exporter — never OMA's bundled Zod-v3
  // converter, and never OMA's tool barrel, which would drag node:child_process into the renderer).
  readonly defs: LLMToolDef[];
  has(name: string): boolean;
  gated(name: string): boolean;
  title(name: string): string;
  validate(name: string, input: unknown): { ok: true; value: unknown } | { ok: false; error: string };
  run(name: string, input: unknown): Promise<ToolRunResult>;
}

// Humanize a camelCase tool id for the event title, e.g. "readFile" → "Read File". The renderer re-titles via
// the i18n toolTitle (ui/core/toolTitle) using this as the fallback, so it only shows for tools it can't name.
export function humanizeToolName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

// Narrow a toolset to an allowlist — how a worker's granular tool policy is enforced. Returns null when nothing
// survives, matching mergeToolsets' empty case so the caller offers no tools at all.
//
// EVERY operation is filtered, not just `defs`. A model can emit a call for a tool it was never offered —
// hallucinated, or planted by injected text in a file it WAS allowed to read — and the loop checks `has` before
// gating. If `has` still answered for the whole set, a worker allowlisted to reads could reach a mutating tool and
// a remembered allow would execute it. A filtered-out name must be indistinguishable from an unknown one.
export function filterToolset(toolset: Toolset, allowed: ReadonlySet<string>): Toolset | null {
  const defs = toolset.defs.filter((def) => allowed.has(def.name));
  if (defs.length === 0) return null;
  const permitted = (name: string): boolean => allowed.has(name) && toolset.has(name);
  return {
    defs,
    has: permitted,
    // A filtered-out tool is not "ungated", it is absent — answering true here would read as "safe to run".
    gated: (name) => permitted(name) && toolset.gated(name),
    // NOT filtered: the loop reads the title before the has-check when building the event, so throwing would turn
    // a benign hallucinated name into a mid-turn exception.
    title: (name) => toolset.title(name),
    validate: (name, input) =>
      permitted(name) ? toolset.validate(name, input) : { ok: false, error: `unknown tool: ${name}` },
    run: async (name, input) => {
      if (!permitted(name)) throw new Error(`unknown tool: ${name}`);
      return toolset.run(name, input);
    },
  };
}

// Combine several toolsets into one the loop drives as a unit. Tool names are unique across parts (container
// ids never collide with workspace ids), so `defs` is a straight concatenation and each op resolves to its owning
// part. Returns null when no parts are active, so the loop offers no tools at all.
export function mergeToolsets(parts: ReadonlyArray<Toolset | null | undefined>): Toolset | null {
  const active = parts.filter((part): part is Toolset => Boolean(part));
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];
  const owner = (name: string): Toolset | undefined => active.find((part) => part.has(name));
  return {
    defs: active.flatMap((part) => part.defs),
    has: (name) => active.some((part) => part.has(name)),
    gated: (name) => owner(name)?.gated(name) ?? false,
    title: (name) => owner(name)?.title(name) ?? humanizeToolName(name),
    validate: (name, input) => owner(name)?.validate(name, input) ?? { ok: false, error: `unknown tool: ${name}` },
    run: (name, input) => {
      const part = owner(name);
      if (!part) throw new Error(`unknown tool: ${name}`);
      return part.run(name, input);
    },
  };
}
