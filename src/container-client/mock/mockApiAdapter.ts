// The "mock axios adapter": resolves an engine HTTP request to fixture data, mirroring the shape
// createApplicationApiDriver expects (`{ data, status, statusText, headers }` on success; a thrown
// axios-like error otherwise). It is engine-aware via `connection.engine` (libpod vs docker paths)
// and handles the streaming endpoints (container logs, /events) by returning an EventEmitter the
// adapters/EngineDataService consume. MockCommand.ProxyRequest delegates here.

import { EventEmitter } from "eventemitter3";

import { ContainerEngine } from "@/env/Types";
import { loadEngineFixtures } from "./fixturesLoader";

interface MockApiResponse {
  status: number;
  statusText: string;
  data: unknown;
  headers: Record<string, string>;
}

function ok(data: unknown, status = 200): MockApiResponse {
  return { status, statusText: status === 204 ? "No Content" : "OK", data, headers: {} };
}

function fail(status: number, message: string): never {
  const error: any = new Error(message);
  error.isAxiosError = true;
  error.response = { status, statusText: message, data: { cause: message }, headers: {} };
  throw error;
}

/** on/off/destroy emitter matching what the adapters + commandProxyClient consume for streams. */
function createMockStream(chunks: Uint8Array[]): any {
  const emitter = new EventEmitter();
  const api: any = {
    on: (event: string, fn: (...args: any[]) => void) => {
      emitter.on(event, fn);
      return api;
    },
    off: (event: string, fn: (...args: any[]) => void) => {
      emitter.off(event, fn);
      return api;
    },
    removeListener: (event: string, fn: (...args: any[]) => void) => {
      emitter.removeListener(event, fn);
      return api;
    },
    destroy: () => emitter.removeAllListeners(),
    close: () => emitter.removeAllListeners(),
  };
  // Emit on a macrotask so the caller registers its listeners first (see fakeCommand.ts rationale).
  setTimeout(() => {
    for (const chunk of chunks) {
      emitter.emit("data", chunk);
    }
    emitter.emit("end");
  }, 0);
  return api;
}

function encodeLogs(lines: string[]): Uint8Array[] {
  const encoder = new TextEncoder();
  return lines.map((line) => encoder.encode(line.endsWith("\n") ? line : `${line}\n`));
}

/** Split "/containers/abc/json" → ["containers","abc","json"] (query already stripped by caller). */
function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

export async function mockApiAdapter(request: any, connection: any): Promise<MockApiResponse> {
  const engine = connection?.engine ?? ContainerEngine.PODMAN;
  const fx = await loadEngineFixtures(engine);
  const method = `${request?.method || "GET"}`.toUpperCase();
  const rawUrl = `${request?.url || ""}`;
  const path = rawUrl.split("?")[0];
  const parts = segments(path);
  const isStream = request?.responseType === "stream";
  const head = parts[0] || "";

  // Liveness + identity probes.
  if (path.endsWith("/_ping")) {
    return ok("OK");
  }
  if (head === "version") {
    return ok(fx.version);
  }
  if (head === "info") {
    return ok(fx.info);
  }

  if (head === "containers") {
    if (parts[1] === "json") {
      return ok(fx.containers);
    }
    const id = parts[1];
    const tail = parts[2];
    if (id) {
      if (tail === "json") {
        const inspect = fx.containerInspect[id] ?? fx.containerInspect[Object.keys(fx.containerInspect)[0]];
        return inspect ? ok(inspect) : fail(404, "no such container");
      }
      if (tail === "logs") {
        return isStream ? ok(createMockStream(encodeLogs(fx.extras.logs))) : ok(fx.extras.logs.join(""));
      }
      if (tail === "stats") {
        return ok(fx.extras.stats[id] ?? Object.values(fx.extras.stats)[0] ?? {});
      }
      if (tail === "top") {
        return ok(fx.extras.top);
      }
      // start/stop/restart/pause/unpause/kill and create/delete — accept the mutation.
      if (method === "POST" || method === "DELETE") {
        return ok("", 204);
      }
    }
  }

  if (head === "images") {
    if (parts[1] === "json") {
      return ok(fx.images);
    }
    const id = parts[1];
    const tail = parts[2];
    if (id) {
      if (tail === "json") {
        const inspect = fx.imageInspect[id] ?? fx.imageInspect[Object.keys(fx.imageInspect)[0]];
        return inspect ? ok(inspect) : fail(404, "no such image");
      }
      if (tail === "history") {
        return ok([]);
      }
      if (method === "POST" || method === "DELETE") {
        return ok("", 204);
      }
    }
  }

  // Volumes: podman → "/volumes/json" (array); docker → "/volumes" ({ Volumes: [...] }).
  if (head === "volumes") {
    if (method === "GET") {
      return ok(fx.volumes);
    }
    return ok("", 204);
  }

  // Networks: podman → "/networks/json" (canonical); docker → "/networks" (PascalCase).
  if (head === "networks") {
    if (method === "GET") {
      return ok(fx.networks);
    }
    return ok("", 204);
  }

  if (head === "pods") {
    if (method === "GET") {
      const id = parts[1];
      const tail = parts[2];
      if (id && id !== "json") {
        const pod = fx.pods.find((item: any) => item.Id === id || item.Name === id);
        if (!pod) {
          return fail(404, "no such pod");
        }
        if (tail === "top") {
          return ok((pod as any).Processes || { Titles: [], Processes: [] });
        }
        return ok(pod);
      }
      return ok(fx.pods);
    }
    return ok("", 204);
  }

  if (head === "secrets") {
    if (method === "GET") {
      const id = parts[1];
      if (id && id !== "json") {
        const secret = fx.secrets.find((item: any) => item.ID === id || item.Spec?.Name === id);
        return secret ? ok(secret) : fail(404, "no such secret");
      }
      return ok(fx.secrets);
    }
    return ok("", 204);
  }

  // Event stream the main-owned EngineDataService attaches — emit nothing, then end.
  if (head === "events" || path.endsWith("/events")) {
    return ok(createMockStream([]));
  }

  // Unknown read → empty list is safer than a hard error for list-shaped endpoints; otherwise 404.
  if (method === "GET") {
    return ok([]);
  }
  return ok("", 204);
}
