// Template registry for AI prompt templates. Callers import the named
// templates from here; the Vite build swaps the implementation to use ?raw imports so the
// .md files are inlined as strings. Tests use the filesystem version.

export interface PromptTemplates {
  agent: string;
}

let _templates: PromptTemplates | null = null;

export function installPromptTemplates(templates: PromptTemplates): void {
  _templates = templates;
}

export function getPromptTemplates(): PromptTemplates {
  if (!_templates) {
    throw new Error("Prompt templates not installed — call installPromptTemplates() at bootstrap");
  }
  return _templates;
}
