import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PiLoginClient } from "@/ai-system/adapters/piLoginClient";
import { ContainerEngine, ContainerEngineHost } from "@/container-client/types/engine";
import { useAppStore } from "@/web-app/stores/appStore";
import { useProviderLoginStore } from "@/web-app/stores/providerLogin";
import { useResourceStore } from "@/web-app/stores/resourceStore";

// A provider sign-in on the connection the user actually chose.
//
// It used to run the login container through `runHostCommand` whatever that connection was — a LOCAL engine, or
// nothing at all where this machine has no engine binary — and then dial `127.0.0.1:<port>`, which only that local
// engine had published. So a user whose only engine is remote could not sign in, and the app said "the sign-in bridge
// could not be reached" while the container sat on the other machine perfectly healthy.
//
// A RENEWAL is the one thing that cannot travel, and not for want of trying: the file it needs carries the stored
// credential, and the realm that owns the vault answers with a PATH, never with contents. There is nothing for this
// realm to carry over an engine's stdin, so it runs where a file this machine wrote can be read.

const createPiLoginClient = vi.fn();

vi.mock("@/ai-system/adapters/piLoginClient", () => ({
  createPiLoginClient: (...args: unknown[]) => createPiLoginClient(...args),
}));

// The connection a login lands on, and the two questions the store asks of EVERY one of them: which scope its engine
// commands run through, and which machines its engine has. Both are the connection's answers, never a caller's.
function engine(host: ContainerEngineHost, scope?: string) {
  return {
    PROGRAM: "podman",
    HOST: host,
    isScoped: () => !!scope,
    getSettings: async () => ({ controller: scope ? { scope } : undefined }),
    // None: this engine publishes where the app already dials. The machine hop has its own tests in the connection
    // layer; here what matters is that it is ASKED.
    getPodmanMachines: async () => [],
    runHostCommand: vi.fn(async () => ({ pid: 1, code: 0, success: true, stdout: "local-id\n", stderr: "" })),
    runScopeCommand: vi.fn(async () => ({ pid: 1, code: 0, success: true, stdout: "remote-id\n", stderr: "" })),
  };
}

let hosts: Record<string, ReturnType<typeof engine>> = {};
vi.mock("@/web-app/domain/engineHost", () => ({
  resolveConnectionHost: async (id: string) => hosts[id],
}));

function connectionRow(id: string, host: ContainerEngineHost) {
  return {
    id,
    name: id,
    label: id,
    engine: ContainerEngine.PODMAN,
    host,
    settings: {},
  } as never;
}

const killed = vi.fn();
const spawned = vi.fn(async (_launcher: string, _args: string[]) => ({ kill: killed, on: () => {} }));
const setKey = vi.fn(async () => ({ ok: true }));
const writeAgentEnvFile = vi.fn(async () => ({ path: "/protected/login.env" }));
const writeAuthRefreshEnv = vi.fn(async () => ({ path: "/protected/refresh.env" }));

// pi's flow, seen from the app: it answers with a permanent key, which is what OpenRouter's own flow produces.
function fakeLoginClient() {
  return {
    onEvent: () => () => {},
    connect: vi.fn(async () => {}),
    login: vi.fn(async () => ({
      ok: true,
      credential: { type: "oauth", access: "sk-or-v1-real", refresh: "", expires: Number.MAX_SAFE_INTEGER },
    })),
    refresh: vi.fn(async () => ({ ok: true, unchanged: true, expiresAt: undefined })),
    answerPrompt: vi.fn(),
    cancel: vi.fn(),
    close: vi.fn(),
  } as unknown as PiLoginClient;
}

function dialledUrl(): string {
  return (createPiLoginClient.mock.calls[0][0] as { url: string }).url;
}

// Every engine command the run made, whichever way it went.
function commandsOn(id: string): { scoped: unknown[][]; local: unknown[][] } {
  return { scoped: hosts[id].runScopeCommand.mock.calls, local: hosts[id].runHostCommand.mock.calls };
}

function useConnections(rows: Array<{ id: string; host: ContainerEngineHost; scope?: string }>) {
  hosts = Object.fromEntries(rows.map((row) => [row.id, engine(row.host, row.scope)]));
  useAppStore.setState({
    connections: rows.map((row) => connectionRow(row.id, row.host)),
    userSettings: { connector: { default: rows[0]?.id } },
  } as never);
  useResourceStore.setState({ activeRuntime: rows.map((row) => ({ id: row.id, running: true })) } as never);
}

