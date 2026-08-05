// The one place a `workspace_op` host request becomes a call on the workspace-access port. Pure and dependency-free
// (core): the container names an operation, this validates the name against the app's own workspace tool list and
// answers with a value or a reason — never a throw, because the caller is answering a blocked agent and a rejected
// promise there would leave pi waiting on a request nothing settles.
//
// Names are checked against WORKSPACE_TOOL_NAMES rather than reflected off the port, so `constructor`, `toString`
// and everything else reachable through the prototype can never be dispatched. Path confinement is NOT done here:
// the host capability canonicalizes and rejects escapes inside its own implementation, which is the only place it
// cannot be bypassed.

import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";
import type { WorkspaceOpRequest, WorkspaceOpResult } from "@/pi-bridge/protocol";

import { isWorkspaceToolName, type WorkspaceToolName } from "./workspaceToolNames";

export function isWorkspaceOpName(value: string): boolean {
  return isWorkspaceToolName(value);
}

// Narrow an untrusted host_request payload into a request, or nothing. A payload naming a tool that is not a
// workspace operation is not an error to report to the model — it is a request this app does not serve.
export function parseWorkspaceOpRequest(payload: Record<string, unknown>): WorkspaceOpRequest | undefined {
  const op = payload.op;
  if (typeof op !== "string" || !isWorkspaceOpName(op)) return undefined;
  const args = payload.args;
  const usable = typeof args === "object" && args !== null && !Array.isArray(args);
  return { op, args: usable ? (args as Record<string, unknown>) : {} };
}

class MissingArgument extends Error {}

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  // An empty string is a real answer for `newString` (a deletion), so only a wrong TYPE is a missing argument.
  if (typeof value !== "string") throw new MissingArgument(`${key} is required and must be a string`);
  return value;
}

function optionalStr(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringList(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new MissingArgument(`${key} must be an array of strings`);
  }
  return value as string[];
}

async function perform(
  workspace: IWorkspaceAccess,
  op: WorkspaceToolName,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (op) {
    case "readFile":
      return workspace.read(str(args, "path"));
    case "listDirectory":
      return workspace.list(optionalStr(args, "path"));
    case "statPath":
      return workspace.stat(str(args, "path"));
    case "findFiles":
      return workspace.glob(str(args, "pattern"));
    case "searchText": {
      const glob = optionalStr(args, "glob");
      const maxResults = optionalNumber(args, "maxResults");
      return workspace.grep(str(args, "pattern"), {
        ...(glob ? { glob } : {}),
        ...(maxResults === undefined ? {} : { maxResults }),
      });
    }
    case "writeFile":
      await workspace.write(str(args, "path"), str(args, "contents"));
      return { path: str(args, "path"), written: true };
    case "editFile":
      return workspace.edit(
        str(args, "path"),
        str(args, "oldString"),
        str(args, "newString"),
        args.replaceAll === true,
      );
    case "removePath":
      await workspace.remove(str(args, "path"));
      return { path: str(args, "path"), removed: true };
    case "execCommand":
      return workspace.exec(str(args, "program"), stringList(args, "args"));
  }
}

export async function dispatchWorkspaceOp(
  workspace: IWorkspaceAccess | undefined,
  request: WorkspaceOpRequest,
): Promise<WorkspaceOpResult> {
  if (!workspace) {
    return {
      ok: false,
      error: "This session has no workspace target, so workspace tools cannot run. Choose one when starting a session.",
    };
  }
  if (!isWorkspaceToolName(request.op)) {
    return { ok: false, error: `Unknown workspace operation: ${request.op}` };
  }
  try {
    return { ok: true, value: await perform(workspace, request.op, request.args ?? {}) };
  } catch (error) {
    // The target's own message is the useful one — "no such file" or a non-zero exit tells the model what to do
    // next, where a generic failure would make it retry the same call.
    return { ok: false, error: (error as Error).message };
  }
}
