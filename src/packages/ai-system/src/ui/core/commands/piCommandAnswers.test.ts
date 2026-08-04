import { describe, expect, it } from "vitest";

import {
  readProjectTrustAnswer,
  readScopedModelsAnswer,
  readSessionSettingsAnswer,
  readSessionTreeAnswer,
} from "@/ai-system/ui/core/commands/piCommandAnswers";

const SESSION = {
  path: "/home/agent/.pi/agent/sessions/a.jsonl",
  id: "a",
  modified: "2026-08-04T21:00:00.000Z",
  messageCount: 4,
  firstMessage: "why is the build slow",
  current: false,
};

const SETTINGS = {
  autoCompaction: true,
  steeringMode: "all",
  followUpMode: "one-at-a-time",
  thinkingLevel: "medium",
  availableThinkingLevels: ["minimal", "low", "medium", "high"],
};

describe("readSessionTreeAnswer", () => {
  it("recognises the fork points a bare /fork answers with", () => {
    const answer = readSessionTreeAnswer({ forkPoints: [{ entryId: "e1", text: "first ask" }] });
    expect(answer).toEqual({ kind: "fork", points: [{ entryId: "e1", text: "first ask" }] });
  });

  it("recognises the tree a bare /tree answers with", () => {
    const node = { id: "e1", kind: "message", preview: "first ask", timestamp: "t0", current: true, children: [] };
    expect(readSessionTreeAnswer({ tree: [node] })).toEqual({ kind: "tree", nodes: [node] });
  });

  // An empty answer is still an answer: "you have not sent a message yet" is what the drawer must say, and treating
  // it as "no picker" would silently do nothing on a command the user typed.
  it("recognises an empty set rather than mistaking it for another kind of answer", () => {
    expect(readSessionTreeAnswer({ forkPoints: [] })).toEqual({ kind: "fork", points: [] });
    expect(readSessionTreeAnswer({ tree: [] })).toEqual({ kind: "tree", nodes: [] });
  });

  // Every other command answers with something else — a summary, a name, bindings — and none of them opens a picker.
  it("ignores an answer that is not a set of session points", () => {
    expect(readSessionTreeAnswer({ summary: "the story so far", tokensBefore: 9000 })).toBeUndefined();
    expect(readSessionTreeAnswer({ forkedFrom: "e1", editorText: "first ask" })).toBeUndefined();
    expect(readSessionTreeAnswer({ movedTo: "e1" })).toBeUndefined();
    expect(readSessionTreeAnswer(undefined)).toBeUndefined();
    expect(readSessionTreeAnswer(null)).toBeUndefined();
    expect(readSessionTreeAnswer("forkPoints")).toBeUndefined();
  });

  // The data crossed a socket, so its shape is a claim rather than a guarantee.
  it("refuses a set whose entries are not shaped like points", () => {
    expect(readSessionTreeAnswer({ forkPoints: [{ text: "no id" }] })).toBeUndefined();
    expect(readSessionTreeAnswer({ forkPoints: "e1" })).toBeUndefined();
    expect(readSessionTreeAnswer({ tree: [{ kind: "message" }] })).toBeUndefined();
  });

  it("recognises the sessions a bare /resume answers with", () => {
    expect(readSessionTreeAnswer({ sessions: [SESSION] })).toEqual({ kind: "sessions", sessions: [SESSION] });
  });

  // A workspace whose only session is the live one still gets an answer, so the picker can say so.
  it("recognises an empty session list", () => {
    expect(readSessionTreeAnswer({ sessions: [] })).toEqual({ kind: "sessions", sessions: [] });
  });

  it("refuses sessions that are not shaped like sessions", () => {
    expect(readSessionTreeAnswer({ sessions: [{ id: "a" }] })).toBeUndefined();
    expect(readSessionTreeAnswer({ sessions: [{ ...SESSION, current: "yes" }] })).toBeUndefined();
    expect(readSessionTreeAnswer({ sessions: "a.jsonl" })).toBeUndefined();
  });
});

describe("readSessionSettingsAnswer", () => {
  it("recognises what a bare /settings answers with", () => {
    expect(readSessionSettingsAnswer({ settings: SETTINGS })).toEqual(SETTINGS);
  });

  // A model that does not reason answers with no levels at all, which is the signal to hide the control rather
  // than an unusable answer.
  it("accepts a model that offers no thinking levels", () => {
    const plain = { ...SETTINGS, availableThinkingLevels: [] };
    expect(readSessionSettingsAnswer({ settings: plain })).toEqual(plain);
  });

  it("refuses a mode pi does not have and a shape that is not settings", () => {
    expect(readSessionSettingsAnswer({ settings: { ...SETTINGS, steeringMode: "sometimes" } })).toBeUndefined();
    expect(readSessionSettingsAnswer({ settings: { ...SETTINGS, autoCompaction: "on" } })).toBeUndefined();
    expect(readSessionSettingsAnswer({ settings: { ...SETTINGS, availableThinkingLevels: "high" } })).toBeUndefined();
    expect(readSessionSettingsAnswer({ trust: { decision: true, matters: true, path: "/w" } })).toBeUndefined();
    expect(readSessionSettingsAnswer(undefined)).toBeUndefined();
  });
});

describe("readProjectTrustAnswer", () => {
  it("recognises a decision either way", () => {
    const trust = { decision: true, matters: true, path: "/workspace" };
    expect(readProjectTrustAnswer({ trust })).toEqual(trust);
    expect(readProjectTrustAnswer({ trust: { ...trust, decision: false } })).toEqual({ ...trust, decision: false });
  });

  // `null` is "never decided", which is NOT the same as having decided no — the drawer says so, so the reader
  // must carry it through rather than treat a missing decision as a broken answer.
  it("carries an undecided workspace through", () => {
    const trust = { decision: null, matters: false, path: "/workspace" };
    expect(readProjectTrustAnswer({ trust })).toEqual(trust);
  });

  it("refuses a decision that is neither a choice nor undecided", () => {
    expect(readProjectTrustAnswer({ trust: { matters: true, path: "/w" } })).toBeUndefined();
    expect(readProjectTrustAnswer({ trust: { decision: "yes", matters: true, path: "/w" } })).toBeUndefined();
    expect(readProjectTrustAnswer({ trust: { decision: true, matters: true } })).toBeUndefined();
    expect(readProjectTrustAnswer(null)).toBeUndefined();
  });
});

describe("readScopedModelsAnswer", () => {
  it("recognises what /scoped-models answers with", () => {
    const models = { available: [{ id: "m1", name: "Qwen3 4B", provider: "llamacpp" }], scoped: ["m1"] };
    expect(readScopedModelsAnswer({ models })).toEqual(models);
  });

  // Nothing scoped means pi cycles everything, which is its own default and the common case here.
  it("accepts nothing scoped", () => {
    const models = { available: [{ id: "m1", name: "Qwen3 4B", provider: "llamacpp" }], scoped: [] };
    expect(readScopedModelsAnswer({ models })).toEqual(models);
  });

  it("refuses models that are not shaped like models", () => {
    expect(readScopedModelsAnswer({ models: { available: [{ id: "m1" }], scoped: [] } })).toBeUndefined();
    expect(readScopedModelsAnswer({ models: { available: [], scoped: ["m1", 2] } })).toBeUndefined();
    expect(readScopedModelsAnswer({ models: { scoped: [] } })).toBeUndefined();
    expect(readScopedModelsAnswer("m1")).toBeUndefined();
  });
});
