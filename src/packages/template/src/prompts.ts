// Prompt builders — render the Nunjucks `.md` templates (src/resources/prompts) via renderPrompt.
import { renderPrompt } from "./renderPrompt";
import { getPromptTemplates } from "./templateRegistry";

// The subset of runtime diagnostics the agent template renders. Declared locally (not imported from
// ai-system) so src/prompt has ZERO ai-system dependency; ai-system's DiagnosticsBundle is structurally
// assignable to this.
export interface AgentPromptContext {
  os?: string;
  engine?: string;
  connection?: string;
  screen?: string;
  activity?: string;
  resources?: string;
  errors?: string;
}

export function buildAgentPrompt(bundle?: AgentPromptContext): string {
  const tpl = getPromptTemplates().agent;
  return renderPrompt(tpl, {
    os: bundle?.os,
    engine: bundle?.engine,
    connection: bundle?.connection,
    screen: bundle?.screen,
    activity: bundle?.activity,
    resources: bundle?.resources,
    errors: bundle?.errors,
  });
}
