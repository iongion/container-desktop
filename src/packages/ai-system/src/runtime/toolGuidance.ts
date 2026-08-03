import type { Toolset } from "@/ai-system/runtime/tools/toolset";
import toolGuidanceMarkdown from "@/resources/prompts/tool-guidance.md?raw";
import { renderPrompt } from "@/template/renderPrompt";

export function buildToolGuidance(toolset: Toolset | null): string {
  const tools =
    toolset?.defs
      .filter((definition) => toolset.has(definition.name))
      .map((definition) => ({
        name: definition.name,
        gated: toolset.gated(definition.name),
      })) ?? [];
  return renderPrompt(toolGuidanceMarkdown, { tools });
}
