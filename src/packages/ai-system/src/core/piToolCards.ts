// How a pi tool call presents in the transcript: which existing card renders it, its one-line title, and the
// card's result shape rebuilt from what pi actually sends.
//
// pi's built-in tools return their payload as TEXT. Their `details` carry only truncation and limit flags —
// `edit` alone is rich (`diff` / `patch` / `firstChangedLine`), and `bash` reports NO exit code (a non-zero
// exit throws, arriving as an error whose text ends "Command exited with code N"). So a card is rebuilt from
// (args, text, details) rather than read off a structured result, and this module is the single place that
// knows pi's text formats. Pure: no react, no node, no sibling layers.

export type PiCardKind = "exec" | "file" | "diff" | "listing" | "search";

// Only pi's built-ins map to a first-party card. A plugin tool — or a built-in nobody has classified — is
// deliberately absent, so the transcript falls back to the generic JSON card instead of guessing a shape.
const PI_TOOL_CARDS: Readonly<Record<string, PiCardKind>> = {
  bash: "exec",
  read: "file",
  write: "file",
  edit: "diff",
  ls: "listing",
  grep: "search",
  find: "search",
};

export function resolvePiCardKind(toolName: string): PiCardKind | undefined {
  return PI_TOOL_CARDS[toolName];
}

export interface PiExecCardResult {
  program: string;
  args: string[];
  stdout: string;
  code: undefined;
  // pi truncates a noisy command and writes the whole thing to a file INSIDE the container, naming it in
  // `details.fullOutputPath`. Carried through so the card can offer to read it back over the bridge.
  fullOutputPath?: string;
}

export interface PiFileCardResult {
  path?: string;
  content: string;
  notice?: string;
}

export interface PiDiffCardResult {
  path?: string;
  patch?: string;
  firstChangedLine?: number;
}

export interface PiListingCardResult {
  path?: string;
  entries: { name: string; kind: "file" | "directory" }[];
  notice?: string;
}

export interface PiSearchMatch {
  path: string;
  line: number;
  text: string;
  context: boolean;
}

export interface PiSearchCardResult {
  pattern?: string;
  matches?: PiSearchMatch[];
  files?: string[];
  notice?: string;
}

export type PiCardResult =
  | PiExecCardResult
  | PiFileCardResult
  | PiDiffCardResult
  | PiListingCardResult
  | PiSearchCardResult;

const MAX_SUMMARY_CHARS = 120;
const EMPTY_DIRECTORY = "(empty directory)";
const NO_MATCHES = "No matches found";
const NO_FILES = "No files found matching pattern";

function stringArg(args: unknown, key: string): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberArg(args: unknown, key: string): number | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// Arguments stream in through `toolcall_delta`, so a title renders from partial ones. Collapsing to the first
// line keeps a heredoc or a multi-command script to one line.
function firstLine(value: string): string {
  const newline = value.indexOf("\n");
  const head = (newline === -1 ? value : value.slice(0, newline)).trimEnd();
  return newline === -1 ? head : `${head}…`;
}

function cap(value: string): string {
  return value.length > MAX_SUMMARY_CHARS ? `${value.slice(0, MAX_SUMMARY_CHARS - 1)}…` : value;
}

// pi's own read renderer labels the range `:start-end` with end = offset + limit - 1.
function readRange(args: unknown): string {
  const offset = numberArg(args, "offset");
  const limit = numberArg(args, "limit");
  if (offset === undefined && limit === undefined) return "";
  const start = offset ?? 1;
  return limit === undefined ? `:${start}` : `:${start}-${start + limit - 1}`;
}

function detail(args: unknown, toolName: string): string {
  switch (toolName) {
    case "bash": {
      const command = stringArg(args, "command");
      return command ? firstLine(command) : "";
    }
    case "read": {
      const path = stringArg(args, "path");
      return path ? `${path}${readRange(args)}` : "";
    }
    case "write":
    case "edit":
      return stringArg(args, "path") ?? "";
    // pi defaults ls to the working directory, and shows that as ".".
    case "ls":
      return stringArg(args, "path") ?? ".";
    case "grep":
    case "find": {
      const pattern = stringArg(args, "pattern");
      if (!pattern) return "";
      const path = stringArg(args, "path");
      return path ? `${firstLine(pattern)} in ${path}` : firstLine(pattern);
    }
    default:
      return "";
  }
}

