import { describe, expect, it, vi } from "vitest";

const ipcRenderer = vi.hoisted(() => ({
  send: vi.fn(),
  invoke: vi.fn(async () => "ok"),
}));

vi.mock("electron", () => ({ ipcRenderer }));

import { MessageBus } from "./messageBus";

describe("MessageBus", () => {
  it("wraps Electron ipcRenderer send/invoke", async () => {
    MessageBus.send("window.minimize", { n: 1 });
    await expect(MessageBus.invoke("openFileSelector", { directory: true })).resolves.toBe("ok");

    expect(ipcRenderer.send).toHaveBeenCalledWith("window.minimize", { n: 1 });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith("openFileSelector", { directory: true });
  });
});
