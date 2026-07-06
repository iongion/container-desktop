import { describe, expect, it, vi } from "vitest";
import {
  pickConnection,
  pickSerializableRequest,
  shapeBufferedResponse,
} from "@/container-client/commandProxyProtocol";

import { applyStreamEvent, buildBridgeSpec, createProxyRequest } from "./proxy-request";

const SSH_BASE = [
  "-oStrictHostKeyChecking=accept-new",
  "-oBatchMode=yes",
  "-oConnectTimeout=15",
  "-oConnectionAttempts=1",
];

describe("proxy-request pure helpers", () => {
  it("pickSerializableRequest keeps only the serializable axios keys and plainifies headers", () => {
    const signal = new AbortController().signal;
    const picked = pickSerializableRequest({
      method: "GET",
      url: "/containers/json",
      baseURL: "http://d/v4.0.0/libpod",
      params: { all: true },
      data: undefined,
      responseType: "json",
      timeout: 3000,
      headers: { Accept: "application/json", "X-Num": 5, bad: null, obj: {} },
      signal,
      adapter: () => undefined,
      transformRequest: [],
    });
    expect(picked).toEqual({
      method: "GET",
      url: "/containers/json",
      baseURL: "http://d/v4.0.0/libpod",
      params: { all: true },
      responseType: "json",
      timeout: 3000,
      headers: { Accept: "application/json", "X-Num": "5" }, // number → string; null + object dropped
    });
    expect(picked).not.toHaveProperty("signal");
    expect(picked).not.toHaveProperty("adapter");
    expect(picked).not.toHaveProperty("data"); // undefined is not carried
  });

  it("pickSerializableRequest reads AxiosHeaders via toJSON", () => {
    const headers = { toJSON: () => ({ Accept: "application/octet-stream" }) };
    expect(pickSerializableRequest({ url: "/x", headers }).headers).toEqual({ Accept: "application/octet-stream" });
  });

  it("pickConnection extracts id/host + the socket-path fields only", () => {
    expect(
      pickConnection({
        id: "system.podman",
        host: "podman.native",
        name: "ignored",
        settings: {
          api: { baseURL: "http://d", connection: { uri: "unix:///run/podman.sock", relay: "" } },
          extra: 1,
        },
      }),
    ).toEqual({
      id: "system.podman",
      host: "podman.native",
      settings: { api: { baseURL: "http://d", connection: { uri: "unix:///run/podman.sock", relay: "" } } },
    });
  });

  it("shapeBufferedResponse returns a plain response on ok", () => {
    expect(
      shapeBufferedResponse({
        stream: false,
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { a: "b" },
        data: [{ Id: "c1" }],
      }),
    ).toEqual({ data: [{ Id: "c1" }], status: 200, statusText: "OK", headers: { a: "b" } });
  });

  it("shapeBufferedResponse returns a __proxyError envelope on non-ok (never throws)", () => {
    expect(
      shapeBufferedResponse({
        stream: false,
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: {},
        data: { message: "no such container" },
        message: "Request failed with status code 404",
      }),
    ).toEqual({
      __proxyError: true,
      status: 404,
      statusText: "Not Found",
      data: { message: "no such container" },
      headers: {},
      message: "Request failed with status code 404",
    });
  });

  it("applyStreamEvent maps data/end/error to emitter events", () => {
    const events: any[] = [];
    const emitter = {
      emit: (event: string, ...args: any[]) => {
        events.push([event, ...args]);
      },
    };
    applyStreamEvent(emitter, { streamId: "s1", type: "data", payload: "line1" });
    applyStreamEvent(emitter, { streamId: "s1", type: "end" });
    applyStreamEvent(emitter, { streamId: "s1", type: "error", payload: { message: "boom" } });
    expect(events[0]).toEqual(["data", "line1"]);
    expect(events[1]).toEqual(["end"]);
    expect(events[2][0]).toBe("error");
    expect(events[2][1]).toBeInstanceOf(Error);
    expect(events[2][1].message).toBe("boom");
  });
});

