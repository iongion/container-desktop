import { describe, expect, it, vi } from "vitest";

import { connectionCommandScope } from "@/container-client/runtimes/commandScope";
import type { HostClientFacade } from "@/container-client/runtimes/facade";

// Which scope a connection's engine commands run through is the CONNECTION's answer, made of two halves it owns: the
// transport says whether commands are wrapped at all, and the settings say in what. A caller that carried a scope of
// its own got whatever its own caller happened to know — for the assistant, nothing at all.

function connection(scoped: boolean, scope?: string) {
  return {
    isScoped: () => scoped,
    getSettings: vi.fn(async () => ({ controller: scope === undefined ? undefined : { scope } })),
  } as unknown as HostClientFacade;
}

describe("connectionCommandScope", () => {
  it("names the scope a scoped connection wraps its commands in", async () => {
    expect(await connectionCommandScope(connection(true, "win11"))).toBe("win11");
  });

  // A native connection's engine IS on this machine, and its commands are the plain ones. Asking for settings would
  // cost a read to be told the same thing.
  it("answers nothing for a connection that wraps nothing, without reading its settings", async () => {
    const host = connection(false, "ignored");

    expect(await connectionCommandScope(host)).toBe(undefined);
    expect(host.getSettings).not.toHaveBeenCalled();
  });

  // A scoped connection with no scope configured has nothing to wrap commands in, and the empty string is not a scope:
  // it would send `wsl -d ''` at the transport instead of falling back to the plain host command.
  it("answers nothing when a scoped connection names no scope", async () => {
    expect(await connectionCommandScope(connection(true, ""))).toBe(undefined);
    expect(await connectionCommandScope(connection(true, undefined))).toBe(undefined);
  });

  // Settings already in hand are used as they are: a caller that read them for its own command must not have them
  // read again underneath it, or the two halves of one decision could come from two different reads.
  it("uses the settings a caller already read", async () => {
    const host = connection(true, "from-the-host");

    expect(await connectionCommandScope(host, { controller: { scope: "from-the-caller" } } as never)).toBe(
      "from-the-caller",
    );
    expect(host.getSettings).not.toHaveBeenCalled();
  });
});
