import type { LLMToolDef } from "@open-multi-agent/core";
import { z } from "zod";
import { redactPayload } from "@/ai-system/core/redact";
import { humanizeToolName, type Toolset } from "@/ai-system/runtime/tools/toolset";
import { WORKSPACE_TOOL_SPECS } from "@/ai-system/runtime/tools/workspaceToolSpecs";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";

// Builds the workspace Toolset from WORKSPACE_TOOL_SPECS (descriptions, Zod v4 input schemas, gated flags, and the
// IWorkspaceAccess-backed `run`). Identical shape to the container toolset, so the loop drives both through one
// merged Toolset. The host port enforces workspace-root confinement; results are redacted here at the boundary.
export function buildWorkspaceToolset(workspace: IWorkspaceAccess): Toolset {
  const specs = WORKSPACE_TOOL_SPECS;
  const defs: LLMToolDef[] = [];
  for (const [name, spec] of Object.entries(specs)) {
    defs.push({
      name,
      description: spec.description,
      inputSchema: z.toJSONSchema(spec.inputSchema) as Record<string, unknown>,
    });
  }
  const specOf = (name: string) => specs[name as keyof typeof specs];
  return {
    defs,
    has: (name) => Boolean(specOf(name)),
    gated: (name) => Boolean(specOf(name)?.gated),
    title: humanizeToolName,
    validate(name, input) {
      const spec = specOf(name);
      if (!spec) return { ok: false, error: `unknown tool: ${name}` };
      const parsed = spec.inputSchema.safeParse(input ?? {});
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.message };
    },
    async run(name, input) {
      const spec = specOf(name);
      if (!spec) throw new Error(`unknown tool: ${name}`);
      const out = await spec.run(workspace, input);
      return { ok: out.ok, result: redactPayload(out.result), summary: redactPayload(out.summary) };
    },
  };
}
