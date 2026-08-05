// The GUI's model of a pi plugin: what pi's package manager has configured, joined with what each package
// actually contributes. Pure — the inputs are the bridge's wire shapes, so the renderer never pulls the
// coding agent into its graph.
//
// This classifies and screens a source; it does NOT resolve one. pi owns resolution (hosted-git-info, npm
// spec ranges, install paths) inside the container, and an install the GUI accepted can still fail there with
// pi's own error. What happens here is what only the GUI can do: name the thing for the table, and refuse
// input that has no business reaching an npm invocation.

import type {
  ConfiguredPluginPackage,
  ContributedResource,
  ContributedResources,
  PluginScope,
} from "@/pi-bridge/protocol";

export type PluginSourceKind = "npm" | "git" | "local";

export type ParsedPluginSource =
  | { kind: PluginSourceKind; spec: string; name: string; version?: string }
  | { kind: "invalid"; reason: string };

// Nothing that could split a command, expand a variable or smuggle a second argument. A space counts too:
// the source ends up in an argv, and no npm spec or git URL needs one.
const FORBIDDEN_CHARACTERS = /[;&|`$<>() ]/;

// Control characters are checked by code point instead of inside that class: a literal one in a regex is
// invisible, and a newline smuggled into a source is exactly what has to be caught.
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

const GIT_URL_SCHEME = /^(https?|ssh|git):\/\//i;
const SCP_LIKE_GIT = /^git@[^:]+:/;
// pi's own npm spec split: an optional scope, then an optional `@version`.
const NPM_SPEC = /^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/;

function invalid(reason: string): ParsedPluginSource {
  return { kind: "invalid", reason };
}

// The ref is appended to the last path segment, so only look there: the `@` in `git@host:path` is part of the
// host, not a ref. `#ref` is accepted too, which is what hosted URLs carry.
function splitGitRef(url: string): { repo: string; ref?: string } {
  const hash = url.indexOf("#");
  if (hash > 0) return { repo: url.slice(0, hash), ref: url.slice(hash + 1) || undefined };
  const lastSeparator = Math.max(url.lastIndexOf("/"), url.lastIndexOf(":"));
  const at = url.indexOf("@", lastSeparator + 1);
  if (at > lastSeparator) return { repo: url.slice(0, at), ref: url.slice(at + 1) || undefined };
  return { repo: url };
}

function gitDisplayName(repo: string): string {
  const withoutScheme = repo.replace(/^[a-z+]+:\/\//i, "").replace(/^git@/, "");
  const path = withoutScheme
    .replace(":", "/")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);
  return segments.slice(-2).join("/") || path;
}

function localDisplayName(path: string): string {
  const segments = path
    .replace(/^file:\/\//, "")
    .replace(/\/+$/, "")
    .split("/");
  return segments[segments.length - 1] || path;
}

function parseGitSource(input: string): ParsedPluginSource {
  const spec = input.replace(/^git:/, "");
  const { repo, ref } = splitGitRef(spec);
  const name = gitDisplayName(repo);
  if (!name) return invalid("the source names no repository");
  return ref ? { kind: "git", spec, name, version: ref } : { kind: "git", spec, name };
}

function parseNpmSource(input: string): ParsedPluginSource {
  const spec = input.slice("npm:".length).trim();
  if (!spec) return invalid("npm: needs a package name");
  if (spec.startsWith("-")) return invalid("a source cannot start with a dash");
  const match = NPM_SPEC.exec(spec);
  const name = match?.[1];
  if (!name) return invalid(`not an npm package spec: ${spec}`);
  const version = match?.[2];
  return version ? { kind: "npm", spec, name, version } : { kind: "npm", spec, name };
}

export function parsePluginSource(input: string): ParsedPluginSource {
  const trimmed = input.trim();
  if (!trimmed) return invalid("empty source");
  if (FORBIDDEN_CHARACTERS.test(trimmed) || hasControlCharacter(trimmed)) {
    return invalid("a source cannot contain shell characters");
  }
  if (trimmed.startsWith("-")) return invalid("a source cannot start with a dash");
  if (trimmed.startsWith("npm:")) return parseNpmSource(trimmed);
  if (trimmed.startsWith("git:") || GIT_URL_SCHEME.test(trimmed) || SCP_LIKE_GIT.test(trimmed)) {
    return parseGitSource(trimmed);
  }
  if (trimmed.startsWith("github:")) return parseGitSource(trimmed.replace(/^github:/, ""));
  if (/^(\/|~|\.{1,2}\/|file:\/\/)/.test(trimmed)) {
    return { kind: "local", spec: trimmed, name: localDisplayName(trimmed) };
  }
  // pi would read a bare word as a relative path. In a GUI it is nearly always a forgotten prefix, and
  // guessing wrong installs from the wrong place — so say what is missing instead.
  return invalid("prefix the source with npm: or git:, or give a path");
}

export interface PluginRow {
  source: string;
  name: string;
  kind: PluginSourceKind;
  scope: PluginScope;
  enabled: boolean;
  installed: boolean;
  commands: string[];
  skills: string[];
  prompts: string[];
}

function namesFrom(resources: ContributedResource[], source: string): string[] {
  return resources.filter((resource) => resource.source === source).map((resource) => resource.name);
}

export function buildPluginRows(input: {
  configured: ConfiguredPluginPackage[];
  resources: ContributedResources;
}): PluginRow[] {
  return input.configured.map((entry) => {
    const parsed = parsePluginSource(entry.source);
    // A source pi accepted but this parser cannot classify still gets a row: hiding it would leave the user
    // with a plugin they cannot see, let alone remove.
    const kind = parsed.kind === "invalid" ? "local" : parsed.kind;
    const name = parsed.kind === "invalid" ? entry.source : parsed.name;
    return {
      source: entry.source,
      name,
      kind,
      scope: entry.scope,
      enabled: entry.autoload !== false,
      installed: Boolean(entry.installedPath),
      commands: namesFrom(input.resources.commands, entry.source),
      skills: namesFrom(input.resources.skills, entry.source),
      prompts: namesFrom(input.resources.prompts, entry.source),
    };
  });
}
