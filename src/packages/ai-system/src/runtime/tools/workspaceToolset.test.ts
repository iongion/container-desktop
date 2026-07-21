import { describe, expect, it } from "vitest";
import { z } from "zod";
import { WORKSPACE_TOOL_NAMES } from "@/ai-system/core/workspaceToolNames";
import { WORKSPACE_TOOL_SPECS } from "@/ai-system/runtime/tools/workspaceToolSpecs";
import { buildWorkspaceToolset } from "@/ai-system/runtime/tools/workspaceToolset";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";

// A workspace whose ops throw unless overridden — tests wire in only the op they exercise.
function fakeWorkspace(overrides: Partial<IWorkspaceAccess> = {}): IWorkspaceAccess {
  const notImpl = (name: string) => async (): Promise<never> => {
    throw new Error(`not implemented: ${name}`);
  };
  return {
    root: async () => "/ws",
    read: notImpl("read"),
    write: notImpl("write"),
    edit: notImpl("edit"),
    list: notImpl("list"),
    stat: notImpl("stat"),
    remove: notImpl("remove"),
    glob: notImpl("glob"),
    grep: notImpl("grep"),
    exec: notImpl("exec"),
    ...overrides,
  } as IWorkspaceAccess;
}

describe("workspace tool specs", () => {
  it("declares a spec for exactly the workspace tool names", () => {
    expect(Object.keys(WORKSPACE_TOOL_SPECS).sort()).toEqual([...WORKSPACE_TOOL_NAMES].sort());
  });

  it("round-trips every input schema through Zod v4 toJSONSchema and safeParse", () => {
    for (const name of WORKSPACE_TOOL_NAMES) {
      const spec = WORKSPACE_TOOL_SPECS[name];
      const json = z.toJSONSchema(spec.inputSchema) as { type?: string };
      expect(json.type).toBe("object");
      expect(() => spec.inputSchema.safeParse({})).not.toThrow();
    }
  });

  it("gates exactly the mutating tools", () => {
    const gated = WORKSPACE_TOOL_NAMES.filter((name) => WORKSPACE_TOOL_SPECS[name].gated).sort();
    expect(gated).toEqual(["editFile", "execCommand", "removePath", "writeFile"].sort());
  });
});

describe("buildWorkspaceToolset", () => {
  it("offers a def per spec and validates input via the Zod schema", () => {
    const toolset = buildWorkspaceToolset(fakeWorkspace());
    expect(toolset.defs.map((d) => d.name).sort()).toEqual([...WORKSPACE_TOOL_NAMES].sort());
    expect(toolset.has("readFile")).toBe(true);
    expect(toolset.has("nope")).toBe(false);
    expect(toolset.gated("readFile")).toBe(false);
    expect(toolset.gated("editFile")).toBe(true);
    expect(toolset.validate("readFile", { path: 123 }).ok).toBe(false);
    expect(toolset.validate("readFile", { path: "a.ts" })).toMatchObject({ ok: true, value: { path: "a.ts" } });
  });

  it("runs readFile through the workspace port, returning full content in result", async () => {
    const toolset = buildWorkspaceToolset(fakeWorkspace({ read: async (path) => `contents of ${path}` }));
    const out = await toolset.run("readFile", { path: "a.ts" });
    expect(out.ok).toBe(true);
    expect(out.result).toMatchObject({ path: "a.ts", content: "contents of a.ts" });
  });

  it("reports a nonzero-exit command as not ok", async () => {
    const toolset = buildWorkspaceToolset(
      fakeWorkspace({
        exec: async (program, args) => ({ program, args, code: 1, stdout: "", stderr: "boom", truncated: false }),
      }),
    );
    const out = await toolset.run("execCommand", { program: "false", args: [] });
    expect(out.ok).toBe(false);
    expect(out.result).toMatchObject({ code: 1, stderr: "boom" });
  });
});
