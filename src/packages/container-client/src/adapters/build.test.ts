import { describe, expect, it } from "vitest";
import { installFakeCommand } from "@/__tests__/setup/fakeCommand";
import type { ImageBuildOptions } from "../builder/types";
import { BuildAdapter } from "./build";

const opts = (over: Partial<ImageBuildOptions> = {}): ImageBuildOptions => ({
  engine: "docker",
  connectionId: "c",
  containerfilePath: "Containerfile",
  contextDir: "/ctx",
  tags: [],
  buildArgs: {},
  labels: {},
  platforms: ["linux/amd64"],
  noCache: false,
  pull: false,
  secrets: [],
  sshMounts: [],
  namedContexts: [],
  cacheFrom: [],
  cacheTo: [],
  ...over,
});

const fakeHost = (engine = "docker") =>
  ({ ENGINE: engine, isScoped: () => false, getSettings: async () => ({ program: { path: engine } }) }) as any;

// A StreamHandle that replays one stdout chunk then exits(0) once the consumer wires up its "exit" listener.
function makeFakeHandle(output = "STEP 1/1: FROM alpine\n") {
  const listeners: Record<string, ((p: any) => void)[]> = {};
  const handle: any = {
    killed: false,
    on: (event: string, cb: (p: any) => void) => {
      if (!listeners[event]) {
        listeners[event] = [];
      }
      listeners[event].push(cb);
      if (event === "exit") {
        queueMicrotask(() => {
          for (const dataCb of listeners.data || []) dataCb({ from: "stdout", data: output });
          cb({ code: 0 });
        });
      }
    },
    off: () => {},
    dispose: () => {},
    kill: () => {
      handle.killed = true;
    },
  };
  return handle;
}

const fakeScopedHost = () => {
  const calls = { scope: [] as any[], stream: [] as any[], resolveGuest: [] as string[] };
  const handle = makeFakeHandle();
  const host = {
    ENGINE: "podman",
    isScoped: () => true,
    getSettings: async () => ({ controller: { scope: "Ubuntu-24.04" }, program: { path: "/usr/bin/podman" } }),
    runScopeCommand: async (program: string, args: string[], scope: string) => {
      calls.scope.push({ program, args, scope });
      return { success: true, stdout: "", stderr: "", code: 0 };
    },
    resolveGuestPath: async (localPath: string) => {
      calls.resolveGuest.push(localPath);
      return "/mnt/c/project";
    },
    runScopeCommandStreaming: async (program: string, args: string[], scope: string) => {
      calls.stream.push({ program, args, scope });
      return handle;
    },
  } as any;
  return { host, calls, handle };
};

describe("BuildAdapter", () => {
  it("buildArgv selects the engine program and its flag mapper", () => {
    const { program, args, cwd } = new BuildAdapter(fakeHost()).buildArgv(opts());
    expect(program).toBe("docker");
    expect(args.slice(0, 3)).toEqual(["buildx", "build", "--progress=rawjson"]);
    expect(cwd).toBe("/ctx");
  });

  it("start streams the build to the sink and resolves onDone(0)", async () => {
    const handle = installFakeCommand();
    try {
      const done = await new Promise<number | null>((resolve) => {
        void new BuildAdapter(fakeHost()).start(opts(), {
          onStep: () => {},
          onLog: () => {},
          onError: () => {},
          onDone: (code) => resolve(code),
        });
      });
      expect(done).toBe(0);
      expect(handle.calls.some((call) => call.args.includes("build"))).toBe(true);
    } finally {
      handle.restore();
    }
  });

  it("start (scoped) injects the Containerfile guest-side, translates the context, and streams the wrapper", async () => {
    const { host, calls } = fakeScopedHost();
    const done = await new Promise<number | null>((resolve) => {
      void new BuildAdapter(host).start(
        opts({ engine: "podman", containerfileContent: "FROM alpine\n", contextDir: "C:\\project" }),
        { onStep: () => {}, onLog: () => {}, onError: () => {}, onDone: (code) => resolve(code) },
      );
    });
    expect(done).toBe(0);
    // Containerfile injected via a buffered `sh -c … base64 -d …` in the right scope, round-tripping the content.
    const injection = calls.scope.find((c) => c.program === "sh" && `${c.args?.[1]}`.includes("base64 -d"));
    expect(injection).toBeTruthy();
    expect(injection.scope).toBe("Ubuntu-24.04");
    const b64 = /printf '%s' '([A-Za-z0-9+/=]+)'/.exec(injection.args[1])?.[1] ?? "";
    expect(atob(b64)).toBe("FROM alpine\n");
    // The local Windows context path was translated to a guest path.
    expect(calls.resolveGuest).toContain("C:\\project");
    // The guest build streamed the translated context + the injected -f Containerfile (never a local cwd).
    expect(calls.stream).toHaveLength(1);
    const streamed = calls.stream[0].args.join(" ");
    expect(streamed).toContain("/mnt/c/project");
    expect(streamed).toContain("/Containerfile");
  });

  it("start (scoped) cancel kills the local wrapper and pkills the guest build by its marker", async () => {
    const { host, calls, handle } = fakeScopedHost();
    const built = await new BuildAdapter(host).start(
      opts({ engine: "podman", containerfileContent: "FROM alpine\n" }),
      {
        onStep: () => {},
        onLog: () => {},
        onError: () => {},
        onDone: () => {},
      },
    );
    built.cancel();
    expect(handle.killed).toBe(true);
    const pkill = calls.scope.find((c) => `${c.args?.[1]}`.includes("pkill -TERM -f"));
    expect(pkill).toBeTruthy();
  });
});
