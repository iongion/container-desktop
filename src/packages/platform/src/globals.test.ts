import { describe, expect, it } from "vitest";

import { installPlatformGlobals } from "@/platform/globals";

describe("installPlatformGlobals", () => {
  it("patches the shared platform globals + the realm-specific command and extras", () => {
    const target: Record<string, unknown> = {};
    const command = { Spawn: () => undefined } as unknown as ICommand;
    const messageBus = { send: () => undefined, invoke: async () => undefined } as unknown as IMessageBus;
    const platform = { OPERATING_SYSTEM: "Linux" } as unknown as IPlatform;
    const path = { join: async () => "/joined" } as unknown as IPath;
    const fs = { readTextFile: async () => "" } as unknown as IFileSystem;

    installPlatformGlobals(target, {
      command,
      platform,
      path,
      fs,
      osType: "Linux" as IPlatform["OPERATING_SYSTEM"],
      darwinMajor: 25,
      messageBus,
      extras: { APP_PATH: "/app", TrayBus: { x: 1 } },
    });

    expect(target.Command).toBe(command);
    expect(target.MessageBus).toBe(messageBus);
    expect(target.Platform).toBe(platform);
    expect(target.Path).toBe(path);
    expect(target.FS).toBe(fs);
    expect(target.CURRENT_OS_TYPE).toBe("Linux");
    expect(target.CURRENT_DARWIN_MAJOR).toBe(25);
    expect(target.APP_PATH).toBe("/app");
    expect(target.TrayBus).toEqual({ x: 1 });
  });

  it("works with no extras", () => {
    const target: Record<string, unknown> = {};
    installPlatformGlobals(target, {
      command: {} as unknown as ICommand,
      platform: {} as unknown as IPlatform,
      path: {} as unknown as IPath,
      fs: {} as unknown as IFileSystem,
      osType: "Linux" as IPlatform["OPERATING_SYSTEM"],
      messageBus: {} as unknown as IMessageBus,
    });
    expect(target.Platform).toBeDefined();
    expect(Object.keys(target)).not.toContain("APP_PATH");
  });
});
