import { describe, expect, it, vi } from "vitest";

import { createVirtualTerminal } from "@/pi-agent-host/virtualTerminal";

describe("createVirtualTerminal", () => {
  it("reports the size it was given", () => {
    const vt = createVirtualTerminal({ columns: 100, rows: 30 });
    expect(vt.terminal.columns).toBe(100);
    expect(vt.terminal.rows).toBe(30);
  });

  it("reports a new size and notifies the resize handler", () => {
    const vt = createVirtualTerminal({ columns: 80, rows: 24 });
    const onResize = vi.fn();
    vt.terminal.start(() => {}, onResize);
    vt.setSize(120, 40);
    expect(vt.terminal.columns).toBe(120);
    expect(vt.terminal.rows).toBe(40);
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it("ignores a resize to the size it already has", () => {
    const vt = createVirtualTerminal({ columns: 80, rows: 24 });
    const onResize = vi.fn();
    vt.terminal.start(() => {}, onResize);
    vt.setSize(80, 24);
    expect(onResize).not.toHaveBeenCalled();
  });

  it("clamps a nonsensical size to one usable column and row", () => {
    const vt = createVirtualTerminal({ columns: 80, rows: 24 });
    vt.setSize(0, -5);
    expect(vt.terminal.columns).toBe(1);
    expect(vt.terminal.rows).toBe(1);
  });

  it("routes fed input to the handler registered by start", () => {
    const vt = createVirtualTerminal({ columns: 80, rows: 24 });
    const onInput = vi.fn();
    vt.terminal.start(onInput, () => {});
    vt.feedInput("q");
    expect(onInput).toHaveBeenCalledWith("q");
  });

  it("drops input before start and after stop instead of throwing", () => {
    const vt = createVirtualTerminal({ columns: 80, rows: 24 });
    expect(() => vt.feedInput("x")).not.toThrow();
    const onInput = vi.fn();
    vt.terminal.start(onInput, () => {});
    vt.terminal.stop();
    vt.feedInput("y");
    expect(onInput).not.toHaveBeenCalled();
  });

  it("buffers writes and hands them over once", () => {
    const vt = createVirtualTerminal({ columns: 80, rows: 24 });
    vt.terminal.write("one");
    vt.terminal.write("two");
    expect(vt.drainWrites()).toBe("onetwo");
    expect(vt.drainWrites()).toBe("");
  });

  it("forwards a title change to the callback", () => {
    const onTitle = vi.fn();
    createVirtualTerminal({ columns: 80, rows: 24, onTitle }).terminal.setTitle("pi - demo");
    expect(onTitle).toHaveBeenCalledWith("pi - demo");
  });

  it("reports the kitty protocol as inactive and drains immediately", async () => {
    const vt = createVirtualTerminal({ columns: 80, rows: 24 });
    expect(vt.terminal.kittyProtocolActive).toBe(false);
    await expect(vt.terminal.drainInput()).resolves.toBeUndefined();
  });

  it("implements the cursor and clear members as no-ops without throwing", () => {
    const { terminal } = createVirtualTerminal({ columns: 80, rows: 24 });
    expect(() => {
      terminal.hideCursor();
      terminal.showCursor();
      terminal.moveBy(-2);
      terminal.clearLine();
      terminal.clearFromCursor();
      terminal.clearScreen();
      terminal.setProgress(true);
    }).not.toThrow();
  });

  it("discards a write buffer that would grow without bound", () => {
    const vt = createVirtualTerminal({ columns: 80, rows: 24, maxWriteBufferChars: 8 });
    vt.terminal.write("12345");
    vt.terminal.write("67890");
    expect(vt.drainWrites()).toBe("67890");
  });
});
