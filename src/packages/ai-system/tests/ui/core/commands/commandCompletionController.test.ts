import { describe, expect, it } from "vitest";

import {
  BUILTIN_ASSISTANT_COMMAND_REGISTRY,
  BUILTIN_ASSISTANT_COMMANDS,
} from "@/ai-system/ui/core/commands/commandCatalog";
import {
  applyAssistantCommandCompletionEdit,
  createAssistantCommandCompletionActor,
} from "@/ai-system/ui/core/commands/commandCompletionController";
import { createAssistantCommandRegistry } from "@/ai-system/ui/core/commands/commandRegistry";
import type { AssistantSkillCommandDefinition } from "@/ai-system/ui/core/commands/commandTypes";

const input = (value: string, selectionStart = value.length, selectionEnd = selectionStart) => ({
  value,
  selectionStart,
  selectionEnd,
});

function skill(index: number): AssistantSkillCommandDefinition {
  return {
    id: `skill.user.test-${index}`,
    kind: "skill",
    skillId: `user:test-${index}`,
    source: { kind: "user-skill", fingerprint: `sha256:${index}` },
    path: `/skill:user:test-${index}`,
    aliases: [],
    category: { kind: "literal", value: "Skills" },
    description: { kind: "literal", value: `Test skill ${index}` },
    hiddenSearchTerms: [],
    bypassTier: "queued",
    availabilityId: "session-idle",
    confirmation: "none",
    arguments: { kind: "text", required: false },
    surfaces: ["assistant"],
  };
}

