// Preload-side forwarder for Command.ProxyRequest. The renderer's engine HTTP is routed to the MAIN process
// so the single engine connection (tunnel/relay/socket pool) lives only there; the renderer keeps the other
// Command methods local (Spawn/Execute/SSH are one-shot CLI, not persistent connections).
//
// This is a drop-in for Command.ProxyRequest: createApplicationApiDriver.request() calls it and returns its
// result, so it must behave exactly like the local one — an axios-response-like object on success, a thrown
// axios-like error on failure (so the adapters' status checks/catches are unchanged), and a `{data: emitter}`
// for streaming responses (container logs), rebuilt here from main's pushed chunk events to mirror
// createProxyStreamBridge's on/off/destroy surface. CJS-safe: no web-app imports.

import { ipcRenderer } from "electron";

import {
  COMMAND_PROXY,
  type CommandProxyResult,
  type CommandProxyStreamEvent,
} from "@/container-client/commandProxyProtocol";
import { createEmitterStream } from "@/utils/streamEmitter";

// Only forward the fields the engine API needs; the axios config can otherwise carry non-cloneable bits
// (the SSH `getSSHConnection` closure in `context`, interceptors, …) that must never cross IPC.
function pickSerializableRequest(request: any): Record<string, unknown> {
  const req = request || {};
  return {
    method: req.method,
    url: req.url,
    baseURL: req.baseURL,
    params: req.params,
    data: req.data,
    headers: req.headers,
    responseType: req.responseType,
    timeout: req.timeout,
  };
}

// Rebuild the on/off/destroy emitter Api.clients consumes from main's pushed chunk events for this stream.
function createForwardedStream(streamId: string) {
  let listener: (event: unknown, evt: CommandProxyStreamEvent) => void = () => {};
  const { emitter, api } = createEmitterStream({
    onDestroy: () => {
      ipcRenderer.removeListener(COMMAND_PROXY.streamEvent, listener);
      try {
        ipcRenderer.send(COMMAND_PROXY.streamDestroy, { streamId });
      } catch {
        // best-effort teardown
      }
    },
  });
  listener = (_event: unknown, evt: CommandProxyStreamEvent) => {
    if (!evt || evt.streamId !== streamId) {
      return;
    }
    if (evt.type === "data") {
      emitter.emit("data", evt.payload);
    } else if (evt.type === "end") {
      emitter.emit("end");
    } else if (evt.type === "error") {
      emitter.emit("error", new Error((evt.payload as any)?.message ?? "stream error"));
    }
  };
  ipcRenderer.on(COMMAND_PROXY.streamEvent, listener);
  return api;
}

export async function forwardProxyRequest(request: any, connection: any, _context?: any): Promise<any> {
  const result = (await ipcRenderer.invoke(COMMAND_PROXY.request, {
    req: pickSerializableRequest(request),
    connection,
  })) as CommandProxyResult;
  if (result?.stream) {
    return {
      data: createForwardedStream(result.streamId),
      status: result.status,
      statusText: "",
      headers: result.headers ?? {},
    };
  }
  if (result?.ok) {
    return { data: result.data, status: result.status, statusText: result.statusText, headers: result.headers ?? {} };
  }
  // Rebuild an axios-like error so the adapters' catch / `isOk` logic behaves exactly as for the local path.
  const error: any = new Error(
    result?.message || `Request failed${result?.status ? ` with status ${result.status}` : ""}`,
  );
  error.isAxiosError = true;
  error.response = {
    status: result?.status,
    statusText: result?.statusText,
    data: result?.data,
    headers: result?.headers,
  };
  throw error;
}