describe("buildBridgeSpec", () => {
  const sshDialStdio = {
    host: "docker.remote",
    id: "ssh.docker.prod",
    settings: {
      controller: { scope: "prod" },
      api: {
        connection: {
          uri: "/tmp/cd-ssh-prod.sock",
          relay: "/run/user/1000/docker.sock",
          dialStdioCommand: ["docker", "system", "dial-stdio"],
        },
      },
    },
  };

  it("returns undefined for a direct local host (no bridge needed)", () => {
    expect(
      buildBridgeSpec({ host: "podman.native", settings: { api: { connection: { uri: "/s.sock" } } } }),
    ).toBeUndefined();
  });

  it("builds a stdio bridge for an SSH remote with a dial-stdio command", () => {
    expect(buildBridgeSpec(sshDialStdio, "Linux")).toEqual({
      kind: "stdio",
      key: "/run/user/1000/docker.sock", // cache key = remote relay
      localAddress: "/tmp/cd-ssh-prod.sock",
      launcher: "ssh",
      // configHost=prod ⇒ no -i/-p; target is the alias; then `-- docker system dial-stdio`
      argv: [...SSH_BASE, "prod", "--", "docker", "system", "dial-stdio"],
    });
  });

  it("builds an `ssh -NL` tunnel spec when there is no dial-stdio command", () => {
    const spec = buildBridgeSpec({
      host: "podman.remote",
      settings: { controller: { scope: "vm" }, api: { connection: { uri: "/tmp/p.sock", relay: "/run/podman.sock" } } },
    });
    expect(spec).toEqual({
      kind: "tunnel",
      key: "/run/podman.sock",
      localAddress: "/tmp/p.sock",
      launcher: "ssh",
      argv: [
        ...SSH_BASE,
        "-oExitOnForwardFailure=yes",
        "-oStreamLocalBindUnlink=yes",
        "-NL",
        "/tmp/p.sock:/run/podman.sock",
        "vm",
      ],
    });
  });

  it("throws when an SSH remote has no relay socket", () => {
    expect(() =>
      buildBridgeSpec({
        host: "podman.remote",
        settings: { controller: { scope: "vm" }, api: { connection: { uri: "/tmp/p.sock", relay: "" } } },
      }),
    ).toThrow("Remote engine socket could not be determined");
  });

  it("throws early on Windows when an SSH remote has no dial-stdio command", () => {
    expect(() =>
      buildBridgeSpec(
        {
          host: "podman.remote",
          settings: {
            controller: { scope: "vm" },
            api: { connection: { uri: "/tmp/p.sock", relay: "/run/podman.sock" } },
          },
        },
        "Windows_NT",
      ),
    ).toThrow("No dial-stdio bridge for this SSH connection");
  });

  it("uses ssh.exe on Windows", () => {
    expect(buildBridgeSpec(sshDialStdio, "Windows_NT")?.launcher).toBe("ssh.exe");
  });

  it("builds a WSL dial-stdio bridge (wsl.exe over a named pipe, keyed by connection id)", () => {
    const spec = buildBridgeSpec({
      host: "docker.virtualized.wsl",
      id: "wsl.docker.ubuntu",
      engine: "docker",
      settings: {
        controller: { scope: "Ubuntu-24.04" },
        program: { name: "docker" },
        api: {
          connection: {
            uri: "\\\\.\\pipe\\container-desktop-ssh-relay-wsl.docker.ubuntu",
            relay: "unix:///var/run/docker.sock",
          },
        },
      },
    });
    expect(spec).toEqual({
      kind: "stdio",
      key: "wsl.docker.ubuntu", // WSL cache key = connection id
      localAddress: "\\\\.\\pipe\\container-desktop-ssh-relay-wsl.docker.ubuntu",
      launcher: "wsl.exe",
      argv: [
        "--distribution",
        "Ubuntu-24.04",
        "--exec",
        "docker",
        "-H",
        "unix:///var/run/docker.sock",
        "system",
        "dial-stdio",
      ],
    });
  });

  it("createProxyRequest forwards the bridge spec in the proxy_request payload", async () => {
    const calls: any[] = [];
    const invoke = vi.fn(async (_cmd: string, args: any) => {
      calls.push(args);
      return { stream: false, ok: true, status: 200, statusText: "OK", headers: {}, data: [] };
    });
    const proxyRequest = createProxyRequest({ invoke, newChannel: () => ({ onmessage: null }), osType: "Linux" });
    await proxyRequest({ method: "GET", url: "/containers/json" }, sshDialStdio);
    expect(calls[0].payload.bridge).toMatchObject({
      kind: "stdio",
      launcher: "ssh",
      key: "/run/user/1000/docker.sock",
    });
  });
});

