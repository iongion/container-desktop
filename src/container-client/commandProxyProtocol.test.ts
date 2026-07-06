import { describe, expect, it } from "vitest";
import { pickConnection, pickSerializableRequest, shapeBufferedResponse } from "./commandProxyProtocol";

describe("command proxy protocol projections", () => {
  it("keeps only serializable request fields and plainifies headers", () => {
    const picked = pickSerializableRequest({
      method: "GET",
      url: "/containers/json",
      baseURL: "http://d/v4.0.0/libpod",
      params: { all: true },
      data: undefined,
      responseType: "json",
      timeout: 3000,
      headers: { Accept: "application/json", "X-Num": 5, bad: null, obj: {} },
      signal: new AbortController().signal,
      adapter: () => undefined,
    });

    expect(picked).toEqual({
      method: "GET",
      url: "/containers/json",
      baseURL: "http://d/v4.0.0/libpod",
      params: { all: true },
      responseType: "json",
      timeout: 3000,
      headers: { Accept: "application/json", "X-Num": "5" },
    });
  });

  it("reads AxiosHeaders-like values via toJSON", () => {
    const headers = { toJSON: () => ({ Accept: "application/octet-stream" }) };
    expect(pickSerializableRequest({ url: "/x", headers }).headers).toEqual({ Accept: "application/octet-stream" });
  });

  it("extracts the connection routing fields used across IPC/native proxy boundaries", () => {
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

  it("shapes buffered proxy responses into renderer driver results", () => {
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

  it("shapes non-ok buffered proxy responses as serializable proxy-error envelopes", () => {
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
});
