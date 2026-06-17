import { describe, expect, it } from "vitest";

import { installPlatformGlobals } from "./globals";

describe("installPlatformGlobals", () => {
  it("patches the shared platform globals + the realm-specific command and extras", () => {
    const target: Record<string, unknown> = {};
    const command = { Spawn: () => undefined } as unknown as ICommand;
    const messageBus = { send: () => undefined, invoke: async () => undefined } as unknown as IMessageBus;

    installPlatformGlobals(target, { command, messageBus, extras: { APP_PATH: "/app", TrayBus: { x: 1 } } });

    expect(target.Command).toBe(command);
    expect(target.MessageBus).toBe(messageBus);
    expect(target.Platform).toBeDefined();
    expect(target.Path).toBeDefined();
    expect(target.FS).toBeDefined();
    expect(target.CURRENT_OS_TYPE).toBeDefined();
    expect(target.APP_PATH).toBe("/app");
    expect(target.TrayBus).toEqual({ x: 1 });
  });

  it("works with no extras", () => {
    const target: Record<string, unknown> = {};
    installPlatformGlobals(target, {
      command: {} as unknown as ICommand,
      messageBus: {} as unknown as IMessageBus,
    });
    expect(target.Platform).toBeDefined();
    expect(Object.keys(target)).not.toContain("APP_PATH");
  });
});
