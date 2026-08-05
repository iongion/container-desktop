import { describe, expect, it } from "vitest";

import {
  loginEnvFileContents,
  loginRemoveArgv,
  loginRunArgv,
  type PiLoginContainerSpec,
} from "@/ai-system/adapters/piLoginContainer";

const spec: PiLoginContainerSpec = {
  imageTag: "container-desktop/pi-agent:6.1.0",
  containerName: "cd-login-abcdef12",
  hostPort: 41234,
  bridgeToken: "tok",
  piProviderId: "openrouter",
};

describe("loginRunArgv", () => {
  it("publishes the bridge to loopback only, and runs the login mode", () => {
    expect(loginRunArgv(spec, "/run/secrets/login.env")).toEqual([
      "run",
      "--detach",
      "--name",
      "cd-login-abcdef12",
      "--publish",
      "127.0.0.1:41234:8787",
      "--env-file",
      "/run/secrets/login.env",
      "container-desktop/pi-agent:6.1.0",
      "--mode",
      "login",
    ]);
  });

  // A sign-in has no credential yet, so there is nothing for it to reach: no workspace bind, no plugin volume, no
  // user mapping and no session network. Anything mounted here would be exposed for no reason at all.
  it("mounts nothing and joins no session network", () => {
    const argv = loginRunArgv(spec, "/run/secrets/login.env");
    expect(argv).not.toContain("--volume");
    expect(argv).not.toContain("--network");
    expect(argv).not.toContain("--userns");
    expect(argv).not.toContain("--user");
  });
});

describe("loginEnvFileContents", () => {
  // The provider id is NOT in the env file: it travels over the authenticated socket, so one running container can be
  // asked to sign in again — and the file that holds the bridge token stays the same file for every provider.
  it("carries the bridge token and the port pi's host listens on", () => {
    expect(loginEnvFileContents(spec)).toBe("CD_BRIDGE_TOKEN=tok\nCD_BRIDGE_PORT=8787");
  });
});

describe("loginRemoveArgv", () => {
  it("removes the container by name, forced, because it is still listening", () => {
    expect(loginRemoveArgv(spec)).toEqual(["rm", "--force", "cd-login-abcdef12"]);
  });
});
