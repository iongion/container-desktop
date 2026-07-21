import { afterEach, describe, expect, it } from "vitest";
import { installFakeCommand } from "@/__tests__/setup/fakeCommand";
import { Runner } from "@/container-client/runner";

describe("Runner.startApi", () => {
  let cmd: ReturnType<typeof installFakeCommand>;

  afterEach(() => cmd?.restore());

  it("passes the engine proxy opt-in to managed services", async () => {
    cmd = installFakeCommand();
    const runner = new Runner({
      isApiRunning: async () => ({ success: false }),
    } as any);

    const started = await runner.startApi(undefined, { path: "podman", args: ["system", "service"], proxyEnv: true });

    expect(started).toBe(true);
    expect(cmd.calls[0]).toMatchObject({
      launcher: "podman",
      args: ["system", "service"],
      opts: { proxyEnv: true },
    });
  });
});
