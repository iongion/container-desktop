import { describe, expect, it } from "vitest";
import { dockerWSLProfile } from "@/container-client/runtimes/profiles/docker";

// A host just complete enough for dockerWSLProfile.getApiConnection: a scope, a transport that imposes
// the relay pipe, the scoped DOCKER_HOST read, and a dialect whose engine socket the test controls.
const wslHost = (engineSocket: string | (() => Promise<string>), dockerHost = "unix:///var/run/docker.sock") =>
  ({
    id: "host.default.docker.virtualized.wsl",
    logger: { debug: () => {}, warn: () => {}, error: () => {} },
    getSettings: async () => ({ controller: { scope: "Ubuntu-24.04" } }),
    getScopeEnvironmentVariable: async (_scope: string, name: string) => (name === "DOCKER_HOST" ? dockerHost : ""),
    transport: {
      resolveScopeURI: async () => "\\\\.\\pipe\\container-desktop-ssh-relay-x",
    },
    dialect: {
      readEngineSocket: async () => (typeof engineSocket === "string" ? engineSocket : await engineSocket()),
    },
  }) as any;

describe("dockerWSLProfile — the scoped DOCKER_HOST relay fallback", () => {
  it("uses the engine socket when `docker context inspect` answers", async () => {
    const connection = await dockerWSLProfile.getApiConnection(wslHost("/run/docker-from-context.sock"), undefined);

    expect(connection.uri).toBe("\\\\.\\pipe\\container-desktop-ssh-relay-x");
    expect(connection.relay).toBe("/run/docker-from-context.sock");
  });

  // The regression this file exists for. getContextInspect catches its own failure and returns {}, so a
  // distribution whose `docker context inspect` fails reaches readEngineSocket's EMPTY return and not a
  // throw. The line used to be `|| ""`, which discarded the printenv fallback on exactly the path the
  // fallback was written for — only an exception thrown past the dialect ever preserved it.
  it("keeps the scoped DOCKER_HOST when the context read answers nothing", async () => {
    const connection = await dockerWSLProfile.getApiConnection(wslHost(""), undefined);

    expect(connection.relay).toBe("unix:///var/run/docker.sock");
  });

  it("still keeps it when the dialect throws outright", async () => {
    const throwing = async () => {
      throw new Error("context inspect exploded");
    };
    const connection = await dockerWSLProfile.getApiConnection(wslHost(throwing), undefined);

    expect(connection.relay).toBe("unix:///var/run/docker.sock");
  });

  it("reports no relay at all when neither source has one", async () => {
    const connection = await dockerWSLProfile.getApiConnection(wslHost("", ""), undefined);

    expect(connection.relay).toBe("");
  });

  it("refuses without a scope rather than composing a connection to nowhere", async () => {
    const unscoped = {
      id: "host.default.docker.virtualized.wsl",
      logger: { debug: () => {}, warn: () => {}, error: () => {} },
      getSettings: async () => ({ controller: { scope: "" } }),
    } as any;

    expect(await dockerWSLProfile.getApiConnection(unscoped, undefined)).toEqual({ uri: "", relay: "" });
  });
});
