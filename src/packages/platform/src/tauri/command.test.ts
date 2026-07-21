import { describe, expect, it, vi } from "vitest";
import { createRustCommand } from "./command";

const noChannel = () => ({ onmessage: null });

describe("createRustCommand", () => {
  it("assembles the Command facade over the Tauri exec modules", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "command_execute") {
        return { pid: 12, code: 0, success: true, stdout: "ok", stderr: "", command: "podman ps" };
      }
      return undefined;
    });
    const command = createRustCommand({
      invoke,
      newProcessChannel: noChannel,
      newProxyChannel: noChannel,
      osType: "Linux",
    });

    await expect(command.Execute("podman", ["ps"], { cwd: "/tmp" })).resolves.toMatchObject({
      code: 0,
      stdout: "ok",
    });
    await expect(command.Spawn("podman", ["ps"], { cwd: "/tmp" })).resolves.toEqual({
      status: 0,
      stdout: "ok",
      stderr: "",
      pid: 12,
    });
    expect(invoke).toHaveBeenCalledWith("command_execute", {
      launcher: "podman",
      args: ["ps"],
      cwd: "/tmp",
      env: undefined,
    });
  });

  it("stops both the connection id and relay cache keys", async () => {
    const invoke = vi.fn(async () => undefined);
    const command = createRustCommand({
      invoke,
      newProcessChannel: noChannel,
      newProxyChannel: noChannel,
      osType: "Linux",
    });

    await command.StopConnectionServices("ssh.prod", { api: { connection: { relay: "/run/podman.sock" } } } as any);

    expect(invoke).toHaveBeenCalledWith("proxy_bridge_stop", { key: "ssh.prod" });
    expect(invoke).toHaveBeenCalledWith("proxy_bridge_stop", { key: "/run/podman.sock" });
  });
});
