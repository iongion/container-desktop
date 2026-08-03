import { describe, expect, it, vi } from "vitest";

import type { HostRpc } from "@/pi-agent-host/hostRpc";
import { createGuiUiContext } from "@/pi-agent-host/uiContext";

function fakeRpc(answer?: unknown) {
  const rpc: HostRpc = {
    request: vi.fn(async () => answer) as HostRpc["request"],
    notify: vi.fn(),
    settle: vi.fn(),
  };
  return rpc;
}

describe("createGuiUiContext", () => {
  it("asks the app to confirm and returns its answer", async () => {
    const rpc = fakeRpc(true);
    await expect(createGuiUiContext(rpc).confirm("Allow?", "rm -rf build")).resolves.toBe(true);
    expect(rpc.request).toHaveBeenCalledWith(
      "confirm",
      { title: "Allow?", message: "rm -rf build" },
      { timeoutMs: undefined, fallback: false },
    );
  });

  it("passes a dialog timeout through and falls back to false for confirm", async () => {
    const rpc = fakeRpc(false);
    await createGuiUiContext(rpc).confirm("Allow?", "msg", { timeout: 5000 });
    expect(rpc.request).toHaveBeenCalledWith("confirm", expect.anything(), { timeoutMs: 5000, fallback: false });
  });

  it("returns undefined from select when the app declines", async () => {
    await expect(createGuiUiContext(fakeRpc(undefined)).select("Pick", ["a", "b"])).resolves.toBeUndefined();
  });

  it("sends notify as fire-and-forget", () => {
    const rpc = fakeRpc();
    createGuiUiContext(rpc).notify("done", "info");
    expect(rpc.notify).toHaveBeenCalledWith("notify", { message: "done", notifyType: "info" });
    expect(rpc.request).not.toHaveBeenCalled();
  });

  it("forwards a string-array widget and ignores a component factory", () => {
    const rpc = fakeRpc();
    const ui = createGuiUiContext(rpc);
    ui.setWidget("k", ["line one"], { placement: "belowEditor" });
    ui.setWidget("k", (() => ({ render: () => [] })) as never);
    expect(rpc.notify).toHaveBeenCalledTimes(1);
    expect(rpc.notify).toHaveBeenCalledWith("setWidget", {
      widgetKey: "k",
      widgetLines: ["line one"],
      widgetPlacement: "belowEditor",
    });
  });

  it("routes an editor paste through setEditorText, as pi's own rpc mode does", () => {
    const rpc = fakeRpc();
    createGuiUiContext(rpc).pasteToEditor("pasted");
    expect(rpc.notify).toHaveBeenCalledWith("setEditorText", { text: "pasted" });
  });

  it("degrades the component surface instead of pretending to support it", async () => {
    const ui = createGuiUiContext(fakeRpc());
    await expect(ui.custom(() => ({ render: () => [] }) as never)).resolves.toBeUndefined();
    expect(ui.getEditorText()).toBe("");
    expect(ui.getAllThemes()).toEqual([]);
    expect(ui.setTheme("light").success).toBe(false);
  });

  it("degrades the theme to unstyled text instead of throwing", () => {
    const ui = createGuiUiContext(fakeRpc());
    expect(ui.theme.fg("accent", "hello")).toBe("hello");
    expect(ui.theme.bold("hello")).toBe("hello");
  });
});
