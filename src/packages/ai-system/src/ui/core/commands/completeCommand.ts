import { MAX_ASSISTANT_COMMAND_MATCHES } from "@/ai-system/core/limits";
import type { AssistantCommandMatch, AssistantCommandRegistry, AssistantCommandText } from "./commandTypes";

function textValue(text: AssistantCommandText): string {
  return text.kind === "i18n" ? text.key : text.value;
}

function withinOneEdit(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1 || left.length > 120 || right.length > 120) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length >= right.length) leftIndex += 1;
    if (right.length >= left.length) rightIndex += 1;
  }
  return edits + (leftIndex < left.length || rightIndex < right.length ? 1 : 0) <= 1;
}

function matchScore(value: string, query: string): number | undefined {
  const candidate = value.toLocaleLowerCase();
  const queryWithoutSlash = query.replace(/^\//, "");
  if (candidate === query) return 0;
  if (candidate.startsWith(query)) return 1;
  if (candidate.split(/[\s./_:-]+/).some((part) => part.startsWith(queryWithoutSlash))) return 2;
  if (candidate.includes(query)) return 3;
  if (withinOneEdit(candidate, query)) return 4;
  return undefined;
}

export function completeCommands(query: string, registry: AssistantCommandRegistry): AssistantCommandMatch[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized || normalized === "/") {
    return registry.commands
      .slice(0, MAX_ASSISTANT_COMMAND_MATCHES)
      .map((command) => ({ command, matchedBy: command.path }));
  }

  return registry.commands
    .map((command, order) => {
      const candidates = [
        command.path,
        ...command.aliases,
        ...command.hiddenSearchTerms,
        textValue(command.description),
        textValue(command.category),
      ];
      const matches = candidates
        .map((value) => ({ value, score: matchScore(value, normalized) }))
        .filter((match): match is { value: string; score: number } => match.score !== undefined)
        .sort((left, right) => left.score - right.score);
      return matches[0] ? { command, matchedBy: matches[0].value, score: matches[0].score, order } : undefined;
    })
    .filter(
      (
        match,
      ): match is { command: (typeof registry.commands)[number]; matchedBy: string; score: number; order: number } =>
        !!match,
    )
    .sort((left, right) => left.score - right.score || left.order - right.order)
    .slice(0, MAX_ASSISTANT_COMMAND_MATCHES)
    .map(({ command, matchedBy }) => ({ command, matchedBy }));
}
