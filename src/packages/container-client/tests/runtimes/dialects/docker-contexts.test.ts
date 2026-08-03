import { describe, expect, it } from "vitest";

import { dockerDialect, parseContextList } from "@/container-client/runtimes/dialects/docker";
import type { EngineConnectorSettings } from "@/container-client/types/connection";

// Verbatim from the real CLI (Docker 29.7.1, macOS, five contexts).
// The two rules that would have been guessed wrong: the output is NDJSON rather than an array, and the endpoint
// is `DockerEndpoint` here where `context inspect` calls it `Endpoints.docker.Host`.
const REAL_LS_OUTPUT = [
  '{"Current":false,"Description":"colima","DockerEndpoint":"unix:///Users/iongion/.colima/default/docker.sock","Error":"","Name":"colima"}',
  '{"Current":false,"Description":"Current DOCKER_HOST based configuration","DockerEndpoint":"unix:///var/run/docker.sock","Error":"","Name":"default"}',
  '{"Current":false,"Description":"Docker Desktop","DockerEndpoint":"unix:///Users/iongion/.docker/run/docker.sock","Error":"","Name":"desktop-linux"}',
  '{"Current":true,"Description":"","DockerEndpoint":"unix:///Users/iongion/.lima/ubuntu-vm/sock/docker.sock","Error":"","Name":"lima-ubuntu-vm"}',
].join("\n");

const settings = (context?: string): EngineConnectorSettings =>
  ({
    api: { baseURL: "http://localhost", connection: { uri: "", relay: "" } },
    program: { name: "docker", path: "/usr/bin/docker", version: "" },
    rootfull: false,
    mode: "mode.automatic",
    context,
  }) as EngineConnectorSettings;

// A host that records every command and answers whatever the test supplies.
const fakeHost = (calls: any[], stdout: string, success = true) =>
  ({
    id: "host.default.docker.native",
    logger: { error: () => {}, debug: () => {}, warn: () => {} },
    isScoped: () => false,
    getSettings: async () => settings(),
    runHostCommand: async (launcher: string, args: string[]) => {
      calls.push({ launcher, args });
      return { success, stdout, stderr: "", code: success ? 0 : 1, pid: null };
    },
  }) as any;

describe("parseContextList", () => {
  it("reads NDJSON — one context per line — and every field of each", () => {
    const contexts = parseContextList(REAL_LS_OUTPUT);
    expect(contexts).toHaveLength(4);
    expect(contexts[2]).toEqual({
      Name: "desktop-linux",
      DockerEndpoint: "unix:///Users/iongion/.docker/run/docker.sock",
      Description: "Docker Desktop",
      Current: false,
      Error: "",
    });
    // Exactly one is current, and it is the one the CLI marked — not the first, and not the one whose name
    // happens to match an engine.
    expect(contexts.filter((it) => it.Current).map((it) => it.Name)).toEqual(["lima-ubuntu-vm"]);
  });

  it("keeps the endpoint's scheme, because npipe:// and unix:// are the difference between two rows", () => {
    const [context] = parseContextList('{"Name":"win","DockerEndpoint":"npipe:////./pipe/dockerDesktopLinuxEngine"}');
    expect(context.DockerEndpoint).toBe("npipe:////./pipe/dockerDesktopLinuxEngine");
  });

  it("loses only the line that will not parse, never the whole listing", () => {
    // Docker writes its errors to stderr, so an unreadable line here is one broken context — hiding the working
    // ones behind it would strand every usable endpoint.
    const contexts = parseContextList('{"Name":"a","DockerEndpoint":"unix:///a.sock"}\nnot json\n\n{"Name":"b"}\n');
    expect(contexts.map((it) => it.Name)).toEqual(["a", "b"]);
  });

  it("answers nothing for the outputs an empty store and an older docker leave", () => {
    for (const stdout of ["", "   \n \n", "[]"]) {
      expect(parseContextList(stdout)).toEqual([]);
    }
  });
});

