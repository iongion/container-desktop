import { describe, expect, it } from "vitest";

import { classifyHostRequest } from "@/ai-system/core/uiRequests";

const request = (method: string, payload: Record<string, unknown>) =>
  ({ type: "host_request", requestId: "r1", method, payload }) as never;

describe("classifyHostRequest", () => {
  it("classifies an engine op with its operation and arguments", () => {
    expect(classifyHostRequest(request("engine_op", { op: "removeContainer", args: { id: "c1" } }))).toEqual({
      kind: "engine-op",
      request: { requestId: "r1", op: "removeContainer", args: { id: "c1" } },
    });
  });

  it("treats an engine op with no arguments as an empty argument set", () => {
    expect(classifyHostRequest(request("engine_op", { op: "listContainers" }))).toEqual({
      kind: "engine-op",
      request: { requestId: "r1", op: "listContainers", args: {} },
    });
  });

  it("ignores an engine op naming something that is not a container operation", () => {
    expect(classifyHostRequest(request("engine_op", { op: "bash", args: { command: "ls" } }))).toEqual({
      kind: "ignored",
    });
    expect(classifyHostRequest(request("engine_op", {}))).toEqual({ kind: "ignored" });
  });

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

  // pi's three working-indicator calls land on the app's own indicator: the word beside the spinner, and whether
  // the row is there at all. A plugin's own animation frames are not adopted — the GUI animates its own spinner —
  // but an EMPTY frame list is pi's documented way of saying "hide it", which is honoured.
  it("turns a working message into a chrome patch", () => {
    expect(classifyHostRequest(request("setWorking", { workingMessage: "Indexing the repo" }))).toEqual({
      kind: "chrome",
      patch: { working: { message: "Indexing the repo" } },
    });
  });

  it("restores the default word when the message is cleared", () => {
    expect(classifyHostRequest(request("setWorking", {}))).toEqual({
      kind: "chrome",
      patch: { working: { message: undefined } },
    });
  });

  it("carries the visibility a plugin asked for", () => {
    expect(classifyHostRequest(request("setWorking", { workingVisible: false }))).toEqual({
      kind: "chrome",
      patch: { working: { message: undefined, visible: false } },
    });
    expect(classifyHostRequest(request("setWorking", { workingVisible: true }))).toEqual({
      kind: "chrome",
      patch: { working: { message: undefined, visible: true } },
    });
  });

  it("reads an empty frame list as hidden, and any other frames as visible", () => {
    expect(classifyHostRequest(request("setWorking", { workingFrames: [] }))).toEqual({
      kind: "chrome",
      patch: { working: { message: undefined, visible: false } },
    });
    expect(classifyHostRequest(request("setWorking", { workingFrames: ["*"] }))).toEqual({
      kind: "chrome",
      patch: { working: { message: undefined, visible: true } },
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

  it("routes a web search to the app, which is what has a network and the user's consent", () => {
    expect(classifyHostRequest(request("web_search", { query: "podman rootless" }))).toEqual({
      kind: "web-search",
      request: { requestId: "r1", query: "podman rootless" },
    });
  });

  it("ignores a web search with no query, which there is nothing to run", () => {
    expect(classifyHostRequest(request("web_search", { query: "   " }))).toEqual({ kind: "ignored" });
    expect(classifyHostRequest(request("web_search", {}))).toEqual({ kind: "ignored" });
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
