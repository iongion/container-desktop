// BuildAdapter — runs an image build on the ACTIVE native connection and streams progress into a sink. It
// picks the per-engine flag mapper + progress parser from the engine kind, resolves the real program path
// from the host settings, optionally writes an authored Containerfile buffer to a temp file, and drives the
// finite Command.ExecuteStreaming primitive (NOT the buffering Execute / the retry-loop background service).
//
// v1 is native-transport only. Scoped (WSL/Lima) and remote (SSH) builds are gated off in the UI; enabling
// them needs a streaming runScopeCommand / ISSHClient.executeStreaming and guest-side path handling — see the
// plan's Task 7 design note. This adapter deliberately does not reach for those seams yet.

import { ContainerEngine } from "@/env/Types";
import { buildAppleArgs } from "../builder/flags/apple";
import { buildDockerArgs } from "../builder/flags/docker";
import { buildPodmanArgs } from "../builder/flags/podman";
import { createAppleTextParser } from "../builder/parse/appleText";
import { createPodmanTextParser } from "../builder/parse/podmanText";
import { createRawjsonParser } from "../builder/parse/rawjson";
import type { BuildEngineKind, BuildProgressParser, BuildSink, ImageBuildOptions } from "../builder/types";
import { ResourceAdapter } from "./shared";

export interface BuildHandle {
  cancel: () => void;
}

const ENGINE_PROGRAM: Record<BuildEngineKind, string> = {
  docker: "docker",
  podman: "podman",
  apple: "container",
};

const MAPPERS: Record<BuildEngineKind, (options: ImageBuildOptions) => string[]> = {
  docker: buildDockerArgs,
  podman: buildPodmanArgs,
  apple: buildAppleArgs,
};

/** Map the wire ContainerEngine enum to the build-core engine kind. */
export function toBuildEngineKind(engine: ContainerEngine): BuildEngineKind {
  if (engine === ContainerEngine.PODMAN) {
    return "podman";
  }
  if (engine === ContainerEngine.APPLE) {
    return "apple";
  }
  return "docker";
}

function createParser(engine: BuildEngineKind): BuildProgressParser {
  if (engine === "podman") {
    return createPodmanTextParser();
  }
  if (engine === "apple") {
    return createAppleTextParser();
  }
  return createRawjsonParser();
}

let tempCounter = 0;

// Write an authored Containerfile buffer to a temp file under userData so `-f` can point at it without
// touching the user's build context. Best-effort; the caller falls back to the on-disk containerfilePath.
async function writeAuthoredContainerfile(options: ImageBuildOptions): Promise<string> {
  const base = await Platform.getUserDataPath();
  const dir = await Path.join(base, "build-studio");
  await FS.mkdir(dir, { recursive: true });
  tempCounter += 1;
  const file = await Path.join(dir, `Containerfile.${options.connectionId || "default"}.${tempCounter}`);
  await FS.writeTextFile(file, options.containerfileContent ?? "");
  return file;
}

export class BuildAdapter extends ResourceAdapter {
  /** Pure: program + argv + cwd for the given options (used for the command preview and by start). */
  buildArgv(options: ImageBuildOptions): { program: string; args: string[]; cwd: string } {
    return {
      program: ENGINE_PROGRAM[options.engine],
      args: MAPPERS[options.engine](options),
      cwd: options.contextDir,
    };
  }

  /** Start a streaming build; feed steps/logs to the sink and resolve a handle whose cancel() kills it. */
  async start(options: ImageBuildOptions, sink: BuildSink): Promise<BuildHandle> {
    let effective = options;
    if (options.containerfileContent != null && options.containerfileContent !== "") {
      try {
        const file = await writeAuthoredContainerfile(options);
        effective = { ...options, containerfilePath: file };
      } catch (error) {
        sink.onError(error);
      }
    }

    // Engines resolve a RELATIVE context positional against the process cwd. We run the build FROM the context
    // directory and pass "." as the positional — otherwise a relative contextDir (e.g. the development sample
    // ./support/image-builders) would resolve twice into a non-existent nested path. Absolute contexts and "."
    // are unaffected. buildArgv stays pure (the real context path) so the command preview shows where it builds.
    const cwd = await Path.resolve(effective.contextDir || ".");
    const { program, args } = this.buildArgv({ ...effective, contextDir: "." });
    let resolvedProgram = program;
    try {
      const settings = await this.host.getSettings();
      if (settings?.program?.path) {
        resolvedProgram = settings.program.path;
      }
    } catch {
      // No resolved settings (e.g. a bare test host) — fall back to the canonical binary name.
    }

    const parser = createParser(effective.engine);
    const handle = await Command.ExecuteStreaming(resolvedProgram, args, { cwd });

    handle.on("data", (payload: any) => {
      const from = payload?.from === "stderr" ? "stderr" : "stdout";
      for (const event of parser.push(from, `${payload?.data ?? ""}`)) {
        if (event.type === "step") {
          sink.onStep(event.step);
        } else if (event.type === "image") {
          sink.onImageId?.(event.imageId);
        } else {
          sink.onLog(event.key, event.line);
        }
      }
    });
    handle.on("error", (payload: any) => sink.onError(payload?.error ?? payload));
    handle.on("exit", (payload: any) => {
      sink.onDone(typeof payload?.code === "number" ? payload.code : null);
      handle.dispose();
    });

    return { cancel: () => handle.kill("SIGTERM") };
  }
}
