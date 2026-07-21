import { describe, expect, it } from "vitest";

import { getProviderEntry } from "@/ai-system/core/providers";

import { buildModelTree, formatSelectedPath, selectedPath } from "./modelCatalog";

const lmstudio = getProviderEntry("lmstudio")!;
const llamacpp = getProviderEntry("llamacpp")!;
const openrouter = getProviderEntry("openrouter")!;

describe("buildModelTree — flat source (LM Studio / clouds, source == provider)", () => {
  it("renders one collapsed group whose leaves are the listed models", () => {
    const tree = buildModelTree({
      entry: lmstudio,
      models: ["qwen2.5-coder-7b", "llama-3.2-3b-instruct"],
      savedModel: "",
    });
    expect(tree.aggregator).toBe(false);
    expect(tree.collapsed).toBe(true);
    expect(tree.groups).toHaveLength(1);
    expect(tree.groups[0].providerId).toBe("lmstudio");
    expect(tree.groups[0].label).toBe("LM Studio");
    expect(tree.groups[0].models.map((m) => m.model)).toEqual(["qwen2.5-coder-7b", "llama-3.2-3b-instruct"]);
    // flat leaf label is the full id (the "/" in an HF org id is NOT split)
    expect(tree.groups[0].models[0].label).toBe("qwen2.5-coder-7b");
  });

  it("keeps an HF-org-prefixed flat id intact (no aggregator split)", () => {
    const tree = buildModelTree({ entry: lmstudio, models: ["unsloth/qwen3.5-9b"], savedModel: "" });
    expect(tree.groups).toHaveLength(1);
    expect(tree.groups[0].models[0].model).toBe("unsloth/qwen3.5-9b");
    expect(tree.groups[0].models[0].label).toBe("unsloth/qwen3.5-9b");
  });

  it("auto-selects the first model when none is saved", () => {
    const tree = buildModelTree({ entry: lmstudio, models: ["a", "b"], savedModel: "" });
    expect(tree.autoSelect).toBe("a");
    expect(tree.groups[0].models[0].selected).toBe(true);
    expect(tree.groups[0].models[1].selected).toBe(false);
  });

  it("selects the saved model and does not auto-select", () => {
    const tree = buildModelTree({ entry: lmstudio, models: ["a", "b"], savedModel: "b" });
    expect(tree.autoSelect).toBeUndefined();
    expect(tree.groups[0].models.find((m) => m.model === "b")?.selected).toBe(true);
  });

  it("keeps a saved model selectable even when the server didn't list it", () => {
    const tree = buildModelTree({ entry: lmstudio, models: ["a"], savedModel: "custom" });
    const ids = tree.groups[0].models.map((m) => m.model);
    expect(ids).toContain("custom");
    expect(tree.groups[0].models.find((m) => m.model === "custom")?.selected).toBe(true);
  });

  it("shows a notice (no leaves) when the server lists nothing and nothing is saved", () => {
    const tree = buildModelTree({ entry: lmstudio, models: [], savedModel: "" });
    expect(tree.groups).toHaveLength(0);
    expect((tree.notice as { nameLabelKey?: string }).nameLabelKey).toMatch(/LM Studio/i);
  });
});

