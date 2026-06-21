// Vite-specific template loader — imports .md files as raw strings via the Vite ?raw prefix.
// Rolldown (used by vite build) inlines these at bundle time. The Electron main process uses
// this registry; tests replace it with their own (see templateRegistry.ts / installPromptTemplates).

import { installPromptTemplates } from "./templateRegistry";
import agentRaw from "./templates/agent.md?raw";
import generateRaw from "./templates/generate.md?raw";

installPromptTemplates({
  generate: generateRaw,
  agent: agentRaw,
});
