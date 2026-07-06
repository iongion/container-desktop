// Schema validation against the vendored OFFICIAL compose-spec JSON Schema (draft 2020-12). Using the
// upstream schema is "parity by construction" — it never drifts from what Docker/Compose accepts.
// ajv + ajv-formats are pure-JS (renderer-safe).

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import schema from "./schema/compose-spec.schema.json";

export class ComposeValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid compose file:\n${issues.join("\n")}`);
    this.name = "ComposeValidationError";
    this.issues = issues;
  }
}

// strict:false — the upstream schema uses keywords/metadata ajv would otherwise warn on; we only want
// structural validation, not schema-authoring lint.
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema as object);

/** Validate a raw parsed compose object against the compose spec. Throws with the offending paths. */
export function validateComposeSpec(doc: unknown): void {
  if (validate(doc)) return;
  const issues = (validate.errors ?? []).map((e) => `${e.instancePath || "/"}: ${e.message}`);
  throw new ComposeValidationError(issues.length ? issues : ["does not match the compose specification"]);
}
