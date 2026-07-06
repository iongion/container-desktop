import { afterEach, describe, expect, it, vi } from "vitest";

import { assembleHostRuntimeFromGlobals, registerHostRuntimeFromGlobals } from "./hostRuntimeFromGlobals";
import { getHostRuntime, resetHostRuntime } from "./provider";

// A fake of the contextBridge'd window surface — records send/invoke so we can assert channel wiring.
function makeFakeWindow() {
  const sent: Array<{ channel: string; args: any[] }> = [];
  const invoked: Array<{ channel: string; args: any[] }> = [];
  const messageBus = {
    send: (channel: string, ...args: any[]) => sent.push({ channel, args }),
    invoke: vi.fn(async (channel: string, ...args: any[]) => {
      invoked.push({ channel, args });
      return { channel };
    }),
  };
  const w = {
    Command: { tag: "command" },
    Platform: { tag: "platform" },
    Path: { tag: "path" },
    FS: { tag: "fs" },
    CURRENT_OS_TYPE: "Linux",
    CURRENT_DARWIN_MAJOR: 23,
    MessageBus: messageBus,
    ActivityBus: { tag: "activity" },
    TrayBus: { tag: "tray" },
    ResourceBus: { tag: "resource" },
    AI: { tag: "ai" },
    AIBus: { tag: "aiBus" },
  };
  return { w, sent, invoked, messageBus };
}

describe("assembleHostRuntimeFromGlobals", () => {
  afterEach(() => resetHostRuntime());

  it("maps the contextBridge'd globals straight through onto the runtime", () => {
    const { w } = makeFakeWindow();
    const runtime = assembleHostRuntimeFromGlobals(w as any);

    expect(runtime.command).toBe(w.Command);
    expect(runtime.platform).toBe(w.Platform);
    expect(runtime.path).toBe(w.Path);
    expect(runtime.fs).toBe(w.FS);
    expect(runtime.messageBus).toBe(w.MessageBus);
    expect(runtime.osType).toBe("Linux");
    expect(runtime.darwinMajor).toBe(23);
    expect(runtime.activityBus).toBe(w.ActivityBus);
    expect(runtime.trayBus).toBe(w.TrayBus);
    expect(runtime.resourceBus).toBe(w.ResourceBus);
    expect(runtime.ai).toBe(w.AI);
    expect(runtime.aiBus).toBe(w.AIBus);
  });

  it("wires windowControl onto the MessageBus.send string channels main handles", () => {
    const { w, sent } = makeFakeWindow();
    const { windowControl } = assembleHostRuntimeFromGlobals(w as any);

    windowControl.minimize();
    windowControl.maximize();
    windowControl.restore();
    windowControl.close();
    windowControl.exit();
    windowControl.relaunch();
    windowControl.openDevTools();
    windowControl.openStorageFolder();

    expect(sent.map((s) => s.channel)).toEqual([
      "window.minimize",
      "window.maximize",
      "window.restore",
      "window.close",
      "application.exit",
      "application.relaunch",
      "openDevTools",
      "openStorageFolder",
    ]);
  });

  it("wires dialogs onto MessageBus.invoke, passing options through", async () => {
    const { w, invoked } = makeFakeWindow();
    const { dialogs } = assembleHostRuntimeFromGlobals(w as any);

    await dialogs.openFileSelector({ directory: true } as any);
    await dialogs.openTerminal({ command: "sh" } as any);

    expect(invoked).toEqual([
      { channel: "openFileSelector", args: [{ directory: true }] },
      { channel: "openTerminal", args: [{ command: "sh" }] },
    ]);
  });

  it("registerHostRuntimeFromGlobals registers the assembled runtime with the provider", () => {
    const { w } = makeFakeWindow();
    const runtime = registerHostRuntimeFromGlobals(w as any);
    expect(getHostRuntime()).toBe(runtime);
    expect(runtime.command).toBe(w.Command);
  });
});
