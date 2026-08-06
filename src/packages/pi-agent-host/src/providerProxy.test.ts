import { describe, expect, it, vi } from "vitest";

import {
  createProviderProxy,
  forwardedRequestHeaders,
  forwardedResponseHeaders,
  isProviderProxyAuthorized,
} from "@/pi-agent-host/providerProxy";
import type { ProviderProxyRequest } from "@/pi-bridge/protocol";

function proxy() {
  const sent: ProviderProxyRequest[] = [];
  const cancelled: string[] = [];
  let next = 0;
  const subject = createProviderProxy({
    token: "bridge-token",
    transport: { send: (request) => sent.push(request), cancel: (id) => cancelled.push(id) },
    newRequestId: () => `req-${++next}`,
  });
  return { subject, sent, cancelled };
}

function sink() {
  return {
    head: vi.fn(),
    chunk: vi.fn(),
    end: vi.fn(),
    fail: vi.fn(),
  };
}

describe("forwardedRequestHeaders", () => {
  // pi signs the bridge token as its provider credential. The real one is attached by the app, natively, so the
  // token must not travel with the request — it authorises THIS socket and means nothing upstream.
  it("drops the caller's own credential headers", () => {
    const headers = forwardedRequestHeaders({
      authorization: "Bearer bridge-token",
      "x-api-key": "bridge-token",
      "content-type": "application/json",
    });
    expect(headers.authorization).toBeUndefined();
    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers["content-type"]).toBe("application/json");
  });

  it("drops the headers that describe this socket rather than the upstream request", () => {
    const headers = forwardedRequestHeaders({
      host: "127.0.0.1:8789",
      connection: "keep-alive",
      "content-length": "17",
      "transfer-encoding": "chunked",
      accept: "text/event-stream",
    });
    expect(headers).toEqual({ accept: "text/event-stream" });
  });

  it("lowercases what it keeps, so one header cannot arrive twice under two spellings", () => {
    expect(forwardedRequestHeaders({ "Content-Type": "application/json" })).toEqual({
      "content-type": "application/json",
    });
  });
});

describe("forwardedResponseHeaders", () => {
  // The native transport already decoded the body, so echoing the upstream's encoding makes pi's own client try to
  // gunzip plain text and abort mid-answer. The same reasoning the gateway container applied.
  it("drops the encoding and length headers that describe bytes the app already decoded", () => {
    const headers = forwardedResponseHeaders({
      "content-encoding": "gzip",
      "content-length": "1234",
      "transfer-encoding": "chunked",
      connection: "keep-alive",
      "content-type": "application/json",
    });
    expect(headers).toEqual({ "content-type": "application/json" });
  });

  it("keeps the streaming content type a turn depends on", () => {
    expect(forwardedResponseHeaders({ "content-type": "text/event-stream" })["content-type"]).toBe("text/event-stream");
  });
});

describe("isProviderProxyAuthorized", () => {
  it("accepts the bridge token from either header the two client shapes use", () => {
    expect(isProviderProxyAuthorized({ authorization: "Bearer bridge-token" }, "bridge-token")).toBe(true);
    expect(isProviderProxyAuthorized({ "x-api-key": "bridge-token" }, "bridge-token")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isProviderProxyAuthorized({ authorization: "Bearer nope" }, "bridge-token")).toBe(false);
    expect(isProviderProxyAuthorized({}, "bridge-token")).toBe(false);
  });
});

