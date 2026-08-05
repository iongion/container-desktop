// The built-in troubleshooting knowledge, offered to the model as a search rather than pasted into every system
// prompt. Registered from inside the agent container and answered THERE: the entries are curated markdown shipped in
// the image, so nothing about this needs the app, the engine or the network — which is why it is not a host request.

import type { ExtensionFactory, InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { KNOWLEDGE_SEARCH_LIMIT, searchKnowledgeBank } from "@/ai-system/core/knowledgeBank";
import type { KnowledgeEntry } from "@/ai-system/core/ports";

type NamedInlineExtension = Extract<InlineExtension, { factory: ExtensionFactory }>;

export const KNOWLEDGE_TOOL_NAME = "searchKnowledge";

// What the model reads: the symptom it can match against, the fix, and the commands that apply it. The id travels so
// a card and a follow-up question can name the same entry.
function entryText(entry: KnowledgeEntry): string {
  return [
    `## ${entry.title} (${entry.id}, ${entry.domain})`,
    `Symptom: ${entry.symptom}`,
    `Solution: ${entry.solution}`,
    ...(entry.commands?.length ? [`Commands:${entry.commands.map((command) => `\n  ${command}`).join("")}`] : []),
  ].join("\n");
}

export function createKnowledgeToolExtension(options: {
  entries: readonly KnowledgeEntry[];
  description: string;
}): NamedInlineExtension {
  const { entries, description } = options;
  return {
    name: "container-desktop-knowledge",
    factory: (pi) => {
      pi.registerTool({
        name: KNOWLEDGE_TOOL_NAME,
        label: "Search knowledge",
        description,
        parameters: Type.Object({ query: Type.String() }),
        async execute(_toolCallId, params) {
          const query =
            typeof (params as { query?: unknown })?.query === "string" ? (params as { query: string }).query : "";
          const found = searchKnowledgeBank(entries, query, KNOWLEDGE_SEARCH_LIMIT);
          // Nothing found is an answer, not an error: this bank covers engine failures and says so, rather than
          // leaving the model to read a throw as "the tool is broken" and try it again.
          if (!found.length) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `No built-in entry matches "${query}". This bank covers podman, docker, WSL and SSH connection failures only.`,
                },
              ],
              details: { matches: 0, entries: [] },
            };
          }
          return {
            content: [{ type: "text" as const, text: found.map(entryText).join("\n\n") }],
            details: { matches: found.length, entries: found },
          };
        },
      });
    },
  };
}
