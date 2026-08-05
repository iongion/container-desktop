import { getKeybindings } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { GuiTui } from "@/pi-agent-host/guiTui";
import type { HostRpc } from "@/pi-agent-host/hostRpc";
import { buildPiTheme } from "@/pi-agent-host/piTheme";
import { createSurfaceRegistry } from "@/pi-agent-host/surfaces";
import { createGuiUiContext, type PiKeybindings } from "@/pi-agent-host/uiContext";
import { createVirtualTerminal } from "@/pi-agent-host/virtualTerminal";
import type { AppThemePalette, BridgeEvent } from "@/pi-bridge/protocol";

const palette: AppThemePalette = {
  chrome: "#1b2027",
  bg: "#22282f",
  surface: "#2a313a",
  border: "#39424d",
  text: "#e8edf2",
  textMuted: "#9aa5b1",
  accent: "#14b8a6",
  success: "#2ea043",
  warning: "#d29922",
  error: "#f85149",
};

function fakeRpc(answer?: unknown) {
  const rpc: HostRpc = {
    request: vi.fn(async () => answer) as HostRpc["request"],
    notify: vi.fn(),
    settle: vi.fn(),
  };
  return rpc;
}

function makeContext(answer?: unknown) {
  const rpc = fakeRpc(answer);
  const events: BridgeEvent[] = [];
  const surfaces = createSurfaceRegistry({ emit: (event) => events.push(event), defaultColumns: 80 });
  const terminal = createVirtualTerminal({ columns: 80, rows: 24 });
  const tui = new GuiTui(terminal.terminal, () => {});
  const context = createGuiUiContext({
    rpc,
    tui,
    surfaces,
    theme: buildPiTheme(palette),
    keybindings: getKeybindings() as unknown as PiKeybindings,
    gitBranch: "feature/pi",
  });
  return { rpc, events, surfaces, context, ui: context.ui };
}

const frames = (events: BridgeEvent[]) =>
  events.filter((event): event is Extract<BridgeEvent, { type: "surface_frame" }> => event.type === "surface_frame");

const component = (lines: string[]) => () => ({ render: () => lines, invalidate: () => {} });

describe("createGuiUiContext dialogs", () => {
  it("asks the app to confirm and returns its answer", async () => {
    const { rpc, ui } = makeContext(true);
    await expect(ui.confirm("Allow?", "rm -rf build")).resolves.toBe(true);
    expect(rpc.request).toHaveBeenCalledWith(
      "confirm",
      { title: "Allow?", message: "rm -rf build" },
      { timeoutMs: undefined, fallback: false },
    );
  });

  it("passes a dialog timeout through and falls back to false for confirm", async () => {
    const { rpc, ui } = makeContext(false);
    await ui.confirm("Allow?", "msg", { timeout: 5000 });
    expect(rpc.request).toHaveBeenCalledWith("confirm", expect.anything(), { timeoutMs: 5000, fallback: false });
  });

  it("returns undefined from select when the app declines", async () => {
    const { ui } = makeContext(undefined);
    await expect(ui.select("Pick", ["a", "b"])).resolves.toBeUndefined();
  });

  it("sends notify as fire-and-forget", () => {
    const { rpc, ui } = makeContext();
    ui.notify("done", "info");
    expect(rpc.notify).toHaveBeenCalledWith("notify", { message: "done", notifyType: "info" });
    expect(rpc.request).not.toHaveBeenCalled();
  });

  // Three calls in pi, one surface in the app: the word beside the spinner and whether the row is there.
  it("carries a working message, its visibility, and an empty frame list", () => {
    const { rpc, ui } = makeContext();
    ui.setWorkingMessage("Indexing");
    expect(rpc.notify).toHaveBeenCalledWith("setWorking", { workingMessage: "Indexing" });
    ui.setWorkingVisible(false);
    expect(rpc.notify).toHaveBeenCalledWith("setWorking", { workingVisible: false });
    // pi's own way of saying "hide the indicator entirely"; a GUI has no frames to animate.
    ui.setWorkingIndicator({ frames: [] });
    expect(rpc.notify).toHaveBeenCalledWith("setWorking", { workingFrames: [] });
  });

  // The default is restored by calling with nothing, which must travel rather than be dropped as "no change".
  it("restores the app's own working word when the message is cleared", () => {
    const { rpc, ui } = makeContext();
    ui.setWorkingMessage();
    expect(rpc.notify).toHaveBeenCalledWith("setWorking", { workingMessage: undefined });
  });

  it("routes an editor paste through setEditorText, as pi's own rpc mode does", () => {
    const { rpc, ui } = makeContext();
    ui.pasteToEditor("pasted");
    expect(rpc.notify).toHaveBeenCalledWith("setEditorText", { text: "pasted" });
  });
});

