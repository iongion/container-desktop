// Compose variable interpolation — the `${VAR}` / `$VAR` substitution Compose applies to values, using
// the project `.env` (never the host shell here; see plan). Pure string logic, no I/O.
//
// Faithful to the Compose spec's interpolation rules (https://compose-spec.github.io/compose-spec/12-interpolation.html):
// a recursive parser with BALANCED `${...}` matching so nested forms like `${A:-${B}}` resolve correctly,
// and unsupported shell forms (`${A/x/y}`, `${A#x}`, …) are REJECTED rather than silently mis-read.

export class InterpolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InterpolationError";
  }
}

type Env = Record<string, string>;

const isNameStart = (c: string): boolean => /[A-Za-z_]/.test(c);
const isNameChar = (c: string): boolean => /[A-Za-z0-9_]/.test(c);

const lookup = (name: string, env: Env): string => (Object.hasOwn(env, name) ? env[name] : "");

// Apply a Compose modifier. `arg` is the already-interpolated word after the operator.
function applyOperator(name: string, op: string, arg: string, env: Env): string {
  const defined = Object.hasOwn(env, name);
  const value = defined ? env[name] : "";
  const nonEmpty = defined && value !== "";
  switch (op) {
    case ":-":
      return nonEmpty ? value : arg;
    case "-":
      return defined ? value : arg;
    case ":?":
      if (!nonEmpty) throw new InterpolationError(arg || `required variable "${name}" is missing or empty`);
      return value;
    case "?":
      if (!defined) throw new InterpolationError(arg || `required variable "${name}" is missing`);
      return value;
    case ":+":
      return nonEmpty ? arg : "";
    case "+":
      return defined ? arg : "";
    default:
      return value;
  }
}

// Read a `${...}` body starting just after the opening brace; returns the raw inner text and the index of
// the matching `}`. Braces nest (so `${A:-${B}}` and literal `{}` inside a default both balance correctly).
function readBraced(input: string, start: number): { inner: string; end: number } {
  let depth = 1;
  for (let j = start; j < input.length; j += 1) {
    const ch = input[j];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { inner: input.slice(start, j), end: j };
    }
  }
  throw new InterpolationError(`missing closing "}" in "\${${input.slice(start)}"`);
}

// Resolve the inside of a `${...}` (already balance-extracted). The argument after an operator is itself
// interpolated (recursively), which is what makes nested defaults like `${A:-${B}}` work.
function resolveBraced(inner: string, env: Env): string {
  if (!inner || !isNameStart(inner[0])) {
    throw new InterpolationError(`invalid interpolation "\${${inner}}"`);
  }
  let i = 1;
  while (i < inner.length && isNameChar(inner[i])) i += 1;
  const name = inner.slice(0, i);
  const rest = inner.slice(i);
  if (rest === "") return lookup(name, env);

  let op: string;
  let argRaw: string;
  if (rest.startsWith(":-") || rest.startsWith(":?") || rest.startsWith(":+")) {
    op = rest.slice(0, 2);
    argRaw = rest.slice(2);
  } else if (rest[0] === "-" || rest[0] === "?" || rest[0] === "+") {
    op = rest[0];
    argRaw = rest.slice(1);
  } else {
    // e.g. `${A/foo/bar}`, `${A#x}` — Compose does not support these; fail loudly like compose-go.
    throw new InterpolationError(`unsupported interpolation form "\${${inner}}"`);
  }
  return applyOperator(name, op, interpolateString(argRaw, env), env);
}

/** Substitute Compose `${VAR}` / `$VAR` references in a single string using `env`. */
export function interpolateString(input: string, env: Env): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c !== "$") {
      out += c;
      i += 1;
      continue;
    }
    const next = input[i + 1];
    if (next === "$") {
      out += "$";
      i += 2;
    } else if (next === "{") {
      const { inner, end } = readBraced(input, i + 2);
      out += resolveBraced(inner, env);
      i = end + 1;
    } else if (next !== undefined && isNameStart(next)) {
      let j = i + 1;
      while (j < input.length && isNameChar(input[j])) j += 1;
      out += lookup(input.slice(i + 1, j), env);
      i = j;
    } else {
      // A lone `$` (end of string or before a non-name char) is a literal dollar sign.
      out += "$";
      i += 1;
    }
  }
  return out;
}

/** Deep-interpolate every string value in a parsed compose tree; keys and non-strings pass through. */
export function interpolateTree(value: unknown, env: Env): unknown {
  if (typeof value === "string") return interpolateString(value, env);
  if (Array.isArray(value)) return value.map((v) => interpolateTree(v, env));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolateTree(v, env);
    return out;
  }
  return value;
}
