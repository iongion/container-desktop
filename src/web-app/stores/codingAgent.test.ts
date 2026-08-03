import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PiAgentSessionSpec } from "@/ai-system/adapters/piAgentContainer";
import type { PiBridgeClient } from "@/ai-system/adapters/piBridgeClient";
import type { AIPermissionMode } from "@/ai-system/core/permissions";
import { emptyPiThreadView } from "@/ai-system/core/piThreadView";
import type { HostRequestEvent } from "@/ai-system/core/uiRequests";
import { useAppStore } from "@/web-app/stores/appStore";
import { emptyCodingAgentChrome, useCodingAgentStore } from "@/web-app/stores/codingAgent";

const spec = { workspacePath: "/work", agentContainerName: "cd-agent-abc" } as PiAgentSessionSpec;

function attachFakeClient() {
  const responses: Array<{ requestId: string; response: unknown }> = [];
  const client = {
    respond: vi.fn(async (requestId: string, response: unknown) => {
      responses.push({ requestId, response });
    }),
    prompt: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    connect: vi.fn(async () => {}),
    onEvent: vi.fn(() => () => {}),
    close: vi.fn(),
  } as unknown as PiBridgeClient;
  useCodingAgentStore.setState({
    client,
    spec,
    connectionId: "podman-1",
    status: "ready",
    view: emptyPiThreadView("pi-session"),
    chrome: emptyCodingAgentChrome(),
    pendingDialog: undefined,
  });
  return { client, responses };
}

const hostRequest = (method: string, payload: Record<string, unknown>, requestId = "r1"): HostRequestEvent =>
  ({ type: "host_request", requestId, method, payload }) as HostRequestEvent;

function setPermissionMode(permissionMode: AIPermissionMode) {
  const settings = useAppStore.getState().userSettings;
  useAppStore.setState({ userSettings: { ...settings, ai: { ...settings.ai, permissionMode } } as never });
}