describe("a provider sign-in runs on the connection it was asked for", () => {
  beforeEach(() => {
    vi.stubEnv("CONTAINER_DESKTOP_MOCK", "");
    createPiLoginClient.mockImplementation(() => fakeLoginClient());
    (globalThis as { Command?: unknown }).Command = { ExecuteStreaming: spawned };
    (globalThis as { Platform?: unknown }).Platform = {
      getSSHConfig: async () => [
        {
          Name: "win11",
          Host: "win11",
          HostName: "192.168.122.5",
          Port: 22,
          User: "me",
          IdentityFile: "",
          ConfigHost: "win11",
        },
      ],
    };
    (globalThis as { window?: unknown }).window = {
      AI: { setKey, hasKey: vi.fn(async () => true), writeAgentEnvFile, writeAuthRefreshEnv },
    };
    useProviderLoginStore.getState().reset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    (globalThis as { window?: unknown }).window = undefined;
    (globalThis as { Command?: unknown }).Command = undefined;
    (globalThis as { Platform?: unknown }).Platform = undefined;
  });

  it("creates the container through the remote connection's own scope", async () => {
    useConnections([{ id: "podman-remote", host: ContainerEngineHost.PODMAN_REMOTE, scope: "win11" }]);

    const result = await useProviderLoginStore.getState().signIn("openrouter", { allowDegraded: false });

    expect(result).toEqual({ stored: true });
    const { scoped, local } = commandsOn("podman-remote");
    // Nothing at all on this machine: the previous behaviour ran every one of these against a LOCAL engine.
    expect(local).toEqual([]);
    expect(scoped.map((call) => call[2])).toEqual(["win11", "win11", "win11", "win11", "win11"]);
    expect(scoped.some((call) => (call[1] as string[]).includes("--mode"))).toBe(true);
  });

  // The container publishes on the REMOTE's loopback, so the app dialling its own reaches nothing — which is exactly
  // how this failed before: a healthy container, and "the sign-in bridge could not be reached".
  it("forwards the bridge here and dials the forward, not the port the remote published", async () => {
    useConnections([{ id: "podman-remote", host: ContainerEngineHost.PODMAN_REMOTE, scope: "win11" }]);

    await useProviderLoginStore.getState().signIn("openrouter", { allowDegraded: false });

    const [launcher, argv] = spawned.mock.calls[0] as unknown as [string, string[]];
    expect(launcher).toBe("ssh");
    const forward = argv.join(" ").match(/-NL 127\.0\.0\.1:(\d+):127\.0\.0\.1:(\d+)/) as RegExpMatchArray;
    expect(forward).toBeTruthy();
    const [, localPort, remotePort] = forward;
    expect(dialledUrl()).toBe(`ws://127.0.0.1:${localPort}/`);
    // And the far end is the port the container was actually told to publish.
    const run = commandsOn("podman-remote").scoped.find((call) =>
      (call[1] as string[]).includes("--publish"),
    )?.[1] as string[];
    expect(run.find((argument) => argument.includes(`:${remotePort}:`))).toBe(`127.0.0.1:${remotePort}:8787`);
  });

  // A sign-in container keeps listening so a refused code can be retried on the same socket, and the forward under it
  // holds a local port and an SSH connection. Leaving either behind costs the next sign-in its port.
  it("takes the container, its environment volume and the forward down again", async () => {
    useConnections([{ id: "podman-remote", host: ContainerEngineHost.PODMAN_REMOTE, scope: "win11" }]);

    await useProviderLoginStore.getState().signIn("openrouter", { allowDegraded: false });

    expect(killed).toHaveBeenCalled();
    const verbs = commandsOn("podman-remote").scoped.map((call) => (call[1] as string[]).slice(0, 4).join(" "));
    expect(verbs).toContainEqual(expect.stringMatching(/^rm --force container-desktop-login-/u));
    expect(verbs).toContainEqual(expect.stringMatching(/^volume rm --force container-desktop-env-login-/u));
  });

  it("still dials a local engine directly, with no forward at all", async () => {
    useConnections([{ id: "podman-1", host: ContainerEngineHost.PODMAN_NATIVE }]);

    await useProviderLoginStore.getState().signIn("openrouter", { allowDegraded: false });

    expect(spawned).not.toHaveBeenCalled();
    const { local } = commandsOn("podman-1");
    const run = local.find((call) => (call[1] as string[]).includes("--publish"))?.[1] as string[];
    const published = run[run.indexOf("--publish") + 1];
    expect(dialledUrl()).toBe(`ws://127.0.0.1:${published.split(":")[1]}/`);
    // A file it can read, rather than a volume carried over its own stdin.
    expect(writeAgentEnvFile).toHaveBeenCalled();
    expect(run.join(" ")).toContain("--env-file /protected/login.env");
  });
});

describe("renewing a sign-in goes where the credential can reach", () => {
  beforeEach(() => {
    vi.stubEnv("CONTAINER_DESKTOP_MOCK", "");
    createPiLoginClient.mockImplementation(() => fakeLoginClient());
    (globalThis as { Command?: unknown }).Command = { ExecuteStreaming: spawned };
    (globalThis as { window?: unknown }).window = {
      AI: { setKey, hasKey: vi.fn(async () => true), writeAgentEnvFile, writeAuthRefreshEnv },
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    (globalThis as { window?: unknown }).window = undefined;
    (globalThis as { Command?: unknown }).Command = undefined;
  });

  // The rotation's product is a credential in THIS machine's keychain, the same one whichever engine performed the
  // exchange — so preferring a local engine over the active remote costs the user nothing and is the only way the
  // exchange can happen at all.
  it("picks an engine that can be handed the file, not the active remote one", async () => {
    useConnections([
      { id: "podman-remote", host: ContainerEngineHost.PODMAN_REMOTE, scope: "win11" },
      { id: "podman-1", host: ContainerEngineHost.PODMAN_NATIVE },
    ]);

    await useProviderLoginStore.getState().refreshCredential("anthropic");

    expect(commandsOn("podman-remote").scoped).toEqual([]);
    expect(commandsOn("podman-1").local.length).toBeGreaterThan(0);
    expect(writeAuthRefreshEnv).toHaveBeenCalled();
  });

  // Refused with the reason, rather than starting a container that would be handed a bare placeholder and fail the
  // exchange as a rejected token.
  it("says why it cannot renew when every connected engine is remote", async () => {
    useConnections([{ id: "podman-remote", host: ContainerEngineHost.PODMAN_REMOTE, scope: "win11" }]);

    const outcome = await useProviderLoginStore.getState().refreshCredential("anthropic");

    expect(outcome.refreshed).toBe(false);
    expect(outcome.reason).toContain("engine on this machine");
    // Not "sign in again": the credential is fine, this machine just cannot perform the exchange.
    expect(outcome.mustSignInAgain).toBeFalsy();
    expect(commandsOn("podman-remote").scoped).toEqual([]);
    expect(writeAuthRefreshEnv).not.toHaveBeenCalled();
  });
});
