import { describe, expect, it } from "vitest";
import { WSLTransport, windowsPathToWSLPath } from "./wsl";

describe("windowsPathToWSLPath", () => {
  it("translates drive-letter Windows paths (from the file/dir pickers) to /mnt/<drive>/…", () => {
    expect(windowsPathToWSLPath("C:\\Users\\me\\project")).toBe("/mnt/c/Users/me/project");
    expect(windowsPathToWSLPath("D:/data/app")).toBe("/mnt/d/data/app");
    expect(windowsPathToWSLPath("C:\\")).toBe("/mnt/c");
  });

  it("passes POSIX / relative paths through unchanged", () => {
    expect(windowsPathToWSLPath("/home/me/project")).toBe("/home/me/project");
    expect(windowsPathToWSLPath("./support/image-builders")).toBe("./support/image-builders");
  });
});

describe("WSLTransport scoped streaming", () => {
  const fakeHost = (calls: any[]) =>
    ({
      getSettings: async () => ({ controller: { path: "wsl.exe" } }),
      runHostCommandStreaming: async (launcher: string, args: string[]) => {
        calls.push({ launcher, args });
        return { on: () => {}, off: () => {}, dispose: () => {}, kill: () => {} };
      },
    }) as any;

  it("streams `wsl --distribution <scope> --exec <program> <args>` via runHostCommandStreaming", async () => {
    const calls: any[] = [];
    await new WSLTransport().runScopeCommandStreaming(
      fakeHost(calls),
      "podman",
      ["build", "-f", "/cf", "/ctx"],
      "Ubuntu-24.04",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].launcher).toBe("wsl.exe");
    expect(calls[0].args).toEqual(["--distribution", "Ubuntu-24.04", "--exec", "podman", "build", "-f", "/cf", "/ctx"]);
  });

  it("resolveGuestPath translates the picker's Windows context path", async () => {
    const guest = await new WSLTransport().resolveGuestPath({} as any, "C:\\project");
    expect(guest).toBe("/mnt/c/project");
  });
});