describe("buildModelTree — aggregator (OpenRouter, gateway → upstream provider → model)", () => {
  const models = [
    "anthropic/claude-3.5-sonnet",
    "openai/gpt-4o",
    "anthropic/claude-3-haiku",
    "meta-llama/llama-3.1-70b-instruct",
  ];

  it("groups models by their vendor prefix, preserving first-appearance order", () => {
    const tree = buildModelTree({ entry: openrouter, models, savedModel: "" });
    expect(tree.aggregator).toBe(true);
    expect(tree.collapsed).toBe(false);
    expect(tree.groups.map((g) => g.providerId)).toEqual(["anthropic", "openai", "meta-llama"]);
    const anthropic = tree.groups[0];
    expect(anthropic.label).toBe("Anthropic"); // known upstream → catalog label
    expect(anthropic.models.map((m) => m.model)).toEqual(["anthropic/claude-3.5-sonnet", "anthropic/claude-3-haiku"]);
    // leaf label is the model portion after the vendor prefix; the full id is preserved to persist
    expect(anthropic.models[0].label).toBe("claude-3.5-sonnet");
  });

  it("falls back to the raw vendor segment for an unknown upstream provider", () => {
    const tree = buildModelTree({ entry: openrouter, models, savedModel: "" });
    const meta = tree.groups.find((g) => g.providerId === "meta-llama");
    expect(meta?.label).toBe("meta-llama");
  });

  it("auto-selects the first full vendored id when nothing is saved", () => {
    const tree = buildModelTree({ entry: openrouter, models, savedModel: "" });
    expect(tree.autoSelect).toBe("anthropic/claude-3.5-sonnet");
  });

  it("marks the saved full vendored id as selected", () => {
    const tree = buildModelTree({ entry: openrouter, models, savedModel: "openai/gpt-4o" });
    expect(tree.autoSelect).toBeUndefined();
    const openai = tree.groups.find((g) => g.providerId === "openai");
    expect(openai?.models[0].selected).toBe(true);
  });
});

describe("buildModelTree — single served model (llama.cpp, read-only)", () => {
  it("yields one read-only selected leaf for the served model", () => {
    const tree = buildModelTree({ entry: llamacpp, models: ["qwen2.5-7b-instruct-q4"], savedModel: "" });
    expect(tree.collapsed).toBe(true);
    expect(tree.groups).toHaveLength(1);
    const leaf = tree.groups[0].models[0];
    expect(leaf.model).toBe("qwen2.5-7b-instruct-q4");
    expect(leaf.readOnly).toBe(true);
    expect(leaf.selected).toBe(true);
    // persists the served id so chat uses what the server actually serves
    expect(tree.autoSelect).toBe("qwen2.5-7b-instruct-q4");
  });

  it("does not re-persist when the served model is already saved", () => {
    const tree = buildModelTree({ entry: llamacpp, models: ["m"], savedModel: "m" });
    expect(tree.autoSelect).toBeUndefined();
  });

  it("shows an 'unavailable — start the server' notice when nothing is served (no free-text)", () => {
    const tree = buildModelTree({ entry: llamacpp, models: [], savedModel: "" });
    expect(tree.groups).toHaveLength(0);
    expect((tree.notice as { nameLabelKey?: string }).nameLabelKey).toMatch(/llama\.cpp/i);
  });
});

describe("selectedPath — trigger label segments", () => {
  it("is [source, model] for a flat source", () => {
    expect(selectedPath("lmstudio", "qwen2.5-coder-7b")).toEqual(["LM Studio", "qwen2.5-coder-7b"]);
  });

  it("is [source, upstream-provider, model] for an aggregator", () => {
    expect(selectedPath("openrouter", "anthropic/claude-3.5-sonnet")).toEqual([
      "OpenRouter",
      "Anthropic",
      "claude-3.5-sonnet",
    ]);
  });

  it("uses the raw vendor segment for an unknown upstream provider", () => {
    expect(selectedPath("openrouter", "meta-llama/llama-3.1-70b-instruct")).toEqual([
      "OpenRouter",
      "meta-llama",
      "llama-3.1-70b-instruct",
    ]);
  });

  it("is just the source label when no model is chosen", () => {
    expect(selectedPath("lmstudio", "")).toEqual(["LM Studio"]);
  });

  it("falls back to the raw id for an unknown provider", () => {
    expect(selectedPath("groq", "llama-3.3-70b")).toEqual(["groq", "llama-3.3-70b"]);
  });
});

describe("formatSelectedPath", () => {
  it("translates presentation labels but preserves an opaque model id exactly", () => {
    const path = selectedPath("openrouter", "nvidia/nemotron-3-nano-30b-a3b:free");
    const translate = (value: string) => (value.includes(":") ? "free" : value);

    expect(formatSelectedPath(path, true, translate)).toBe("OpenRouter / nvidia / nemotron-3-nano-30b-a3b:free");
  });

  it("translates the source label when no model is selected", () => {
    expect(formatSelectedPath(["Select a model"], false, (value) => `translated:${value}`)).toBe(
      "translated:Select a model",
    );
  });
});