describe("createGuiUiContext widgets and chrome", () => {
  it("forwards a string-array widget as lines and a component factory as a surface", () => {
    const { rpc, events, ui } = makeContext();
    ui.setWidget("k", ["line one"], { placement: "belowEditor" });
    expect(rpc.notify).toHaveBeenCalledWith("setWidget", {
      widgetKey: "k",
      widgetLines: ["line one"],
      widgetPlacement: "belowEditor",
    });

    ui.setWidget("k", component(["drawn"]) as never, { placement: "aboveEditor" });
    expect(frames(events).at(-1)).toMatchObject({
      lines: ["drawn"],
      slot: { kind: "widget", widgetKey: "k", placement: "aboveEditor" },
    });
  });

  it("retires a component widget when the same key goes back to plain lines", () => {
    const { events, ui } = makeContext();
    ui.setWidget("k", component(["drawn"]) as never);
    ui.setWidget("k", ["plain"]);
    expect(events.filter((event) => event.type === "surface_closed")).toHaveLength(1);
  });

  it("opens a footer surface with the app's own footer data and closes it on undefined", () => {
    const { events, ui } = makeContext();
    const factory = vi.fn((_tui, _theme, footerData) => ({
      render: () => [`branch ${footerData.getGitBranch()}`],
      invalidate: () => {},
    }));
    ui.setFooter(factory as never);
    expect(frames(events).at(-1)).toMatchObject({ lines: ["branch feature/pi"], slot: { kind: "footer" } });
    ui.setFooter(undefined);
    expect(events.at(-1)?.type).toBe("surface_closed");
  });

  it("hands a footer component the statuses extensions published", () => {
    const { events, ui } = makeContext();
    ui.setStatus("build", "green");
    ui.setFooter(((_tui, _theme, footerData) => ({
      render: () => [...footerData.getExtensionStatuses().values()],
      invalidate: () => {},
    })) as never);
    expect(frames(events).at(-1)).toMatchObject({ lines: ["green"] });
  });

  it("opens a header surface", () => {
    const { events, ui } = makeContext();
    ui.setHeader(component(["welcome"]) as never);
    expect(frames(events).at(-1)).toMatchObject({ lines: ["welcome"], slot: { kind: "header" } });
  });

  it("keeps the session alive when a chrome factory throws", () => {
    const { events, ui } = makeContext();
    expect(() =>
      ui.setHeader((() => {
        throw new Error("no header for you");
      }) as never),
    ).not.toThrow();
    expect(frames(events)).toHaveLength(0);
  });
});

describe("createGuiUiContext custom components", () => {
  it("opens a focused surface and resolves when the component calls done", async () => {
    const { events, context, ui } = makeContext();
    const pending = ui.custom<string>((_tui, _theme, _keys, done) => ({
      render: () => ["pick one"],
      invalidate: () => {},
      handleInput: (data: string) => {
        if (data === "\r") done("chosen");
      },
    }));
    await Promise.resolve();
    const frame = frames(events).at(-1);
    expect(frame).toMatchObject({ focus: true, overlay: false, lines: ["pick one"] });

    const surfaceId = frame?.surfaceId ?? "";
    // The component answers its own keystroke, which is what a real dialog does.
    context.handleSurfaceInput(surfaceId, "\r");
    await expect(pending).resolves.toBe("chosen");
    expect(events.at(-1)).toMatchObject({ type: "surface_closed", surfaceId });
  });

  it("carries overlay placement onto the frame", async () => {
    const { events, ui } = makeContext();
    ui.custom(() => ({ render: () => ["x"], invalidate: () => {} }), {
      overlay: true,
      overlayOptions: { anchor: "top-center", width: "50%", offsetY: 2 },
    });
    await Promise.resolve();
    expect(frames(events).at(-1)).toMatchObject({
      overlay: true,
      placement: { anchor: "top-center", width: "50%" },
    });
  });

  it("resolves undefined when the surface is closed from the app side", async () => {
    const { events, surfaces, ui } = makeContext();
    const pending = ui.custom(() => ({ render: () => ["x"], invalidate: () => {} }));
    await Promise.resolve();
    surfaces.close(frames(events).at(-1)?.surfaceId ?? "");
    await expect(pending).resolves.toBeUndefined();
  });

  it("resolves undefined when the factory itself throws", async () => {
    const { ui } = makeContext();
    await expect(
      ui.custom(() => {
        throw new Error("bad factory");
      }),
    ).resolves.toBeUndefined();
  });
});

