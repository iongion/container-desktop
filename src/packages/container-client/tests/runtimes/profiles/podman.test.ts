import { describe, expect, it } from "vitest";
import type { HostContext } from "@/container-client/runtimes/composition";
import { podmanVendorProfile } from "@/container-client/runtimes/profiles/podman";

// A Podman machine serves its API on the HOST: macOS's `podman machine inspect` names a socket under $TMPDIR, Windows
// a named pipe. `podman system info` names the socket INSIDE the VM (unix:///run/podman/podman.sock), and the native
// proxy dials the relay before the uri — so a relay set to that path sends every request into a socket that does not
// exist on the host. Measured on a real Mac (podman 6.0.2): the app found the running machine and every ping failed.
function machineHost(uri: string) {
  const settings = { controller: { scope: "podman-machine-default" } };
  return {
    id: "system-default.podman",
    isScoped: () => true,
    getSettings: async () => settings,
    transport: { resolveScopeURI: async () => uri },
    dialect: { readEngineSocket: async () => "unix:///run/podman/podman.sock" },
    logger: { error: () => undefined, warn: () => undefined },
  } as unknown as HostContext;
}

describe("podmanVendorProfile.getApiConnection — a Podman machine's API", () => {
  it("dials the machine's host socket on macOS, never the socket inside the VM", async () => {
    const socket = "/var/folders/zn/T/podman/podman-machine-default-api.sock";
    expect(await podmanVendorProfile.getApiConnection(machineHost(socket))).toEqual({ uri: socket, relay: "" });
  });

  it("dials the machine's named pipe on Windows directly", async () => {
    const pipe = "npipe:////./pipe/podman-machine-default";
    expect(await podmanVendorProfile.getApiConnection(machineHost(pipe))).toEqual({ uri: pipe, relay: "" });
  });
});
