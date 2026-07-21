// Diagnostic knowledge bank. A small JSON store seeded with built-in
// Podman/Docker/WSL/SSH solutions. The diagnostic agent searches it for known fixes as silent
// grounding (the `searchKnowledge` tool) — it has NO renderer-facing surface and is read-only.
// Storage is a port so the bank is unit-testable without the filesystem; createAISystem wires the
// file-backed store via runtimes/knowledgeFileStorage over the app FS port.
// No Electron/AI-SDK/node:* imports.

import type { KnowledgeEntry } from "@/ai-system/core/ports";
import knowledgeBankMarkdown from "@/resources/prompts/knowledge-bank.md?raw";
import { parseMarkdownSections } from "@/template/markdownSections";

export interface KnowledgeBankData {
  version: number;
  entries: KnowledgeEntry[];
}

export interface KnowledgeStorage {
  load(): Promise<KnowledgeBankData | null>;
  save(data: KnowledgeBankData): Promise<void>;
}

const KNOWLEDGE_DOMAINS = new Set<KnowledgeEntry["domain"]>(["podman", "docker", "wsl", "ssh", "general"]);

function knowledgeField(body: string, name: string): string {
  const match = new RegExp(`^### ${name}\\s*\\n([\\s\\S]*?)(?=^### |$)`, "m").exec(body);
  const value = match?.[1]?.trim() ?? "";
  if (!value && name !== "Commands") throw new Error(`Knowledge entry is missing ${name}`);
  return value;
}

function parseKnowledgeSeed(source: string): KnowledgeEntry[] {
  return Object.entries(parseMarkdownSections(source)).map(([id, body]) => {
    const domain = /^\*\*Domain:\*\*\s*(\S+)\s*$/m.exec(body)?.[1] as KnowledgeEntry["domain"] | undefined;
    if (!domain || !KNOWLEDGE_DOMAINS.has(domain)) throw new Error(`Knowledge entry ${id} has an invalid domain`);
    const tags =
      /^\*\*Tags:\*\*\s*(.+)$/m
        .exec(body)?.[1]
        .split("|")
        .map((tag) => tag.trim())
        .filter(Boolean) ?? [];
    const commands = knowledgeField(body, "Commands")
      .split("\n")
      .map((line) => /^- `([\s\S]+)`$/.exec(line.trim())?.[1])
      .filter((command): command is string => !!command);
    return {
      id,
      domain,
      title: knowledgeField(body, "Title"),
      symptom: knowledgeField(body, "Symptom"),
      solution: knowledgeField(body, "Solution"),
      ...(commands.length > 0 ? { commands } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    };
  });
}

const BUILTIN_SEED = parseKnowledgeSeed(knowledgeBankMarkdown);

const tokenize = (s: string): string[] => s.toLowerCase().match(/[a-z0-9_./-]{2,}/g) ?? [];

export function createKnowledgeBank(deps: { storage: KnowledgeStorage; seed?: KnowledgeEntry[] }) {
  let data: KnowledgeBankData = { version: 1, entries: [] };
  let loaded = false;

  const init = async (): Promise<void> => {
    const existing = await deps.storage.load();
    if (existing && Array.isArray(existing.entries) && existing.entries.length > 0) {
      data = existing;
      loaded = true;
      return;
    }
    const seed = deps.seed ?? BUILTIN_SEED;
    data = { version: 1, entries: seed.map((e) => ({ ...e })) };
    loaded = true;
    await deps.storage.save(data);
  };

  const ensureLoaded = async (): Promise<void> => {
    if (!loaded) await init();
  };

  // Rank by query-term overlap. Read-only — there is no feedback/score machinery.
  const search = async (query: string): Promise<KnowledgeEntry[]> => {
    await ensureLoaded();
    const terms = new Set(tokenize(query));
    if (terms.size === 0) return [];
    const scored = data.entries
      .map((e) => {
        const haystack = tokenize(`${e.title} ${e.symptom} ${e.solution} ${(e.tags ?? []).join(" ")}`);
        let overlap = 0;
        for (const term of haystack) {
          if (terms.has(term)) overlap += 1;
        }
        return { entry: e, overlap };
      })
      .filter((x) => x.overlap > 0);
    scored.sort((a, b) => b.overlap - a.overlap);
    return scored.map((x) => ({ ...x.entry }));
  };

  return { init, search };
}