describe("createGuiUiContext terminal input", () => {
  it("lets a listener consume a keystroke before the surface sees it", async () => {
    const { events, context, ui } = makeContext();
    const handleInput = vi.fn();
    ui.custom(() => ({ render: () => ["x"], invalidate: () => {}, handleInput }));
    await Promise.resolve();
    const surfaceId = frames(events).at(-1)?.surfaceId ?? "";

    ui.onTerminalInput((data) => (data === "q" ? { consume: true } : undefined));
    context.handleSurfaceInput(surfaceId, "q");
    expect(handleInput).not.toHaveBeenCalled();

    context.handleSurfaceInput(surfaceId, "z");
    expect(handleInput).toHaveBeenCalledWith("z");
  });

  it("lets a listener rewrite the data the surface receives, and unsubscribes", async () => {
    const { events, context, ui } = makeContext();
    const handleInput = vi.fn();
    ui.custom(() => ({ render: () => ["x"], invalidate: () => {}, handleInput }));
    await Promise.resolve();
    const surfaceId = frames(events).at(-1)?.surfaceId ?? "";

    const unsubscribe = ui.onTerminalInput(() => ({ data: "rewritten" }));
    context.handleSurfaceInput(surfaceId, "q");
    expect(handleInput).toHaveBeenLastCalledWith("rewritten");

    unsubscribe();
    context.handleSurfaceInput(surfaceId, "q");
    expect(handleInput).toHaveBeenLastCalledWith("q");
  });
});

describe("createGuiUiContext theme and editor", () => {
  it("hands extensions the app's derived theme, not an unstyled shim", () => {
    const { ui } = makeContext();
    expect(ui.theme.fg("accent", "hello")).toBe("\x1b[38;2;20;184;166mhello\x1b[39m");
    expect(ui.getAllThemes()).toEqual([{ name: "container-desktop", path: undefined }]);
    expect(ui.getTheme("container-desktop")).toBe(ui.theme);
  });

  it("reports the app's own theme as already applied and refuses to switch to another", () => {
    const { ui } = makeContext();
    expect(ui.setTheme("container-desktop").success).toBe(true);
    expect(ui.setTheme("light").success).toBe(false);
  });

  it("follows the app when the theme changes", () => {
    const { context, ui } = makeContext();
    context.applyTheme(buildPiTheme({ ...palette, accent: "#ff0000" }));
    expect(ui.theme.fg("accent", "x")).toBe("\x1b[38;2;255;0;0mx\x1b[39m");
  });

  it("remembers the tool expansion state extensions set", () => {
    const { context, ui } = makeContext();
    expect(ui.getToolsExpanded()).toBe(false);
    ui.setToolsExpanded(true);
    expect(ui.getToolsExpanded()).toBe(true);
    expect(context.getToolsExpanded()).toBe(true);
  });

  it("opens a plugin editor as its own surface and restores the composer on undefined", () => {
    const { events, ui } = makeContext();
    ui.setEditorComponent(component(["> type here"]) as never);
    expect(frames(events).at(-1)).toMatchObject({ lines: ["> type here"], slot: { kind: "editor" }, focus: true });
    expect(ui.getEditorComponent()).toBeDefined();
    ui.setEditorComponent(undefined);
    expect(events.at(-1)?.type).toBe("surface_closed");
    expect(ui.getEditorComponent()).toBeUndefined();
  });
});