describe("createProxyRequest", () => {
  it("buffered: invokes proxy_request with the picked req/connection and returns the shaped response", async () => {
    const calls: any[] = [];
    const invoke = vi.fn(async (cmd: string, args: any) => {
      calls.push([cmd, args]);
      return { stream: false, ok: true, status: 200, statusText: "OK", headers: {}, data: [{ Id: "c1" }] };
    });
    const proxyRequest = createProxyRequest({ invoke, newChannel: () => ({ onmessage: null }) });
    const result = await proxyRequest(
      { method: "GET", url: "/containers/json", params: { all: true } },
      { id: "x", host: "podman.native", settings: { api: { connection: { uri: "unix:///s.sock" } } } },
    );
    expect(result).toEqual({ data: [{ Id: "c1" }], status: 200, statusText: "OK", headers: {} });
    expect(calls[0][0]).toBe("proxy_request");
    expect(calls[0][1].payload.req).toMatchObject({ method: "GET", url: "/containers/json", params: { all: true } });
    expect(calls[0][1].payload.connection.settings.api.connection.uri).toBe("unix:///s.sock");
  });

  it("buffered failure: returns a __proxyError envelope and does not throw", async () => {
    const invoke = vi.fn(async () => ({
      stream: false,
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: {},
      data: { message: "boom" },
      message: "Request failed with status code 500",
    }));
    const proxyRequest = createProxyRequest({ invoke, newChannel: () => ({ onmessage: null }) });
    const result = await proxyRequest({ url: "/x" }, {});
    expect(result.__proxyError).toBe(true);
    expect(result.status).toBe(500);
    expect(result.data).toEqual({ message: "boom" });
  });

  it("stream: opens via proxy_request_stream, pipes channel events to the emitter, tears down with the streamId", async () => {
    let channel: any;
    const destroyed: any[] = [];
    const invoke = vi.fn(async (cmd: string, args: any) => {
      if (cmd === "proxy_request_stream") {
        return { stream: true, streamId: "cps-7", status: 200, headers: { "content-type": "application/json" } };
      }
      if (cmd === "proxy_stream_destroy") {
        destroyed.push(args);
      }
      return undefined;
    });
    const newChannel = () => {
      channel = { onmessage: null };
      return channel;
    };
    const proxyRequest = createProxyRequest({ invoke, newChannel });
    const response = await proxyRequest(
      { url: "/events", responseType: "stream" },
      { settings: { api: { connection: { uri: "unix:///s.sock" } } } },
    );
    expect(response.status).toBe(200);
    expect(response.statusText).toBe("");
    expect(response.headers).toEqual({ "content-type": "application/json" });

    const seen: any[] = [];
    let ended = false;
    response.data.on("data", (chunk: any) => seen.push(chunk));
    response.data.on("end", () => {
      ended = true;
    });
    channel.onmessage({ streamId: "cps-7", type: "data", payload: "event-line" });
    channel.onmessage({ streamId: "cps-7", type: "end" });
    expect(seen).toEqual(["event-line"]);
    expect(ended).toBe(true);

    response.data.destroy();
    expect(destroyed).toEqual([{ streamId: "cps-7" }]);
  });
});