describe("createProviderProxy", () => {
  it("carries one request to the app, with the body as base64", () => {
    const { subject, sent } = proxy();
    const id = subject.begin(
      {
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "content-type": "application/json" },
        body: new TextEncoder().encode('{"model":"m"}'),
      },
      sink(),
    );
    expect(id).toBe("req-1");
    expect(sent).toEqual([
      {
        requestId: "req-1",
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "content-type": "application/json" },
        body: Buffer.from('{"model":"m"}').toString("base64"),
      },
    ]);
  });

  it("omits the body entirely for a request that has none, rather than sending an empty string", () => {
    const { subject, sent } = proxy();
    subject.begin({ method: "GET", path: "/v1/models", headers: {} }, sink());
    expect(sent[0].body).toBeUndefined();
  });

  it("streams the answer to the sink in the order the app sent it", () => {
    const { subject } = proxy();
    const out = sink();
    const id = subject.begin({ method: "POST", path: "/v1/messages", headers: {} }, out);

    subject.deliver(id, {
      kind: "head",
      status: 200,
      statusText: "OK",
      headers: { "content-type": "text/event-stream" },
    });
    subject.deliver(id, { kind: "chunk", data: Buffer.from("data: one\n\n").toString("base64") });
    subject.deliver(id, { kind: "chunk", data: Buffer.from("data: two\n\n").toString("base64") });
    subject.deliver(id, { kind: "end" });

    expect(out.head).toHaveBeenCalledWith(200, "OK", { "content-type": "text/event-stream" });
    expect(out.chunk.mock.calls.map(([bytes]) => new TextDecoder().decode(bytes as Uint8Array))).toEqual([
      "data: one\n\n",
      "data: two\n\n",
    ]);
    expect(out.end).toHaveBeenCalledOnce();
    expect(out.fail).not.toHaveBeenCalled();
  });

  it("reports a failure the app could not perform, so a turn fails instead of hanging", () => {
    const { subject } = proxy();
    const out = sink();
    const id = subject.begin({ method: "POST", path: "/v1/messages", headers: {} }, out);
    subject.deliver(id, { kind: "error", message: "the provider refused the credential" });
    expect(out.fail).toHaveBeenCalledWith("the provider refused the credential");
    expect(out.end).not.toHaveBeenCalled();
  });

  // A settled request must be forgotten, or a long session accumulates one entry per turn for the life of the
  // container — and a late duplicate frame would write to a response that has already ended.
  it("forgets a request once it has ended, and ignores a frame that arrives after", () => {
    const { subject } = proxy();
    const out = sink();
    const id = subject.begin({ method: "GET", path: "/v1/models", headers: {} }, out);
    expect(subject.inFlight()).toBe(1);
    subject.deliver(id, { kind: "end" });
    expect(subject.inFlight()).toBe(0);
    subject.deliver(id, { kind: "chunk", data: Buffer.from("late").toString("base64") });
    expect(out.chunk).not.toHaveBeenCalled();
  });

  it("forgets a request that failed, for the same reason", () => {
    const { subject } = proxy();
    const id = subject.begin({ method: "GET", path: "/v1/models", headers: {} }, sink());
    subject.deliver(id, { kind: "error", message: "boom" });
    expect(subject.inFlight()).toBe(0);
  });

  // pi aborts a turn by dropping its own client. The app is still pulling bytes from the provider and billing for
  // them, so it has to be told to stop.
  it("tells the app to stop when the client goes away mid-answer", () => {
    const { subject, cancelled } = proxy();
    const id = subject.begin({ method: "POST", path: "/v1/messages", headers: {} }, sink());
    subject.abandon(id);
    expect(cancelled).toEqual([id]);
    expect(subject.inFlight()).toBe(0);
  });

  it("does not cancel a request that already finished", () => {
    const { subject, cancelled } = proxy();
    const id = subject.begin({ method: "GET", path: "/v1/models", headers: {} }, sink());
    subject.deliver(id, { kind: "end" });
    subject.abandon(id);
    expect(cancelled).toEqual([]);
  });

  // A request arriving before the app has connected, or after it has gone, has nowhere to go. It must fail AS a
  // request — pi would otherwise block on a stream nothing is ever going to write to.
  it("fails a request the transport cannot carry, instead of leaving it in flight", () => {
    const out = sink();
    const subject = createProviderProxy({
      token: "bridge-token",
      transport: {
        send: () => {
          throw new Error("the app is not connected");
        },
        cancel: () => {},
      },
      newRequestId: () => "req-1",
    });
    subject.begin({ method: "GET", path: "/v1/models", headers: {} }, out);
    expect(out.fail).toHaveBeenCalledWith("the app is not connected");
    expect(subject.inFlight()).toBe(0);
  });

  it("drops a frame naming a request it never had, rather than throwing on the socket", () => {
    const { subject } = proxy();
    expect(() => subject.deliver("req-nobody", { kind: "end" })).not.toThrow();
  });

  // The socket is what carries every answer. If it dies, each blocked request has to fail on its own terms —
  // otherwise pi waits on a stream that will never produce another byte.
  it("fails every request in flight when the bridge goes", () => {
    const { subject } = proxy();
    const first = sink();
    const second = sink();
    subject.begin({ method: "POST", path: "/v1/messages", headers: {} }, first);
    subject.begin({ method: "POST", path: "/v1/messages", headers: {} }, second);
    subject.failAll("the agent bridge closed");
    expect(first.fail).toHaveBeenCalledWith("the agent bridge closed");
    expect(second.fail).toHaveBeenCalledWith("the agent bridge closed");
    expect(subject.inFlight()).toBe(0);
  });
});
