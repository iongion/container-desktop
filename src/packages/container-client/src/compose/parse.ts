// Thin YAML front-end for compose files. Uses the pure-JS `yaml` package (no node builtins), and
// normalizes failures + non-mapping documents into a typed error the UI can surface.

import { parse } from "yaml";

export class ComposeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposeParseError";
  }
}

// Parse compose YAML text into a raw object (anchors/aliases resolved). Throws on malformed input.
export function parseComposeYaml(text: string): unknown {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (error) {
    throw new ComposeParseError(`Invalid compose YAML: ${(error as Error).message}`);
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new ComposeParseError("Compose file must be a YAML mapping (top-level object)");
  }
  return doc;
}
