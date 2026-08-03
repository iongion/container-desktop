import { describe, expect, it } from "vitest";

import { classifyHostRequest } from "@/ai-system/core/uiRequests";

const request = (method: string, payload: Record<string, unknown>) =>
  ({ type: "host_request", requestId: "r1", method, payload }) as never;

describe("classifyHostRequest", () => {
  it("classifies confirm as a blocking dialog", () => {
    expect(classifyHostRequest(request("confirm", { title: "Allow?", message: "why" }))).toEqual({
      kind: "dialog",
      request: { requestId: "r1", method: "confirm", title: "Allow?", message: "why", timeoutMs: undefined },
    });
  });

  it("classifies select with its options", () => {
    const outcome = classifyHostRequest(request("select", { title: "Pick", options: ["a", "b"] }));
    expect(outcome).toMatchObject({ kind: "dialog", request: { method: "select", options: ["a", "b"] } });
  });

  it("carries the placeholder and prefill the input and editor dialogs need", () => {
    expect(classifyHostRequest(request("input", { title: "Name", placeholder: "type here" }))).toMatchObject({
      request: { method: "input", placeholder: "type here" },
    });
    expect(classifyHostRequest(request("editor", { title: "Edit", prefill: "body" }))).toMatchObject({
      request: { method: "editor", prefill: "body" },
    });
  });

  it("classifies an approval request", () => {
    expect(classifyHostRequest(request("approval", { toolName: "bash", args: { command: "ls" } }))).toEqual({
      kind: "approval",
      request: { requestId: "r1", toolName: "bash", args: { command: "ls" } },
    });
  });

  it("turns setStatus into a chrome patch", () => {
    expect(classifyHostRequest(request("setStatus", { statusKey: "k", statusText: "busy" }))).toEqual({
      kind: "chrome",
      patch: { statuses: { k: "busy" } },
    });
  });

  it("treats a cleared status as a chrome patch with undefined", () => {
    expect(classifyHostRequest(request("setStatus", { statusKey: "k" }))).toEqual({
      kind: "chrome",
      patch: { statuses: { k: undefined } },
    });
  });

  it("turns setWidget into a chrome patch defaulting to aboveEditor", () => {
    expect(classifyHostRequest(request("setWidget", { widgetKey: "w", widgetLines: ["one"] }))).toEqual({
      kind: "chrome",
      patch: { widgets: { w: { lines: ["one"], placement: "aboveEditor" } } },
    });
  });

  it("clears a widget when the extension passes no lines", () => {
    expect(classifyHostRequest(request("setWidget", { widgetKey: "w" }))).toEqual({
      kind: "chrome",
      patch: { widgets: { w: undefined } },
    });
  });

  it("carries setTitle, setEditorText and notify as chrome", () => {
    expect(classifyHostRequest(request("setTitle", { title: "pi" }))).toEqual({
      kind: "chrome",
      patch: { title: "pi" },
    });
    expect(classifyHostRequest(request("setEditorText", { text: "draft" }))).toEqual({
      kind: "chrome",
      patch: { editorText: "draft" },
    });
    expect(classifyHostRequest(request("notify", { message: "done", notifyType: "warning" }))).toEqual({
      kind: "chrome",
      patch: { notify: { message: "done", notifyType: "warning" } },
    });
  });

  it("defaults an unlabelled notification to info", () => {
    expect(classifyHostRequest(request("notify", { message: "done" }))).toMatchObject({
      patch: { notify: { notifyType: "info" } },
    });
  });

  it("ignores an unknown method rather than throwing", () => {
    expect(classifyHostRequest(request("teleport", {}))).toEqual({ kind: "ignored" });
  });

  it("ignores a dialog with no title, which the app could not render", () => {
    expect(classifyHostRequest(request("confirm", {}))).toEqual({ kind: "ignored" });
  });

  it("ignores an approval with no tool name", () => {
    expect(classifyHostRequest(request("approval", { args: {} }))).toEqual({ kind: "ignored" });
  });
});
