import { describe, expect, it, vi } from "vitest";

import {
  loginEnvFileContents,
  loginRemoveArgv,
  loginRunArgv,
  type PiLoginContainerSpec,
  removePiLoginContainer,
  startPiLoginContainer,
} from "@/ai-system/adapters/piLoginContainer";

const spec: PiLoginContainerSpec = {
  imageTag: "container-desktop/pi-agent:6.1.0",
  containerName: "cd-login-abcdef12",
  hostPort: 41234,
  bridgeToken: "tok",
  piProviderId: "openrouter",
};

// A sign-in on a connection whose engine is somewhere else: its commands are wrapped in that connection's scope, the
// bridge is bound where a port published there actually answers, and its environment is carried in a volume because
// `--env-file` is read by the CLIENT, which is on the other machine.
const remote: PiLoginContainerSpec = {
  ...spec,
  scope: "win11",
  machineAddress: "172.19.32.4",
  envVolumeName: "container-desktop-env-login-abcdef12",
};

function fakeHost() {
  return {
    PROGRAM: "podman",
    // What a WSL or Lima engine does with a path from this machine: the file exists, and the CLI inside the guest
    // reads it somewhere else entirely.
    resolveGuestPath: vi.fn(async (hostPath: string) => hostPath.replace(/^C:\\/u, "/mnt/c/").replace(/\\/gu, "/")),
    runHostCommand: vi.fn(async () => ({ pid: 1, code: 0, success: true, stdout: "local-id\n", stderr: "" })),
    runScopeCommand: vi.fn(async () => ({ pid: 1, code: 0, success: true, stdout: "remote-id\n", stderr: "" })),
  } as never;
}

function scopedCalls(host: unknown): unknown[][] {
  return (host as { runScopeCommand: { mock: { calls: unknown[][] } } }).runScopeCommand.mock.calls;
}