describe("assistant command completion controller", () => {
  it("runs completion through an explicit state-machine actor", () => {
    const actor = createAssistantCommandCompletionActor(BUILTIN_ASSISTANT_COMMAND_REGISTRY);

    expect(actor.getSnapshot().phase).toBe("closed");
    actor.send({ type: "input-changed", input: input("/memory") });
    expect(actor.getSnapshot()).toMatchObject({
      phase: "suggesting",
      anchor: "input",
      selectedCommandId: "memory.list",
    });
    actor.send({ type: "input-changed", input: input("/memory add title") });
    expect(actor.getSnapshot()).toMatchObject({ phase: "arguments", selectedCommandId: "memory.add" });
  });

  it("recognizes an input trigger range while preserving native escapes and selections", () => {
    const actor = createAssistantCommandCompletionActor(BUILTIN_ASSISTANT_COMMAND_REGISTRY);
    actor.send({ type: "input-changed", input: input("  /memory ad") });

    expect(actor.getSnapshot()).toMatchObject({
      phase: "suggesting",
      anchor: "input",
      query: "/memory ad",
      trigger: { start: 2, end: 12 },
      selectedCommandId: "memory.add",
    });
    actor.send({ type: "input-changed", input: input("//memory") });
    expect(actor.getSnapshot().phase).toBe("closed");
    actor.send({ type: "input-changed", input: input("/memory", 1, 4) });
    expect(actor.getSnapshot().phase).toBe("closed");
  });

  it("keeps selection by command identity as filtering and registry revisions change", () => {
    const actor = createAssistantCommandCompletionActor(BUILTIN_ASSISTANT_COMMAND_REGISTRY);
    actor.send({ type: "input-changed", input: input("/memory") });
    actor.send({ type: "select", commandId: "memory.add" });
    actor.send({ type: "input-changed", input: input("/memory ad") });
    const narrowed = actor.getSnapshot();
    const extendedRegistry = createAssistantCommandRegistry("extended", [BUILTIN_ASSISTANT_COMMANDS, [skill(1)]]);
    actor.send({ type: "registry-changed", registry: extendedRegistry });

    expect(narrowed.selectedCommandId).toBe("memory.add");
    expect(actor.getSnapshot().selectedCommandId).toBe("memory.add");
    expect(actor.getSnapshot().registryRevision).toBe("extended");
  });

  it("moves through results with Arrow and Page steps", () => {
    const actor = createAssistantCommandCompletionActor(BUILTIN_ASSISTANT_COMMAND_REGISTRY);
    actor.send({ type: "input-changed", input: input("/") });
    const first = actor.getSnapshot().selectedCommandId;
    actor.send({ type: "move", delta: 1 });
    const next = actor.getSnapshot();
    actor.send({ type: "move", delta: 5 });

    expect(next.selectedCommandId).not.toBe(first);
    expect(actor.getSnapshot().selectedCommandId).toBe(BUILTIN_ASSISTANT_COMMANDS[6].id);
  });

  it("returns an exact range edit and caret for keyboard acceptance", () => {
    const actor = createAssistantCommandCompletionActor(BUILTIN_ASSISTANT_COMMAND_REGISTRY);
    const snapshot = input("/memory adlater", 10);
    actor.send({ type: "input-changed", input: snapshot });
    const accepted = actor.send({ type: "accept", input: snapshot, method: "enter" });

    expect(accepted.edit).toEqual({
      commandId: "memory.add",
      range: { start: 0, end: 10 },
      text: "/memory add ",
      selection: { start: 12, end: 12 },
      method: "enter",
    });
    expect(applyAssistantCommandCompletionEdit(snapshot.value, accepted.edit!)).toEqual({
      value: "/memory add later",
      selectionStart: 12,
      selectionEnd: 12,
    });
    expect(accepted.state).toMatchObject({ phase: "arguments", selectedCommandId: "memory.add" });
  });

  it("opens from the toolbar without changing text and replaces through an explicit edit", () => {
    const actor = createAssistantCommandCompletionActor(BUILTIN_ASSISTANT_COMMAND_REGISTRY);
    const snapshot = input("draft message");
    actor.send({ type: "open-button", input: snapshot });
    const opened = actor.getSnapshot();
    actor.send({ type: "select", commandId: "session.new" });
    const accepted = actor.send({ type: "accept", input: snapshot, method: "pointer" });

    expect(opened).toMatchObject({
      phase: "suggesting",
      anchor: "button",
      query: "/",
      trigger: { start: 0, end: 13 },
    });
    expect(applyAssistantCommandCompletionEdit(snapshot.value, accepted.edit!)).toEqual({
      value: "/new",
      selectionStart: 4,
      selectionEnd: 4,
    });
  });

  it("keeps Escape dismissal scoped to one trigger identity", () => {
    const actor = createAssistantCommandCompletionActor(BUILTIN_ASSISTANT_COMMAND_REGISTRY);
    actor.send({ type: "input-changed", input: input("/thr") });
    actor.send({ type: "dismiss" });
    actor.send({ type: "selection-changed", input: input("/thr") });
    const unchanged = actor.getSnapshot();
    actor.send({ type: "input-changed", input: input("/thre") });

    expect(unchanged.phase).toBe("closed");
    expect(actor.getSnapshot().phase).toBe("suggesting");
  });

  it("suspends completion changes during IME composition and reconciles on completion", () => {
    const actor = createAssistantCommandCompletionActor(BUILTIN_ASSISTANT_COMMAND_REGISTRY);
    actor.send({ type: "composition-started" });
    actor.send({ type: "input-changed", input: input("/memory") });
    const ignored = actor.getSnapshot();
    actor.send({ type: "composition-ended", input: input("/memory") });

    expect(ignored).toMatchObject({ phase: "composing", composing: true });
    expect(actor.getSnapshot()).toMatchObject({ phase: "suggesting", composing: false, query: "/memory" });
  });

  it("enters argument phase without reopening suggestions after a completed command", () => {
    const actor = createAssistantCommandCompletionActor(BUILTIN_ASSISTANT_COMMAND_REGISTRY);
    actor.send({ type: "input-changed", input: input("/memory add Release triage") });

    expect(actor.getSnapshot()).toMatchObject({
      phase: "arguments",
      anchor: undefined,
      selectedCommandId: "memory.add",
      query: "/memory add Release triage",
    });
    expect(actor.project().matches).toEqual([]);
  });

  it("treats a later slash as argument text but opens a fresh completion after replacement", () => {
    const actor = createAssistantCommandCompletionActor(BUILTIN_ASSISTANT_COMMAND_REGISTRY);
    actor.send({ type: "input-changed", input: input("/memory add /worker") });

    expect(actor.getSnapshot()).toMatchObject({ phase: "arguments", selectedCommandId: "memory.add" });
    expect(actor.project().matches).toEqual([]);

    actor.send({ type: "input-changed", input: input("") });
    expect(actor.getSnapshot().phase).toBe("closed");
    actor.send({ type: "input-changed", input: input("/") });
    expect(actor.getSnapshot()).toMatchObject({ phase: "suggesting", anchor: "input", query: "/" });
    expect(actor.project().matches.length).toBeGreaterThan(1);
  });

  it("reconciles a large dynamic catalogue without index-based selection drift", () => {
    const registry = createAssistantCommandRegistry("skills-150", [
      Array.from({ length: 150 }, (_, index) => skill(index)),
    ]);
    const actor = createAssistantCommandCompletionActor(registry);
    actor.send({ type: "input-changed", input: input("/skill:user:test-") });
    const projected = actor.project();

    expect(projected.matches).toHaveLength(100);
    expect(projected.selectedCommandId).toBe(projected.matches[0]?.command.id);
  });
});
