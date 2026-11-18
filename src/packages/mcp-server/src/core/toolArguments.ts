// Checks `tools/call` arguments against the tool's input schema with ajv, the validator the app already ships.
// MCP's default JSON Schema dialect is 2020-12, so that is the dialect compiled here.

import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import { toolInputSchema } from "./toolCatalogue";
import type { ContainerToolName } from "./toolNames";

const ajv = new Ajv2020({ allErrors: false, strict: true });
const validators = new Map<ContainerToolName, ValidateFunction>();

function validatorFor(name: ContainerToolName): ValidateFunction {
  let validate = validators.get(name);
  if (!validate) {
    validate = ajv.compile(toolInputSchema(name));
    validators.set(name, validate);
  }
  return validate;
}

// ajv's message, plus the offending name where ajv leaves it out: "must NOT have additional properties" alone does
// not say which argument to drop.
function describe(error: ErrorObject): string {
  const extra = error.keyword === "additionalProperties" ? ` (${error.params.additionalProperty})` : "";
  return `arguments${error.instancePath} ${error.message}${extra}`;
}

// The first reason the arguments do not fit the tool, or undefined when they do.
export function validateToolArguments(name: ContainerToolName, args: Record<string, unknown>): string | undefined {
  const validate = validatorFor(name);
  if (validate(args)) return undefined;
  const [first] = validate.errors ?? [];
  return first ? describe(first) : "arguments do not match the tool's input schema";
}
