// Prompt builders for the AI assistant — render the Nunjucks `.md` templates in ./templates via renderPrompt().
import type { DiagnosticsBundle } from "@/ai-system/core";

import { renderPrompt } from "./renderPrompt";
import { getPromptTemplates } from "./templateRegistry";

export function buildGeneratePrompt(kind: "dockerfile" | "compose"): string {
  return renderPrompt(getPromptTemplates().generate, { kind });
}

export function buildAgentPrompt(bundle?: DiagnosticsBundle): string {
  const tpl = getPromptTemplates().agent;
  return renderPrompt(tpl, {
    os: bundle?.os,
    engine: bundle?.engine,
    connection: bundle?.connection,
    activity: bundle?.activity,
    resources: bundle?.resources,
    errors: bundle?.errors,
  });
}
