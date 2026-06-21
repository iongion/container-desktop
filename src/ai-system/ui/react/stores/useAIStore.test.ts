import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAIStore } from "./useAIStore";

describe("aiStore — converged ordered timeline + multiplexing", () => {
  beforeEach(() => {
    useAIStore.setState({
      sessions: [],
      activeSessionId: null,
      timelines: {},
      binding: {},
      streamBySession: {},
      busy: {},
    });
  });

  it("appends the user message and streams the assistant reply into the active timeline, ignoring foreign streams", async () => {
    const chat = vi.fn(async () => ({ streamId: "ai-1" }));
    const prev = (globalThis as any).window;
    (globalThis as any).window = { AI: { chat } };
    try {
      await useAIStore.getState().sendMessage("hello");
      const sid = useAIStore.getState().activeSessionId as string;
      useAIStore.getState().applyStreamEvent({ streamId: "ai-1", type: "delta", payload: { text: "Hi " } });
      useAIStore.getState().applyStreamEvent({ streamId: "ai-999", type: "delta", payload: { text: "X" } });
      useAIStore.getState().applyStreamEvent({ streamId: "ai-1", type: "delta", payload: { text: "there" } });
      useAIStore.getState().applyStreamEvent({ streamId: "ai-1", type: "done", payload: { finishReason: "stop" } });

      const items = useAIStore.getState().timelines[sid];
      expect(items.map((i) => i.kind)).toEqual(["message", "message"]);
      expect(items[0]).toMatchObject({ role: "user", content: "hello" });
      expect(items[1]).toMatchObject({ role: "assistant", content: "Hi there", streaming: false });
      expect(useAIStore.getState().busy[sid]).toBe(false);
    } finally {
      (globalThis as any).window = prev;
    }
  });

  it("reaps the stream binding once a no-approval turn completes", async () => {
    const chat = vi.fn(async () => ({ streamId: "ai-7" }));
    const prev = (globalThis as any).window;
    (globalThis as any).window = { AI: { chat } };
    try {
      await useAIStore.getState().sendMessage("hi");
      expect(useAIStore.getState().binding["ai-7"]).toBeDefined();
      useAIStore.getState().applyStreamEvent({ streamId: "ai-7", type: "done", payload: { finishReason: "stop" } });
      expect(useAIStore.getState().binding["ai-7"]).toBeUndefined();
    } finally {
      (globalThis as any).window = prev;
    }
  });

  it("surfaces an approval card, keeps the binding for the resume, and resolves via window.AI.resolve", async () => {
    const chat = vi.fn(async () => ({ streamId: "ai-1" }));
    const resolve = vi.fn();
    const prev = (globalThis as any).window;
    (globalThis as any).window = { AI: { chat, resolve } };
    try {
      await useAIStore.getState().sendMessage("stop web");
      const sid = useAIStore.getState().activeSessionId as string;
      useAIStore.getState().applyStreamEvent({
        streamId: "ai-1",
        type: "tool",
        payload: {
          event: {
            type: "approval-request",
            actionId: "act-1",
            kind: "command",
            program: "podman",
            args: ["stop", "web"],
            reason: "r",
          },
        },
      });
      useAIStore.getState().applyStreamEvent({ streamId: "ai-1", type: "done", payload: { finishReason: "stop" } });
      // Binding survives because an approval is still pending — the broker resumes on the same stream.
      expect(useAIStore.getState().binding["ai-1"]).toBe(sid);

      useAIStore.getState().resolveApproval("act-1", "allow");
      expect(resolve).toHaveBeenCalledWith("ai-1", "act-1", "allow");
      const approval = useAIStore.getState().timelines[sid].find((i) => i.kind === "approval");
      expect(approval).toMatchObject({ status: "allowed" });
    } finally {
      (globalThis as any).window = prev;
    }
  });
});