// The transcript title for a pi tool call: the tool plus the thing it acts on. A tool with no card gets its
// bare name — inventing a summary for a payload we do not understand reads as a lie.
export function piToolSummary(toolName: string, args: unknown): string {
  if (!(toolName in PI_TOOL_CARDS)) return toolName;
  const suffix = detail(args, toolName);
  return cap(suffix ? `${toolName} ${suffix}` : toolName);
}

// Every pi tool appends its truncation and limit warnings as a trailing "\n\n[...]" block. Lifting it out of
// the body keeps it from being parsed as a directory entry or a file's last line, and lets a card show it as
// what it is.
function splitNotice(text: string): { body: string; notice?: string } {
  const trimmed = text.replace(/\s+$/, "");
  const match = /\n\n\[([\s\S]*)\]$/.exec(trimmed);
  if (!match) return { body: trimmed };
  return { body: trimmed.slice(0, match.index), notice: match[1] };
}

function listingEntries(body: string): { name: string; kind: "file" | "directory" }[] {
  if (!body || body === EMPTY_DIRECTORY) return [];
  return body
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) =>
      line.endsWith("/")
        ? { name: line.slice(0, -1), kind: "directory" as const }
        : { name: line, kind: "file" as const },
    );
}

// pi writes a match as `path:LINE: text` and a context line as `path-LINE- text`. A line matching neither is
// dropped rather than shown as a match at line 0.
const GREP_MATCH = /^(.*?):(\d+): ?([\s\S]*)$/;
const GREP_CONTEXT = /^(.*?)-(\d+)- ?([\s\S]*)$/;

function grepMatches(body: string): PiSearchMatch[] {
  if (!body || body === NO_MATCHES) return [];
  const matches: PiSearchMatch[] = [];
  for (const line of body.split("\n")) {
    if (!line) continue;
    const hit = GREP_MATCH.exec(line);
    if (hit) {
      matches.push({ path: hit[1], line: Number(hit[2]), text: hit[3], context: false });
      continue;
    }
    const around = GREP_CONTEXT.exec(line);
    if (around) matches.push({ path: around[1], line: Number(around[2]), text: around[3], context: true });
  }
  return matches;
}

function findFiles(body: string): string[] {
  if (!body || body === NO_FILES) return [];
  return body.split("\n").filter((line) => line.length > 0);
}

function detailNumber(details: unknown, key: string): number | undefined {
  if (typeof details !== "object" || details === null) return undefined;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function detailString(details: unknown, key: string): string | undefined {
  if (typeof details !== "object" || details === null) return undefined;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// Rebuild the result the mapped card reads. Returns undefined when no card claims the tool, which is the
// registry's signal to render pi's own details as JSON.
export function piCardResult(
  toolName: string,
  args: unknown,
  text: string,
  details: unknown,
): PiCardResult | undefined {
  const kind = resolvePiCardKind(toolName);
  if (!kind) return undefined;

  switch (kind) {
    // The command's own output, notice included: for a terminal block a truncation warning is part of what ran.
    case "exec": {
      const fullOutputPath = detailString(details, "fullOutputPath");
      return {
        program: stringArg(args, "command") ?? "",
        args: [],
        stdout: text.replace(/\s+$/, ""),
        code: undefined,
        ...(fullOutputPath ? { fullOutputPath } : {}),
      };
    }

    case "file": {
      // pi answers a write with a byte count, so the content shown is the content asked for.
      if (toolName === "write") {
        return {
          path: stringArg(args, "path"),
          content: (stringArg(args, "content") ?? "").replace(/\s+$/, ""),
          notice: undefined,
        };
      }
      const { body, notice } = splitNotice(text);
      return { path: stringArg(args, "path"), content: body, notice };
    }

    case "diff":
      return {
        path: stringArg(args, "path"),
        patch: detailString(details, "patch"),
        firstChangedLine: detailNumber(details, "firstChangedLine"),
      };

    case "listing": {
      const { body, notice } = splitNotice(text);
      return { path: stringArg(args, "path"), entries: listingEntries(body), notice };
    }

    case "search": {
      const { body, notice } = splitNotice(text);
      const pattern = stringArg(args, "pattern");
      return toolName === "grep"
        ? { pattern, matches: grepMatches(body), notice }
        : { pattern, files: findFiles(body), notice };
    }
  }
}