describe("the context a connection is pinned to", () => {
  it("is passed as a GLOBAL flag, before the subcommand", async () => {
    // Global is what makes one flag retarget `context inspect` and `system dial-stdio` alike; after the
    // subcommand it would belong to that subcommand and retarget nothing.
    const calls: any[] = [];
    await dockerDialect.readEngineSocket(
      fakeHost(calls, '[{"Endpoints":{"docker":{"Host":"unix:///run/pinned.sock"}}}]'),
      settings("desktop-linux"),
    );
    expect(calls[0].args).toEqual(["--context", "desktop-linux", "context", "inspect", "--format", "json"]);
  });

  it("is absent for every connection that names none, which is all of them until one is pinned", async () => {
    const calls: any[] = [];
    await dockerDialect.readEngineSocket(fakeHost(calls, "[]"), settings());
    expect(calls[0].args).toEqual(["context", "inspect", "--format", "json"]);
  });

  it("is blank-safe — a name of spaces is no name, and docker would refuse it rather than fall back", async () => {
    const calls: any[] = [];
    await dockerDialect.readEngineSocket(fakeHost(calls, "[]"), settings("   "));
    expect(calls[0].args).toEqual(["context", "inspect", "--format", "json"]);
  });

  it("travels with the stdio bridge, where its absence would be invisible", async () => {
    // The remote's own `docker system dial-stdio` dials whatever `docker context use` last selected THERE. A
    // pinned connection would otherwise detect one engine and carry its data to another.
    const calls: any[] = [];
    const bridge = await dockerDialect.resolveDialStdioBridge!(
      fakeHost(calls, '[{"Endpoints":{"docker":{"Host":"unix:///var/run/docker.sock"}}}]'),
      settings("desktop-linux"),
    );
    expect(bridge?.command).toEqual(["docker", "--context", "desktop-linux", "system", "dial-stdio"]);

    const unpinned = await dockerDialect.resolveDialStdioBridge!(
      fakeHost([], '[{"Endpoints":{"docker":{"Host":"unix:///var/run/docker.sock"}}}]'),
      settings(),
    );
    expect(unpinned?.command).toEqual(["docker", "system", "dial-stdio"]);
  });
});

describe("the contexts extension", () => {
  it("lists what the CLI reported and asks it the right question", async () => {
    const calls: any[] = [];
    const contexts = await dockerDialect.bindExtensions(fakeHost(calls, REAL_LS_OUTPUT)).getDockerContexts!();
    expect(calls[0].args).toEqual(["context", "ls", "--format", "json"]);
    expect(contexts.map((it) => it.Name)).toEqual(["colima", "default", "desktop-linux", "lima-ubuntu-vm"]);
  });

  it("lists WITHOUT the pin, because the pin would decide which row is Current", async () => {
    // The one docker command that must not carry `--context`. `context ls` reads the machine's context store
    // and dials no endpoint, so the flag only changes which row comes back marked Current — verified on a real
    // CLI whose selection was `lima-ubuntu-vm`: `docker --context desktop-linux context ls` reported
    // desktop-linux as current while `docker context show` still said lima-ubuntu-vm. Caught by reading the
    // live contexts screen, which showed `pinned · current` on the wrong row.
    const calls: any[] = [];
    const host = {
      ...fakeHost(calls, REAL_LS_OUTPUT),
      getSettings: async () => settings("desktop-linux"),
    } as any;

    await dockerDialect.bindExtensions(host).getDockerContexts!();

    expect(calls[0].args).toEqual(["context", "ls", "--format", "json"]);
  });

  it("answers no contexts when the listing FAILED rather than reading the body it disowned", async () => {
    const contexts = await dockerDialect.bindExtensions(fakeHost([], REAL_LS_OUTPUT, false)).getDockerContexts!();
    expect(contexts).toEqual([]);
  });

  it("inspects the context it was ASKED about, not whichever one is current", async () => {
    // It used to ignore its argument entirely and answer about the current context whatever was passed.
    const calls: any[] = [];
    await dockerDialect.bindExtensions(fakeHost(calls, '[{"Name":"colima"}]')).inspectDockerContext!("colima");
    expect(calls[0].args).toEqual(["context", "inspect", "colima", "--format", "json"]);
  });

  it("never switches the CLI's global context, and that is a decision rather than a gap", async () => {
    // `docker context use` repoints every other connection and every shell on the machine — the cause of the
    // defect pinning exists to fix. A connection names the context it wants instead (ADR-0016).
    const calls: any[] = [];
    expect(await dockerDialect.bindExtensions(fakeHost(calls, "")).useDockerContext!("colima")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("advertises contexts as a capability now that two of its three methods are real", () => {
    expect(dockerDialect.capabilitiesBase.extensions.contexts).toBe(true);
  });
});