describe("loginRunArgv", () => {
  it("publishes the bridge to loopback only, and runs the login mode", () => {
    expect(loginRunArgv(spec, "/run/secrets/login.env")).toEqual([
      "run",
      "--detach",
      "--name",
      "cd-login-abcdef12",
      "--publish",
      "127.0.0.1:41234:8787",
      // Grouped with everything else this app creates, and marked ephemeral: a sign-in container exists for one
      // exchange, so a boot that finds one has found an orphan.
      "--label",
      "com.docker.compose.project=container-desktop",
      "--label",
      "com.docker.compose.service=login",
      "--label",
      "container-desktop.ai.session=ephemeral",
      "--label",
      "container-desktop.ai.role=login",
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

  // An engine inside a machine publishes into THAT machine's network, and a port published there never appears on the
  // host running it — so a forward aimed at the remote's own loopback lands one hop short of the container.
  it("binds the bridge where a port this engine publishes actually answers", () => {
    const argv = loginRunArgv(remote, "/run/secrets/login.env");
    expect(argv).toContain("172.19.32.4:41234:8787");
    expect(argv.join(" ")).not.toContain("127.0.0.1:41234");
  });

  // The env volume is the ONE mount a sign-in container may have, and the local path is not named at all: it does not
  // exist over there, and naming it is exactly what the engine refused.
  it("carries the environment in a volume for an engine that cannot read this machine's filesystem", () => {
    const argv = loginRunArgv(remote, "/run/secrets/login.env");
    expect(argv).toContain("container-desktop-env-login-abcdef12:/cd-env:ro");
    expect(argv).not.toContain("--env-file");
    expect(argv.join(" ")).not.toContain("/run/secrets/login.env");
    expect(argv).not.toContain("--network");
    expect(argv).not.toContain("--userns");
  });

  // Every argument of a remote engine's command is joined by ssh and re-split by ITS shell, so a space anywhere in
  // this argv is a command that means something else over there.
  it("composes a remote run so that shell cannot re-split it", () => {
    for (const argument of loginRunArgv(remote, "/run/secrets/login.env")) {
      expect(argument).not.toMatch(/\s/u);
    }
  });
});

describe("startPiLoginContainer", () => {
  it("runs through the connection's scope, so the container lands where its engine is", async () => {
    const host = fakeHost();

    await startPiLoginContainer(host, remote, async () => "/protected/login.env");

    // The volume create, the `tee` that carries the environment, and the run itself — all of them over there.
    expect(scopedCalls(host).map((call) => call[2])).toEqual(["win11", "win11", "win11"]);
    expect((host as unknown as { runHostCommand: { mock: { calls: unknown[] } } }).runHostCommand.mock.calls).toEqual(
      [],
    );
  });

  it("never asks this machine to write a file an engine over there could not read", async () => {
    const host = fakeHost();
    const writeEnvFile = vi.fn(async () => "/protected/login.env");

    await startPiLoginContainer(host, remote, writeEnvFile);

    expect(writeEnvFile).not.toHaveBeenCalled();
    // The token travels as stdin, never in argv: it authorises the socket the credential comes back over.
    const wrote = scopedCalls(host).find((call) => (call[1] as string[]).includes("tee"));
    expect(wrote?.[4]).toEqual({ input: loginEnvFileContents(remote) });
    for (const call of scopedCalls(host)) expect((call[1] as string[]).join(" ")).not.toContain("tok");
  });

  // A SCOPED engine that still reads this filesystem — WSL, Lima, a podman machine — runs its CLI inside the guest,
  // and `--env-file` is read by that client. Naming this machine's path there is the one case where the file exists
  // and is unreadable anyway; the workspace and the conversations have always been translated, and this was not.
  it("names a written file the way the engine's own client will see it", async () => {
    const host = fakeHost();
    const wsl: PiLoginContainerSpec = { ...spec, scope: "Ubuntu" };

    await startPiLoginContainer(host, wsl, async () => "C:\\Users\\me\\AppData\\agent\\login.env");

    const argv = scopedCalls(host).find((call) => (call[1] as string[]).includes("--mode"))?.[1] as string[];
    expect(argv).toContain("/mnt/c/Users/me/AppData/agent/login.env");
    expect(argv.join(" ")).not.toContain("C:\\");
  });

  it("leaves a local engine's own path alone", async () => {
    const host = fakeHost();

    await startPiLoginContainer(host, spec, async () => "/protected/login.env");

    const run = (host as unknown as { runHostCommand: { mock: { calls: unknown[][] } } }).runHostCommand.mock.calls[0];
    expect(run?.[1]).toContain("/protected/login.env");
  });

  // A renewal's environment is not this app's to compose — the realm that owns the vault substitutes the credential
  // while WRITING a file and answers only its path. Carrying what this module composes would put the bare placeholder
  // in the container and start a refresh that cannot possibly authenticate.
  it("refuses to carry a stored credential to an engine that cannot be handed a file", async () => {
    const host = fakeHost();

    await expect(
      startPiLoginContainer(host, { ...remote, carriesStoredCredential: true }, async () => "/protected/refresh.env"),
    ).rejects.toThrow("cannot read this machine's filesystem");
    expect(scopedCalls(host)).toEqual([]);
  });
});

describe("removePiLoginContainer", () => {
  // It holds the bridge token that authorised the socket the credential came back over, so it goes with the container
  // rather than waiting for a next sign-in that may never happen.
  it("takes the environment volume down with the container", async () => {
    const host = fakeHost();

    await removePiLoginContainer(host, remote);

    expect(scopedCalls(host).map((call) => call[1])).toEqual([
      ["rm", "--force", "cd-login-abcdef12"],
      ["volume", "rm", "--force", "container-desktop-env-login-abcdef12"],
    ]);
  });

  it("has no volume to remove where the environment was a file", async () => {
    const host = fakeHost();

    await removePiLoginContainer(host, spec);

    const calls = (host as unknown as { runHostCommand: { mock: { calls: unknown[][] } } }).runHostCommand.mock.calls;
    expect(calls.map((call) => call[1])).toEqual([["rm", "--force", "cd-login-abcdef12"]]);
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