describe("useCodingAgentStore host requests", () => {
  beforeEach(() => {
    setPermissionMode("ask");
  });

  it("shows an approval card and answers nothing until the user decides", async () => {
    const { responses } = attachFakeClient();
    await useCodingAgentStore
      .getState()
      .handleHostRequest(
        hostRequest("approval", { toolName: "bash", toolCallId: "tc1", args: { command: "rm -rf build" } }),
      );
    expect(useCodingAgentStore.getState().view.timeline[0]).toMatchObject({
      kind: "approval",
      approvalId: "r1",
      status: "pending",
    });
    expect(responses).toEqual([]);
  });

  it("runs an ungated read without a card", async () => {
    const { responses } = attachFakeClient();
    await useCodingAgentStore
      .getState()
      .handleHostRequest(hostRequest("approval", { toolName: "read", args: { path: "a.ts" } }));
    expect(useCodingAgentStore.getState().view.timeline).toEqual([]);
    expect(responses).toEqual([{ requestId: "r1", response: { ok: true, value: { allow: true } } }]);
  });

  it("answers immediately in always-allow mode", async () => {
    setPermissionMode("allow");
    const { responses } = attachFakeClient();
    await useCodingAgentStore
      .getState()
      .handleHostRequest(hostRequest("approval", { toolName: "bash", args: { command: "ls" } }));
    expect(useCodingAgentStore.getState().view.timeline).toEqual([]);
    expect(responses[0]).toMatchObject({ response: { value: { allow: true } } });
  });

  it("sends the user's rejection to the container and settles the card", async () => {
    const { responses } = attachFakeClient();
    await useCodingAgentStore
      .getState()
      .handleHostRequest(hostRequest("approval", { toolName: "bash", args: { command: "rm -rf /" } }));
    await useCodingAgentStore.getState().resolveApproval("r1", "reject");
    expect(responses[0].response).toMatchObject({ ok: true, value: { allow: false } });
    expect(useCodingAgentStore.getState().view.timeline[0]).toMatchObject({ status: "rejected" });
  });

  it("sends the user's approval to the container and settles the card", async () => {
    const { responses } = attachFakeClient();
    await useCodingAgentStore
      .getState()
      .handleHostRequest(hostRequest("approval", { toolName: "bash", args: { command: "ls" } }));
    await useCodingAgentStore.getState().resolveApproval("r1", "allow");
    expect(responses[0].response).toEqual({ ok: true, value: { allow: true } });
    expect(useCodingAgentStore.getState().view.timeline[0]).toMatchObject({ status: "allowed" });
  });

  it("holds a dialog request until it is answered, then clears it", async () => {
    const { responses } = attachFakeClient();
    await useCodingAgentStore
      .getState()
      .handleHostRequest(hostRequest("select", { title: "Pick one", options: ["a", "b"] }));
    expect(useCodingAgentStore.getState().pendingDialog).toMatchObject({ method: "select", title: "Pick one" });
    await useCodingAgentStore.getState().respondToRequest("r1", { ok: true, value: "a" });
    expect(useCodingAgentStore.getState().pendingDialog).toBeUndefined();
    expect(responses[0]).toEqual({ requestId: "r1", response: { ok: true, value: "a" } });
  });

  it("keeps a dialog request out of the transcript", async () => {
    attachFakeClient();
    await useCodingAgentStore.getState().handleHostRequest(hostRequest("confirm", { title: "Sure?" }));
    expect(useCodingAgentStore.getState().view.timeline).toEqual([]);
  });

  it("merges statuses and widgets into the session chrome", async () => {
    attachFakeClient();
    await useCodingAgentStore
      .getState()
      .handleHostRequest(hostRequest("setStatus", { statusKey: "k", statusText: "busy" }));
    await useCodingAgentStore
      .getState()
      .handleHostRequest(
        hostRequest("setWidget", { widgetKey: "w", widgetLines: ["one"], widgetPlacement: "belowEditor" }),
      );
    expect(useCodingAgentStore.getState().chrome).toMatchObject({
      statuses: { k: "busy" },
      widgets: { w: { lines: ["one"], placement: "belowEditor" } },
    });
  });

  it("drops a cleared status and a cleared widget instead of keeping an empty entry", async () => {
    attachFakeClient();
    await useCodingAgentStore
      .getState()
      .handleHostRequest(hostRequest("setStatus", { statusKey: "k", statusText: "busy" }));
    await useCodingAgentStore.getState().handleHostRequest(hostRequest("setStatus", { statusKey: "k" }));
    await useCodingAgentStore
      .getState()
      .handleHostRequest(hostRequest("setWidget", { widgetKey: "w", widgetLines: ["x"] }));
    await useCodingAgentStore.getState().handleHostRequest(hostRequest("setWidget", { widgetKey: "w" }));
    expect(useCodingAgentStore.getState().chrome.statuses).toEqual({});
    expect(useCodingAgentStore.getState().chrome.widgets).toEqual({});
  });

  it("bumps a sequence when an extension sets the composer text, so the same text applies twice", async () => {
    attachFakeClient();
    await useCodingAgentStore.getState().handleHostRequest(hostRequest("setEditorText", { text: "draft" }));
    const first = useCodingAgentStore.getState().chrome.editorDraft;
    await useCodingAgentStore.getState().handleHostRequest(hostRequest("setEditorText", { text: "draft" }));
    const second = useCodingAgentStore.getState().chrome.editorDraft;
    expect(first).toMatchObject({ text: "draft" });
    expect(second?.seq).toBe((first?.seq ?? 0) + 1);
  });

  it("ignores a method it does not know", async () => {
    const { responses } = attachFakeClient();
    await useCodingAgentStore.getState().handleHostRequest(hostRequest("teleport", {}));
    expect(useCodingAgentStore.getState().view.timeline).toEqual([]);
    expect(useCodingAgentStore.getState().pendingDialog).toBeUndefined();
    expect(responses).toEqual([]);
  });

  it("does nothing when a response arrives with no live session", async () => {
    useCodingAgentStore.setState({ client: undefined });
    await expect(useCodingAgentStore.getState().respondToRequest("r1", { ok: true })).resolves.toBeUndefined();
  });
});
