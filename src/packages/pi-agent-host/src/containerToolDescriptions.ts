// The container-entry loader for the container tools' model-facing prose. Parallel to
// `template/templateRegistry.vite.ts`: one module per bundler that knows how to read a prompt resource, so the
// prose stays in markdown and no other module has to care how it arrived.
//
// esbuild inlines the markdown as text (`loader: { ".md": "text" }` in support/cli/lib/agent-image.ts). Only the
// container entry imports this — vite and vitest resolve `.md` with the `?raw` suffix instead, so keeping it out
// of `session.ts` is what lets the session stay unit-testable.

import { parseKnowledgeBank } from "@/ai-system/core/knowledgeBank";
import type { KnowledgeEntry } from "@/ai-system/core/ports";
import descriptionsMarkdown from "@/resources/prompts/agent-tool-descriptions.md";
import knowledgeMarkdown from "@/resources/prompts/knowledge-bank.md";
import workspaceDescriptionsMarkdown from "@/resources/prompts/workspace-tool-descriptions.md";
import { parseMarkdownSections } from "@/template/markdownSections";

export function containerToolDescriptions(): Readonly<Record<string, string>> {
  return parseMarkdownSections(descriptionsMarkdown);
}

// The workspace toolset's own prose, in its own file: it describes operations on a FILESYSTEM, which the container
// toolset's descriptions say nothing about, and it is only registered when the session was given a target to run on.
export function workspaceToolDescriptions(): Readonly<Record<string, string>> {
  return parseMarkdownSections(workspaceDescriptionsMarkdown);
}

// The built-in troubleshooting entries, parsed once at startup. Read here for the same reason the descriptions are:
// the loader that knows how a markdown resource arrives is bundler-specific, and the session stays testable without one.
export function knowledgeBankEntries(): KnowledgeEntry[] {
  return parseKnowledgeBank(parseMarkdownSections(knowledgeMarkdown));
}
