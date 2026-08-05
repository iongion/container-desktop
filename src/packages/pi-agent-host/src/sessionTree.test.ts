import { describe, expect, it } from "vitest";

import { projectSessionTree } from "@/pi-agent-host/sessionTree";

function entry(id: string, overrides: Record<string, unknown> = {}) {
  return { type: "message", id, parentId: null, timestamp: "2026-08-04T10:00:00.000Z", ...overrides };
}

function userMessage(id: string, text: string) {
  return entry(id, { message: { role: "user", content: text } });
}

describe("projectSessionTree", () => {
  it("keeps pi's own entry type and the ids a branch switch is named by", () => {
    const tree = projectSessionTree(
      [
        {
          entry: userMessage("e1", "first ask"),
          children: [{ entry: entry("e2", { type: "compaction" }), children: [] }],
        },
      ] as never,
      null,
    );
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("e1");
    expect(tree[0].kind).toBe("message");
    expect(tree[0].role).toBe("user");
    expect(tree[0].children[0].kind).toBe("compaction");
    // Not a message, so there is no author to report — an empty string would read as an anonymous speaker.
    expect(tree[0].children[0].role).toBeUndefined();
  });

  it("reads a preview out of both message content shapes", () => {
    const tree = projectSessionTree(
      [
        { entry: userMessage("e1", "a plain string body"), children: [] },
        {
          entry: entry("e2", {
            message: {
              role: "assistant",
              content: [
                { type: "text", text: "the first block" },
                { type: "text", text: "the second block" },
              ],
            },
          }),
          children: [],
        },
      ] as never,
      null,
    );
    expect(tree[0].preview).toBe("a plain string body");
    expect(tree[1].preview).toBe("the first block the second block");
  });

  it("truncates a preview so a whole conversation cannot travel in a list row", () => {
    const tree = projectSessionTree([{ entry: userMessage("e1", "x".repeat(500)), children: [] }] as never, null);
    expect(tree[0].preview.length).toBeLessThanOrEqual(160);
  });

  it("describes a non-message entry by what it changed, since it has no body", () => {
    const tree = projectSessionTree(
      [
        {
          entry: entry("e1", { type: "model_change", provider: "lmstudio", modelId: "qwen3-4b-instruct-2507" }),
          children: [],
        },
      ] as never,
      null,
    );
    expect(tree[0].preview).toBe("lmstudio/qwen3-4b-instruct-2507");
  });

  it("marks every ancestor of the leaf as current, and no sibling branch", () => {
    const tree = projectSessionTree(
      [
        {
          entry: userMessage("root", "the shared start"),
          children: [
            { entry: userMessage("kept", "the branch we are on"), children: [] },
            { entry: userMessage("other", "the branch we left"), children: [] },
          ],
        },
      ] as never,
      "kept",
    );
    expect(tree[0].current).toBe(true);
    expect(tree[0].children.find((node) => node.id === "kept")?.current).toBe(true);
    expect(tree[0].children.find((node) => node.id === "other")?.current).toBe(false);
  });

  it("marks nothing current when the session has no leaf yet", () => {
    const tree = projectSessionTree([{ entry: userMessage("e1", "first ask"), children: [] }] as never, null);
    expect(tree[0].current).toBe(false);
  });

  it("carries pi's own label when one was set", () => {
    const tree = projectSessionTree(
      [{ entry: userMessage("e1", "first ask"), children: [], label: "before the refactor" }] as never,
      null,
    );
    expect(tree[0].label).toBe("before the refactor");
  });
});
