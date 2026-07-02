import { describe, expect, it } from "vitest";

import { ContainerEngine } from "@/env/Types";
import { buildWSLDialStdioArgs } from "./wsl-dial-stdio";

describe("buildWSLDialStdioArgs", () => {
  it("Podman: targets the in-distro socket via --url and runs system dial-stdio", () => {
    expect(
      buildWSLDialStdioArgs({
        distribution: "Ubuntu-24.04",
        program: "podman",
        engine: ContainerEngine.PODMAN,
        socketPath: "/run/user/1000/podman/podman.sock",
      }),
    ).toEqual([
      "--distribution",
      "Ubuntu-24.04",
      "--exec",
      "podman",
      "--url",
      "unix:///run/user/1000/podman/podman.sock",
      "system",
      "dial-stdio",
    ]);
  });

  it("Docker: targets the in-distro socket via -H and runs system dial-stdio", () => {
    expect(
      buildWSLDialStdioArgs({
        distribution: "Ubuntu",
        program: "docker",
        engine: ContainerEngine.DOCKER,
        socketPath: "/var/run/docker.sock",
      }),
    ).toEqual([
      "--distribution",
      "Ubuntu",
      "--exec",
      "docker",
      "-H",
      "unix:///var/run/docker.sock",
      "system",
      "dial-stdio",
    ]);
  });
});
