// Vite-specific template loader — imports .md files as raw strings via the Vite ?raw prefix.
// Rolldown (used by vite build) inlines these at bundle time. The node-side tooling uses
// this registry; tests replace it with their own (see templateRegistry.ts / installPromptTemplates).

import agentRaw from "@/resources/prompts/agent.md?raw";
import projectContextRaw from "@/resources/prompts/project-context.md?raw";
import skillInvocationRaw from "@/resources/prompts/skill-invocation.md?raw";
import { installPromptTemplates } from "./templateRegistry";

installPromptTemplates({
  agent: agentRaw,
  skillInvocation: skillInvocationRaw,
  projectContext: projectContextRaw,
});
