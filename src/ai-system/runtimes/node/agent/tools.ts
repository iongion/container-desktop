// AI-SDK tool definitions for the always-on assistant. MAIN-ONLY.
//
// The runCommand tool exposes ONLY `{ program, args }` — a `.strict()` schema rejects any attempt to
// smuggle a shell, cwd, env, or other process option. The user's permission mode (not a heuristic)
// decides what runs: resolveToolAction maps {mode, floorBlocked, cached} → run / ask / reject. There is
// no auto-run-by-classification. Knowledge lookups are ungated; web search is gated like a command.
// All command output is already redacted by the sandbox; knowledge/web results are model-facing text.

import { tool } from "ai";
import { z } from "zod";
import type { AgentToolDeps, KnowledgeEntry, SandboxCommand } from "@/ai-system/core";
import { commandKey, resolveToolAction } from "@/ai-system/core";
import { createContainerTools } from "./containerTools";
import { isFloorBlocked } from "./sandbox";

export const runCommandInput = z
  .object({
    program: z
      .string()
      .describe("The executable to run, e.g. 'podman' or 'docker'. A bare program name, never a path or shell."),
    args: z
      .array(z.string())
      .default([])
      .describe("Arguments as an array of separate strings (never a single shell line)."),
  })
  .strict();

export const searchKnowledgeInput = z.object({ query: z.string() }).strict();
export const webSearchInput = z.object({ query: z.string() }).strict();

export type { AgentToolDeps } from "@/ai-system/core";

// A per-process unique id for a surfaced approval. Generated main-side (the tool runs in main) and echoed
// back by the renderer in a resolve, so the broker matches the exact pending action — the renderer never
// invents ids. Per-process monotonic ⇒ globally unique across streams.
let actionCounter = 0;
function nextActionId(): string {
  actionCounter += 1;
  return `act-${actionCounter}`;
}

export async function runCommandTool(deps: AgentToolDeps, input: { program: string; args?: string[] }) {
  const command: SandboxCommand = { program: input.program, args: input.args ?? [] };
  const floor = isFloorBlocked(command);
  const cached = deps.cacheLookup?.(commandKey(command.program, command.args));
  const action = resolveToolAction({ mode: deps.mode, floorBlocked: floor.blocked, cached });

  if (action === "reject") {
    const reason = floor.reason ?? "Rejected by your saved permissions.";
    deps.onEvent?.({ type: "rejected", program: command.program, args: command.args, reason });
    return { ok: false, rejected: true, reason } as const;
  }
  if (action === "ask") {
    deps.onEvent?.({
      type: "approval-request",
      actionId: nextActionId(),
      kind: "command",
      program: command.program,
      args: command.args,
      reason: "Requires your approval before it runs.",
    });
    return {
      ok: false,
      awaitingApproval: true,
      reason:
        "This command requires the user's approval before it runs. Do NOT assume it ran or invent its output — stop and let the user decide.",
    } as const;
  }

  // action === "run". In "always allow" the floor is bypassed (enforceFloor:false); every other mode keeps it.
  deps.onEvent?.({ type: "command", program: command.program, args: command.args });
  const res = await deps.runSandboxed(command, { enforceFloor: deps.mode !== "allow" });
  deps.onEvent?.({
    type: "command-result",
    program: command.program,
    args: command.args,
    ok: res.ok,
    stdout: res.stdout,
    stderr: res.stderr,
  });
  return { ok: res.ok, stdout: res.stdout, stderr: res.stderr, code: res.code, truncated: res.truncated };
}

export async function searchKnowledgeTool(deps: AgentToolDeps, input: { query: string }) {
  const hits = await deps.searchKnowledge(input.query);
  return {
    results: hits.slice(0, 5).map((h: KnowledgeEntry) => ({
      id: h.id,
      domain: h.domain,
      title: h.title,
      solution: h.solution,
      commands: h.commands ?? [],
    })),
  };
}

export async function webSearchTool(deps: AgentToolDeps, input: { query: string }) {
  if (!deps.webSearch) {
    throw new Error("AI: web search is not available");
  }
  // Web search is gated like a command, but remembered as ONE switch (queries vary): the cache holds a
  // single web verdict, not per-query rules.
  const action = resolveToolAction({ mode: deps.mode, floorBlocked: false, cached: deps.webVerdict });
  if (action === "reject") {
    deps.onEvent?.({ type: "rejected", program: "web search", args: [input.query], reason: "Web search is blocked." });
    return { awaitingApproval: false, text: "Web search is blocked by the user's permissions; do not retry it." };
  }
  if (action === "ask") {
    deps.onEvent?.({
      type: "approval-request",
      actionId: nextActionId(),
      kind: "web",
      program: "web search",
      args: [input.query],
      reason: "Wants to search the web.",
    });
    return {
      awaitingApproval: true,
      text: "Web search requires the user's approval. Do NOT invent results — stop and let the user decide.",
    };
  }
  const result = await deps.webSearch(input.query);
  return { awaitingApproval: false, text: result.text };
}

// Assemble the AI-SDK tool set the model is offered. webSearch is included only when permitted.
// Typed loosely (the AI-SDK Tool generic + dual-package typing makes a precise annotation noisy);
// the shape is exercised by the unit tests and consumed by streamText's ToolSet.
export function createAgentTools(deps: AgentToolDeps): Record<string, any> {
  const tools: Record<string, any> = {
    // First-class typed container tools (list/inspect/logs/lifecycle/…) when an engine surface is wired.
    ...createContainerTools(deps),
    runCommand: tool({
      description:
        "Run a command on the host to inspect or fix the user's container setup. Depending on the user's permission settings the command may run, be surfaced for the user to approve, or be rejected — never assume it ran; use its returned output. Provide a bare program and an args array — no shell, pipes, or redirects.",
      inputSchema: runCommandInput,
      execute: (input) => runCommandTool(deps, input),
    }),
    searchKnowledge: tool({
      description: "Search the built-in Podman/Docker/WSL/SSH troubleshooting knowledge bank for known fixes.",
      inputSchema: searchKnowledgeInput,
      execute: (input) => searchKnowledgeTool(deps, input),
    }),
  };
  if (deps.webSearch) {
    tools.webSearch = tool({
      description:
        "Search the public web for a container error message or fix. Use only when local knowledge is insufficient.",
      inputSchema: webSearchInput,
      execute: (input) => webSearchTool(deps, input),
    });
  }
  return tools;
}
