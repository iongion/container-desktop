// Minimal `.env` / `env_file` parser (KEY=VALUE) — dotenv-flavored, pure string logic. Deliberately NOT
// the `dotenv` npm package: its only entrypoint (lib/main.js) `require`s `fs`/`path`/`os`/`crypto` at top
// level and its `browser` field stubs only `fs`, so importing it drags `path`/`os`/`crypto` into the
// renderer bundle (container-client is renderer-shared). This covers the cases compose env-files use:
// blank lines, `#` comment lines, an optional `export ` prefix, trailing inline comments on unquoted
// values, and single/double quoted values (double quotes process `\n \r \t \" \\`).

// Parse `.env`-style content into a flat record.
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trimStart();
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    out[key] = parseValue(line.slice(eq + 1).trim());
  }
  return out;
}

const DOUBLE_QUOTE_ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" };

function parseValue(value: string): string {
  if (value === "") return "";
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1);
    if (end !== -1) {
      const inner = value.slice(1, end);
      // Double quotes process common escapes; single quotes are literal.
      return quote === '"' ? inner.replace(/\\([nrt"\\])/g, (_m, c) => DOUBLE_QUOTE_ESCAPES[c] ?? c) : inner;
    }
    return value; // unbalanced quote — keep the raw text
  }
  // Unquoted: a trailing inline comment (preceded by whitespace) is stripped.
  const hash = value.search(/\s#/);
  return (hash === -1 ? value : value.slice(0, hash)).trim();
}
