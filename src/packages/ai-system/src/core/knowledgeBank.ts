// The built-in troubleshooting knowledge, as structure. Curated entries for real podman, docker, WSL and SSH
// failures — a symptom, what fixes it, and the commands that do — kept in markdown
// (`src/resources/prompts/knowledge-bank.md`) because they are model-facing prose, and read here so the agent can
// SEARCH them rather than be handed all of them.
//
// Searched, never prompted: the whole bank is around 900 tokens of context that a turn about anything else pays for
// and never reads. A tool costs nothing until the model asks, and asking is exactly what a model does when it is
// diagnosing an engine.
//
// Pure and dependency-free (core): the markdown is INJECTED, not imported, so the bundler that reads it stays the
// caller's problem and this module stays testable with a string.

import type { KnowledgeDomain, KnowledgeEntry } from "./ports";

const DOMAINS: readonly KnowledgeDomain[] = ["podman", "docker", "wsl", "ssh", "general"];

// A `### Heading` inside one entry. `##` starts an entry, so these are the entry's own fields.
function fields(body: string): Record<string, string> {
  const found: Record<string, string> = {};
  let key: string | undefined;
  let lines: string[] = [];
  const commit = () => {
    if (key) found[key] = lines.join("\n").trim();
  };
  for (const line of body.split("\n")) {
    const heading = /^###[ \t]+(.*)$/.exec(line);
    if (!heading) {
      if (key) lines.push(line);
      continue;
    }
    commit();
    key = heading[1].trim().toLowerCase();
    lines = [];
  }
  commit();
  return found;
}

function labelled(body: string, label: string): string | undefined {
  const match = new RegExp(`^\\*\\*${label}:\\*\\*[ \\t]*(.*)$`, "m").exec(body);
  return match?.[1].trim() || undefined;
}

// A `- \`command\`` list, unwrapped: the model is given the command to run, not markdown to strip.
function commands(body: string): string[] {
  return body
    .split("\n")
    .map((line) => /^[-*][ \t]+(.*)$/.exec(line.trim())?.[1]?.trim())
    .filter((value): value is string => !!value)
    .map((value) => value.replace(/^`(.*)`$/, "$1"));
}

function domainOf(body: string): KnowledgeDomain {
  const declared = labelled(body, "Domain")?.toLowerCase();
  return DOMAINS.find((domain) => domain === declared) ?? "general";
}

// The entries, in the order the file declares them, from the file's `##` sections — split by the caller, which is
// what keeps the markdown reader (and its bundler) out of core. An entry missing a symptom or a solution is DROPPED
// rather than half-reported: the model would act on it either way, and half an answer about a real failure is worse
// than none.
export function parseKnowledgeBank(sections: Readonly<Record<string, string>>): KnowledgeEntry[] {
  const entries: KnowledgeEntry[] = [];
  for (const [id, body] of Object.entries(sections)) {
    const parts = fields(body);
    if (!parts.symptom?.trim() || !parts.solution?.trim()) continue;
    const tags = labelled(body, "Tags")
      ?.split("|")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const runnable = parts.commands ? commands(parts.commands) : [];
    entries.push({
      id,
      domain: domainOf(body),
      title: parts.title?.trim() || id,
      symptom: parts.symptom.trim(),
      solution: parts.solution.trim(),
      ...(runnable.length ? { commands: runnable } : {}),
      ...(tags?.length ? { tags } : {}),
    });
  }
  return entries;
}

// How many entries one search may answer with. Enough to cover a symptom that fits two engines, few enough that a
// vague query cannot hand the model the whole bank through the back door.
export const KNOWLEDGE_SEARCH_LIMIT = 5;

function score(entry: KnowledgeEntry, terms: readonly string[]): number {
  const title = entry.title.toLowerCase();
  const symptom = entry.symptom.toLowerCase();
  const solution = entry.solution.toLowerCase();
  const tags = (entry.tags ?? []).map((tag) => tag.toLowerCase());
  let total = 0;
  for (const term of terms) {
    // A symptom is what the user reported, so a term found there is the strongest signal there is; the id and the
    // tags are the curator's own index, and the solution is where a command name lives.
    if (symptom.includes(term)) total += 4;
    if (title.includes(term)) total += 3;
    if (entry.id.toLowerCase().includes(term) || tags.some((tag) => tag.includes(term))) total += 2;
    if (solution.includes(term)) total += 1;
    if (entry.domain === term) total += 2;
  }
  return total;
}

// Every entry that matches at least one term, best first, capped. Ties keep the file's own order — the curator put
// the commonest failure first, and a stable answer is worth more than an arbitrary re-ranking.
export function searchKnowledgeBank(
  entries: readonly KnowledgeEntry[],
  query: string,
  limit = KNOWLEDGE_SEARCH_LIMIT,
): KnowledgeEntry[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9._/-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);
  if (!terms.length) return [];
  return entries
    .map((entry, index) => ({ entry, index, rank: score(entry, terms) }))
    .filter((scored) => scored.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .slice(0, limit)
    .map((scored) => scored.entry);
}
