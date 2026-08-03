import type { LLMToolDef } from "@open-multi-agent/core";
import { z } from "zod";
import { redactPayload } from "@/ai-system/core/redact";
import type { EngineOps } from "@/ai-system/core/types";
import { CONTAINER_TOOL_SPECS } from "@/ai-system/runtime/tools/containerToolSpecs";
import { humanizeToolName, type Toolset } from "@/ai-system/runtime/tools/toolset";

// Builds the container Toolset from the app's engine-agnostic CONTAINER_TOOL_SPECS (reused verbatim: descriptions,
// Zod input schemas, gated flags, and the EngineOps-backed `run`). This never imports OMA's barrel, so the
// node-bound built-in tools (bash/fs) stay out of the webview bundle.
export function buildContainerToolset(engineOps: EngineOps): Toolset {
  const specs = CONTAINER_TOOL_SPECS;
  const defs: LLMToolDef[] = [];
  for (const [name, spec] of Object.entries(specs)) {
    if (!spec) continue;
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
      const out = await spec.run(engineOps, input);
      return { ok: out.ok, result: redactPayload(out.result), summary: redactPayload(out.summary) };
    },
  };
}
