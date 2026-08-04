import { describe, expect, it } from "vitest";

import { readSessionTreeAnswer } from "@/ai-system/ui/core/commands/piCommandAnswers";

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
});
