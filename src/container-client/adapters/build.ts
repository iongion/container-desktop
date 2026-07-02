// BuildAdapter — runs an image build on the ACTIVE connection and streams progress into a sink. It picks the
// per-engine flag mapper + progress parser from the engine kind and drives the finite Command.ExecuteStreaming
// primitive (NOT the buffering Execute / the retry-loop background service).
//
// Native connections build locally (Command.ExecuteStreaming from the context dir). Scoped (WSL/Lima/podman-
// machine) and remote (SSH) connections run the engine INSIDE the guest/over SSH via runScopeCommandStreaming:
// the authored Containerfile is injected guest-side and the context path is translated to the guest (WSL
// wslpath; Lima/machine/SSH identity). The guest temp dir doubles as the cancel/cleanup marker.

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

// UTF-8 → base64 without Node's Buffer (this adapter runs in the renderer). Used to inject the authored
// Containerfile into the guest for scoped/remote builds via `printf '%s' <b64> | base64 -d`.
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
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

  /** Start a streaming build; native runs locally, scoped/remote runs the engine inside the guest / over SSH. */
  async start(options: ImageBuildOptions, sink: BuildSink): Promise<BuildHandle> {
    return this.host.isScoped() ? await this.startScoped(options, sink) : await this.startNative(options, sink);
  }

  // Parse stdout/stderr chunks into steps/logs and resolve the run on exit. Shared by native + scoped paths.
  private wireHandle(handle: StreamHandle, parser: BuildProgressParser, sink: BuildSink, onExit?: () => void): void {
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
      onExit?.();
    });
  }

  // Native: the engine is local. Write the authored Containerfile to a temp file, run FROM the context dir with
  // "." as the positional (engines resolve a RELATIVE positional against the process cwd), and stream locally.
  private async startNative(options: ImageBuildOptions, sink: BuildSink): Promise<BuildHandle> {
    let effective = options;
    if (options.containerfileContent != null && options.containerfileContent !== "") {
      try {
        const file = await writeAuthoredContainerfile(options);
        effective = { ...options, containerfilePath: file };
      } catch (error) {
        sink.onError(error);
      }
    }
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
    this.wireHandle(handle, parser, sink);
    return { cancel: () => handle.kill("SIGTERM") };
  }

  // Scoped/remote: the engine runs inside the guest (WSL/Lima/machine) or over SSH. Inject the authored
  // Containerfile into a guest temp dir (its path doubles as the cancel/cleanup marker), translate the context
  // to a guest path, build with the guest program NAME (the guest resolves it), and stream the wrapper CLI.
  private async startScoped(options: ImageBuildOptions, sink: BuildSink): Promise<BuildHandle> {
    const noop: BuildHandle = { cancel: () => undefined };
    const settings = await this.host.getSettings().catch(() => undefined);
    const scope = settings?.controller?.scope || "";
    tempCounter += 1;
    const safeId = (options.connectionId || "default").replace(/[^A-Za-z0-9._-]/g, "_");
    const guestDir = `/tmp/container-desktop-build/${safeId}-${tempCounter}`;
    const guestContainerfile = `${guestDir}/Containerfile`;
    try {
      const b64 = toBase64(options.containerfileContent ?? "");
      const script = `mkdir -p '${guestDir}' && printf '%s' '${b64}' | base64 -d > '${guestContainerfile}'`;
      const injected = await this.host.runScopeCommand("sh", ["-c", script], scope, settings);
      if (!injected.success) {
        sink.onError(new Error(`Containerfile injection failed: ${injected.stderr || "unknown error"}`));
        return noop;
      }
    } catch (error) {
      sink.onError(error);
      return noop;
    }
    // Translate the LOCAL context (WSL pickers return Windows paths) to a guest path; SSH/Lima/machine identity.
    const guestContext = await this.host.resolveGuestPath(options.contextDir || ".", scope, settings);
    const { program, args } = this.buildArgv({
      ...options,
      containerfilePath: guestContainerfile,
      contextDir: guestContext,
    });
    const parser = createParser(options.engine);
    const handle = await this.host.runScopeCommandStreaming(program, args, scope, settings);
    this.wireHandle(handle, parser, sink, () => {
      void this.host.runScopeCommand("rm", ["-rf", guestDir], scope, settings).catch(() => undefined);
    });
    return {
      cancel: () => {
        handle.kill("SIGTERM");
        // Killing the LOCAL wrapper may not stop the guest build — target it by its unique guest-dir marker.
        void this.host
          .runScopeCommand("sh", ["-c", `pkill -TERM -f '${guestDir}' 2>/dev/null; true`], scope, settings)
          .catch(() => undefined);
      },
    };
  }
}
