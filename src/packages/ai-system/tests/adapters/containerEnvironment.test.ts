import { describe, expect, it, vi } from "vitest";

import {
  type ContainerEnvCarrier,
  carryEnvIntoVolume,
  containerEnvArgv,
  envVolumeCreateArgv,
  envVolumeRemoveArgv,
  envWriteArgv,
  isExistingNameError,
} from "@/ai-system/adapters/containerEnvironment";
import { AGENT_ENV_FILE_IN_IMAGE } from "@/pi-bridge/image";

// Getting an environment INTO a container whose engine cannot read this machine's filesystem, with no shell and no
// file on either machine: the contents travel as stdin, which the exec seam forwards to the remote command without
// them ever appearing in argv. Argv is what the bridge token must stay out of — it authorises the socket AND the proxy
// a turn's inference is signed through.

const carried: ContainerEnvCarrier = {
  imageTag: "container-desktop/pi-agent:6.1.0",
  envVolumeName: "container-desktop-env-1a2b",
};
const handedAFile: ContainerEnvCarrier = { imageTag: "container-desktop/pi-agent:6.1.0" };

describe("the carried environment's own commands", () => {
  it("creates the volume it will be carried in", () => {
    expect(envVolumeCreateArgv(carried)).toEqual(["volume", "create", "container-desktop-env-1a2b"]);
  });

  it("writes it with stdin alone — no shell, no redirect, nothing with a space in it", () => {
    const argv = envWriteArgv(carried);
    expect(argv.slice(0, 2)).toEqual(["run", "--rm"]);
    // Without `--interactive` the engine gives the container no stdin at all and `tee` writes an empty file.
    expect(argv).toContain("--interactive");
    expect(argv).toContain("container-desktop-env-1a2b:/cd-env");
    // `tee` rather than `sh -c "cat > …"`: a redirect inside an argument is executed by the REMOTE shell, which would
    // write the engine's own output to a file on that machine instead.
    expect(argv).toContain("--entrypoint");
    expect(argv).toContain("tee");
    expect(argv.at(-1)).toBe(AGENT_ENV_FILE_IN_IMAGE);
    for (const argument of argv) expect(argument).not.toMatch(/\s/u);
  });

  // A fresh volume belongs to root, and the image runs as `agent`. The writer is the one container that needs to be
  // root; what it leaves behind is world-readable inside a volume only this run's own container mounts.
  it("writes as the user that owns a new volume", () => {
    expect(envWriteArgv(carried).join(" ")).toContain("--user 0");
  });

  it("removes it by force, because it belongs to the run and not to the next one", () => {
    expect(envVolumeRemoveArgv(carried)).toEqual(["volume", "rm", "--force", "container-desktop-env-1a2b"]);
  });
});

describe("containerEnvArgv", () => {
  it("hands a file to an engine whose client can read this machine's filesystem", () => {
    expect(containerEnvArgv(handedAFile, "/protected/agent.env")).toEqual(["--env-file", "/protected/agent.env"]);
  });

  // `--env-file` is read by the CLIENT, so a path under this app's user data means nothing to a podman on another
  // machine — a remote session died there before any container existed.
  it("names the volume, and never the local path, for one whose cannot", () => {
    const argv = containerEnvArgv(carried, "/protected/agent.env");
    expect(argv).toEqual([
      "--volume",
      "container-desktop-env-1a2b:/cd-env:ro",
      "--env",
      `CD_ENV_FILE=${AGENT_ENV_FILE_IN_IMAGE}`,
    ]);
    expect(argv.join(" ")).not.toContain("/protected/agent.env");
  });

  // Read-only: nothing inside the container has any business rewriting the token that authorises it.
  it("mounts it read-only", () => {
    expect(containerEnvArgv(carried, "/protected/agent.env")[1]).toMatch(/:ro$/u);
  });
});

describe("carryEnvIntoVolume", () => {
  it("creates the volume, then writes the contents over stdin and never in argv", async () => {
    const run = vi.fn(async (_argv: string[], _input?: string) => "");

    const path = await carryEnvIntoVolume(run, carried, "CD_BRIDGE_TOKEN=secret-token");

    expect(path).toBe(AGENT_ENV_FILE_IN_IMAGE);
    expect(run.mock.calls[0]).toEqual([envVolumeCreateArgv(carried)]);
    expect(run.mock.calls[1]).toEqual([envWriteArgv(carried), "CD_BRIDGE_TOKEN=secret-token"]);
    for (const [argv] of run.mock.calls) {
      expect(argv.join(" ")).not.toContain("secret-token");
    }
  });

  // Run-scoped, so an existing one is this run's own leftovers — and the write that follows overwrites it.
  it("carries on when the volume is already there", async () => {
    const run = vi.fn(async (argv: string[], _input?: string) => {
      if (argv[1] === "create") throw new Error('volume with name "x" already exists');
      return "";
    });

    await expect(carryEnvIntoVolume(run, carried, "CD_BRIDGE_TOKEN=tok")).resolves.toBe(AGENT_ENV_FILE_IN_IMAGE);
    expect(run).toHaveBeenCalledTimes(2);
  });

  // Everything else a create can fail with — an exhausted address pool above all — has to travel, or the caller's next
  // command fails for a reason that reads nothing like the real one.
  it("lets any other failure through rather than writing into a volume that does not exist", async () => {
    const run = vi.fn(async (argv: string[], _input?: string) => {
      if (argv[1] === "create") throw new Error("no space left on device");
      return "";
    });

    await expect(carryEnvIntoVolume(run, carried, "CD_BRIDGE_TOKEN=tok")).rejects.toThrow("no space left on device");
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("isExistingNameError", () => {
  it("knows the engines' several ways of saying a name is taken", () => {
    expect(isExistingNameError(new Error('network "cd-agent-net-1" already exists'))).toBe(true);
    expect(isExistingNameError(new Error("the container name is already in use"))).toBe(true);
    expect(isExistingNameError(new Error("that name is already used"))).toBe(true);
  });

  it("does not swallow a failure that means something else", () => {
    expect(isExistingNameError(new Error("no space left on device"))).toBe(false);
  });
});
