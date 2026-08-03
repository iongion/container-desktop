import { MAX_ASSISTANT_COMMAND_ARGUMENTS, MAX_ASSISTANT_COMMAND_CHARS } from "@/ai-system/core/limits";
import type {
  AssistantCommandDefinition,
  AssistantCommandErrorCode,
  AssistantCommandRegistry,
  AssistantInputParseResult,
} from "./commandTypes";
import { completeCommands } from "./completeCommand";

interface Token {
  value: string;
  end: number;
}

type TokenizeResult = { tokens: Token[] } | { error: "unterminated-quote" };

function tokenize(input: string): TokenizeResult {
  const tokens: Token[] = [];
  let value = "";
  let quote: '"' | "'" | undefined;
  let escaping = false;
  const commit = (end: number) => {
    if (value) tokens.push({ value, end });
    value = "";
  };
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (escaping) {
      value += character;
      escaping = false;
    } else if (character === "\\") escaping = true;
    else if (quote) {
      if (character === quote) quote = undefined;
      else value += character;
    } else if (character === '"' || character === "'") quote = character;
    else if (/\s/.test(character)) commit(index);
    else value += character;
  }
  if (escaping) value += "\\";
  if (quote) return { error: "unterminated-quote" };
  commit(input.length);
  return { tokens };
}

function matchingCommand(
  tokens: readonly Token[],
  registry: AssistantCommandRegistry,
): { command: AssistantCommandDefinition; pathLength: number } | undefined {
  let matched: { command: AssistantCommandDefinition; pathLength: number } | undefined;
  for (const entry of registry.lookup) {
    const expected = entry.name.split(" ");
    if (expected.every((part, index) => tokens[index]?.value.toLocaleLowerCase() === part)) {
      if (!matched || entry.pathLength > matched.pathLength) {
        matched = { command: entry.command, pathLength: entry.pathLength };
      }
    }
  }
  return matched;
}

function parseArguments(
  command: AssistantCommandDefinition,
  tokens: readonly Token[],
  rawArguments: string,
): string[] | AssistantCommandErrorCode {
  if (tokens.length > MAX_ASSISTANT_COMMAND_ARGUMENTS) return "too-many-arguments";
  if (command.arguments.kind === "none") return tokens.length === 0 ? [] : "too-many-arguments";
  if (command.arguments.kind === "text") {
    if (command.arguments.required && !rawArguments) return "missing-argument";
    return rawArguments ? [tokens.map(({ value }) => value).join(" ")] : [];
  }
  if (tokens.length < command.arguments.min) return "missing-argument";
  if (tokens.length > command.arguments.max) return "too-many-arguments";
  return tokens.map(({ value }) => value);
}

function error(
  code: AssistantCommandErrorCode,
  query: string,
  registry: AssistantCommandRegistry,
): AssistantInputParseResult {
  const messageKey: Record<AssistantCommandErrorCode, string> = {
    "too-long": "Command is too long",
    "too-many-arguments": "Too many command arguments",
    "unterminated-quote": "Close the quoted argument",
    "unknown-command": "Unknown command",
    "missing-argument": "Command needs an argument",
  };
  return {
    kind: "error",
    code,
    messageKey: messageKey[code],
    suggestions: completeCommands(query, registry)
      .slice(0, 3)
      .map(({ command }) => command.id),
  };
}

export function parseAssistantInput(input: string, registry: AssistantCommandRegistry): AssistantInputParseResult {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { kind: "message", text: trimmed };
  if (trimmed.startsWith("//")) return { kind: "message", text: trimmed.slice(1) };
  if (trimmed.length > MAX_ASSISTANT_COMMAND_CHARS) return error("too-long", trimmed, registry);

  const tokenized = tokenize(trimmed);
  if ("error" in tokenized) return error(tokenized.error, trimmed, registry);
  const match = matchingCommand(tokenized.tokens, registry);
  if (!match) return error("unknown-command", trimmed, registry);

  const argumentTokens = tokenized.tokens.slice(match.pathLength);
  const lastPathToken = tokenized.tokens[match.pathLength - 1];
  const rawArguments = lastPathToken ? trimmed.slice(lastPathToken.end).trim() : "";
  const args = parseArguments(match.command, argumentTokens, rawArguments);
  if (typeof args === "string") return error(args, match.command.path, registry);
  return { kind: "command", id: match.command.id, command: match.command, args, rawArguments };
}
