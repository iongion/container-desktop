// First-class TYPED workspace tools. The model calls these (readFile, editFile, searchText, …) to inspect and
// change files in the confined workspace, instead of assembling shell strings. Each runs through the injected
// IWorkspaceAccess host port, which enforces workspace-root confinement host-side. `run` returns the FULL typed
// payload (`result`, for the card) plus a compact `summary` (for the model); the toolset redacts both at the
// trust boundary. Read tools are ungated; mutating tools (write/edit/remove/exec) are `gated` and pass the
// session approval policy before `run` is called. Dependency-free (core): no OMA, ai, react, node, electron.

import { z } from "zod";
import type { WorkspaceToolName } from "@/ai-system/core/workspaceToolNames";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";
import workspaceToolDescriptionsMarkdown from "@/resources/prompts/workspace-tool-descriptions.md?raw";
import { parseMarkdownSections } from "@/template/markdownSections";

const TOOL_DESCRIPTIONS = parseMarkdownSections(workspaceToolDescriptionsMarkdown);

function toolDescription(name: WorkspaceToolName): string {
  const description = TOOL_DESCRIPTIONS[name];
  if (!description) throw new Error(`Missing workspace tool description: ${name}`);
  return description;
}

// Input schemas — `.strict()` so the model passes ONLY the declared fields. Paths are workspace-relative; the
// host rejects anything that escapes the root (never trust these to be safe here).
const pathInput = z.object({ path: z.string().min(1) }).strict();
const listInput = z.object({ path: z.string().optional() }).strict();
const globInput = z.object({ pattern: z.string().min(1) }).strict();
const searchInput = z
  .object({
    pattern: z.string().min(1),
    glob: z.string().optional(),
    maxResults: z.number().int().positive().max(1000).optional(),
  })
  .strict();
const writeInput = z.object({ path: z.string().min(1), contents: z.string() }).strict();
const editInput = z
  .object({
    path: z.string().min(1),
    oldString: z.string().min(1),
    newString: z.string(),
    replaceAll: z.boolean().optional(),
  })
  .strict();
const execInput = z.object({ program: z.string().min(1), args: z.array(z.string()).optional() }).strict();

// Keep the model-facing summary lean; the full payload goes to the card.
const MODEL_TEXT_BUDGET = 8_000;

function tail(text: string, n: number): string {
  const lines = text.split(/\r?\n/);
  return lines.length <= n ? text : lines.slice(-n).join("\n");
}

// A workspace tool's contract: how to describe it to the model, validate its input, gate it, and run it against
// the workspace port. Mirrors ContainerToolSpec (ops → workspace).
export interface WorkspaceToolSpec {
  description: string;
  inputSchema: z.ZodTypeAny;
  gated: boolean;
  run: (workspace: IWorkspaceAccess, args: any) => Promise<{ ok: boolean; result: unknown; summary: unknown }>;
}

export const WORKSPACE_TOOL_SPECS: Record<WorkspaceToolName, WorkspaceToolSpec> = {
  readFile: {
    description: toolDescription("readFile"),
    inputSchema: pathInput,
    gated: false,
    run: async (ws, args) => {
      const content = await ws.read(args.path);
      return {
        ok: true,
        result: { path: args.path, content },
        summary: { path: args.path, bytes: content.length, content: content.slice(0, MODEL_TEXT_BUDGET) },
      };
    },
  },
  listDirectory: {
    description: toolDescription("listDirectory"),
    inputSchema: listInput,
    gated: false,
    run: async (ws, args) => {
      const entries = await ws.list(args.path);
      return { ok: true, result: { path: args.path ?? ".", entries }, summary: entries };
    },
  },
  statPath: {
    description: toolDescription("statPath"),
    inputSchema: pathInput,
    gated: false,
    run: async (ws, args) => {
      const stat = await ws.stat(args.path);
      return { ok: true, result: stat, summary: stat };
    },
  },
  findFiles: {
    description: toolDescription("findFiles"),
    inputSchema: globInput,
    gated: false,
    run: async (ws, args) => {
      const files = await ws.glob(args.pattern);
      return {
        ok: true,
        result: { pattern: args.pattern, files },
        summary: { pattern: args.pattern, count: files.length, files: files.slice(0, 200) },
      };
    },
  },
  searchText: {
    description: toolDescription("searchText"),
    inputSchema: searchInput,
    gated: false,
    run: async (ws, args) => {
      const matches = await ws.grep(args.pattern, { glob: args.glob, maxResults: args.maxResults });
      return {
        ok: true,
        result: { pattern: args.pattern, matches },
        summary: { pattern: args.pattern, count: matches.length, matches: matches.slice(0, 100) },
      };
    },
  },
  writeFile: {
    description: toolDescription("writeFile"),
    inputSchema: writeInput,
    gated: true,
    run: async (ws, args) => {
      await ws.write(args.path, args.contents);
      return {
        ok: true,
        result: { path: args.path, bytes: args.contents.length, contents: args.contents },
        summary: { path: args.path, bytes: args.contents.length },
      };
    },
  },
  editFile: {
    description: toolDescription("editFile"),
    inputSchema: editInput,
    gated: true,
    run: async (ws, args) => {
      const edited = await ws.edit(args.path, args.oldString, args.newString, args.replaceAll);
      return { ok: true, result: edited, summary: { path: edited.path, replacements: edited.replacements } };
    },
  },
  removePath: {
    description: toolDescription("removePath"),
    inputSchema: pathInput,
    gated: true,
    run: async (ws, args) => {
      await ws.remove(args.path);
      return { ok: true, result: { path: args.path, removed: true }, summary: { path: args.path, removed: true } };
    },
  },
  execCommand: {
    description: toolDescription("execCommand"),
    inputSchema: execInput,
    gated: true,
    run: async (ws, args) => {
      const out = await ws.exec(args.program, args.args ?? []);
      return {
        ok: out.code === 0,
        result: out,
        summary: {
          program: out.program,
          args: out.args,
          code: out.code,
          stdout: tail(out.stdout, 40),
          stderr: tail(out.stderr, 20),
          truncated: out.truncated,
        },
      };
    },
  },
};
