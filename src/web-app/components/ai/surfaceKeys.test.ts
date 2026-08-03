import { describe, expect, it } from "vitest";

import { keyEventToTerminalData } from "@/web-app/components/ai/surfaceKeys";

const key = (over: Partial<KeyboardEvent>) =>
  ({ key: "a", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...over }) as KeyboardEvent;

describe("keyEventToTerminalData", () => {
  it("passes a printable character through", () => {
    expect(keyEventToTerminalData(key({ key: "q" }))).toBe("q");
    expect(keyEventToTerminalData(key({ key: "Q", shiftKey: true }))).toBe("Q");
    expect(keyEventToTerminalData(key({ key: " " }))).toBe(" ");
  });

  it("encodes Enter, Tab, Backspace and Escape", () => {
    expect(keyEventToTerminalData(key({ key: "Enter" }))).toBe("\r");
    expect(keyEventToTerminalData(key({ key: "Tab" }))).toBe("\t");
    expect(keyEventToTerminalData(key({ key: "Backspace" }))).toBe("\x7f");
    expect(keyEventToTerminalData(key({ key: "Escape" }))).toBe("\x1b");
  });

  it("encodes the arrow keys as CSI sequences", () => {
    expect(keyEventToTerminalData(key({ key: "ArrowUp" }))).toBe("\x1b[A");
    expect(keyEventToTerminalData(key({ key: "ArrowDown" }))).toBe("\x1b[B");
    expect(keyEventToTerminalData(key({ key: "ArrowRight" }))).toBe("\x1b[C");
    expect(keyEventToTerminalData(key({ key: "ArrowLeft" }))).toBe("\x1b[D");
  });

  it("encodes control combinations", () => {
    expect(keyEventToTerminalData(key({ key: "c", ctrlKey: true }))).toBe("\x03");
    expect(keyEventToTerminalData(key({ key: "d", ctrlKey: true }))).toBe("\x04");
    expect(keyEventToTerminalData(key({ key: " ", ctrlKey: true }))).toBe("\x00");
  });

  it("encodes alt as an escape prefix", () => {
    expect(keyEventToTerminalData(key({ key: "b", altKey: true }))).toBe("\x1bb");
    expect(keyEventToTerminalData(key({ key: "Enter", altKey: true }))).toBe("\x1b\r");
    expect(keyEventToTerminalData(key({ key: "Backspace", altKey: true }))).toBe("\x1b\x7f");
  });

  it("encodes Home, End, PageUp, PageDown, Delete and Insert", () => {
    expect(keyEventToTerminalData(key({ key: "Home" }))).toBe("\x1b[H");
    expect(keyEventToTerminalData(key({ key: "End" }))).toBe("\x1b[F");
    expect(keyEventToTerminalData(key({ key: "PageUp" }))).toBe("\x1b[5~");
    expect(keyEventToTerminalData(key({ key: "PageDown" }))).toBe("\x1b[6~");
    expect(keyEventToTerminalData(key({ key: "Delete" }))).toBe("\x1b[3~");
    expect(keyEventToTerminalData(key({ key: "Insert" }))).toBe("\x1b[2~");
  });

  it("encodes shift+tab the way pi reads it", () => {
    expect(keyEventToTerminalData(key({ key: "Tab", shiftKey: true }))).toBe("\x1b[Z");
  });

  it("returns undefined for modifier-only and unhandled keys", () => {
    expect(keyEventToTerminalData(key({ key: "Shift" }))).toBeUndefined();
    expect(keyEventToTerminalData(key({ key: "Control" }))).toBeUndefined();
    expect(keyEventToTerminalData(key({ key: "F13" }))).toBeUndefined();
  });

  it("leaves the app's own shortcuts alone by declining anything with a meta key", () => {
    expect(keyEventToTerminalData(key({ key: "c", metaKey: true }))).toBeUndefined();
  });

  it("declines a browser copy or paste so the clipboard still works over a surface", () => {
    expect(keyEventToTerminalData(key({ key: "c", ctrlKey: true, shiftKey: true }))).toBeUndefined();
    expect(keyEventToTerminalData(key({ key: "v", ctrlKey: true, shiftKey: true }))).toBeUndefined();
  });
});
