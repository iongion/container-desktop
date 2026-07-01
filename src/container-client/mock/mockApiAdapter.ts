// The "mock axios adapter": resolves an engine HTTP request to fixture data, mirroring the shape
// createApplicationApiDriver expects (`{ data, status, statusText, headers }` on success; a thrown
// axios-like error otherwise). It is engine-aware via `connection.engine` (libpod vs docker paths)
// and handles the streaming endpoints (container logs, /events) by returning an EventEmitter the
// adapters/EngineDataService consume. MockCommand.ProxyRequest delegates here.

import { ContainerEngine } from "@/env/Types";
import { createEmitterStream } from "@/utils/streamEmitter";
import { loadEngineFixtures } from "./fixturesLoader";
import { SWARM_FIXTURE } from "./swarmFixtures";

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
  const { emitter, api } = createEmitterStream();
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

/** `/images/search?term=…` → RegistrySearchResult[] derived from the generated images (keeps the search drawer alive). */
function imageSearchResults(images: unknown[], rawUrl: string): unknown[] {
  const term = (new URLSearchParams(rawUrl.split("?")[1] || "").get("term") || "").toLowerCase();
  return images
    .map((image) => {
      const item = image as { RepoTags?: string[]; Names?: string[] };
      const ref = item.RepoTags?.[0] || item.Names?.[0] || "";
      const name = ref.split(":")[0];
      const official = name.startsWith("library/") || !name.includes("/");
      return {
        Index: "docker.io",
        Name: name,
        Description: `${name} container image`,
        Stars: name.length * 13,
        Official: official ? "[OK]" : "",
        Automated: "",
        Tag: "",
      };
    })
    .filter((result) => !term || result.Name.toLowerCase().includes(term));
}

// Docker Swarm mock. Docker-engine only (Apple `container` has apiSurface "docker" but swarm:false).
// Deterministic seeds live in ./swarmFixtures. Scenario via CONTAINER_DESKTOP_MOCK_SWARM
// (read main-side from process.env; mockApiAdapter runs in main): "manager" (default) serves data;
// "none" makes GET /swarm + lists answer the non-swarm 503 so the UI shows the "Initialize Swarm" state.
const SWARM_PATHS = new Set(["swarm", "services", "nodes", "tasks", "secrets", "configs"]);

function swarmScenario(): string {
  return `${process.env.CONTAINER_DESKTOP_MOCK_SWARM ?? "manager"}`.toLowerCase();
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

  // Docker Swarm (Docker engine only). Owns /swarm,/services,/nodes,/tasks,/secrets,/configs so the
  // Swarm screens render from fixtures; `none` scenario answers 503 → the "Initialize Swarm" state.
  if (engine === ContainerEngine.DOCKER && SWARM_PATHS.has(head)) {
    const inSwarm = swarmScenario() !== "none";
    const notManager = () => fail(503, "This node is not a swarm manager.");
    if (head === "swarm") {
      // POST /swarm/init and /swarm/leave always accept (mock is stateless; the action-wired assertion
      // is enough — real state transitions are covered by the live suite).
      if (method === "POST") {
        return ok("mock-node-id");
      }
      return inSwarm ? ok(SWARM_FIXTURE.info) : notManager();
    }
    if (!inSwarm && method === "GET") {
      return notManager();
    }
    const id = parts[1];
    if (head === "services") {
      if (method === "GET") {
        if (id && id !== "json") {
          const service = SWARM_FIXTURE.services.find((s) => s.ID === id);
          return service ? ok(service) : fail(404, "no such service");
        }
        return ok(SWARM_FIXTURE.services);
      }
      return ok("", 200); // create / update / delete
    }
    if (head === "nodes") {
      if (method === "GET") {
        if (id) {
          const node = SWARM_FIXTURE.nodes.find((n) => n.ID === id);
          return node ? ok(node) : fail(404, "no such node");
        }
        return ok(SWARM_FIXTURE.nodes);
      }
      return ok("", 200);
    }
    if (head === "tasks") {
      return ok(SWARM_FIXTURE.tasks);
    }
    if (head === "secrets") {
      if (method === "GET") {
        if (id && id !== "json") {
          const secret = SWARM_FIXTURE.secrets.find((s) => s.ID === id);
          return secret ? ok(secret) : fail(404, "no such secret");
        }
        return ok(SWARM_FIXTURE.secrets);
      }
      return ok("", 201);
    }
    if (head === "configs") {
      if (method === "GET") {
        if (id && id !== "json") {
          const config = SWARM_FIXTURE.configs.find((c) => c.ID === id);
          return config ? ok(config) : fail(404, "no such config");
        }
        return ok(SWARM_FIXTURE.configs);
      }
      return ok("", 201);
    }
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
    if (parts[1] === "search") {
      return ok(imageSearchResults(fx.images, rawUrl));
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
      const id = parts[1] ? decodeURIComponent(parts[1]) : "";
      // Single-get: "/volumes/<name>" (docker) or "/volumes/<name>/json" (podman). The list uses
      // "/volumes" (undefined) or "/volumes/json" ("json"), so anything else is a single-volume lookup.
      if (id && id !== "json") {
        const items = Array.isArray(fx.volumes) ? fx.volumes : ((fx.volumes as any)?.Volumes ?? []);
        const volume = items.find((item: any) => item.Name === id || item.name === id);
        return volume ? ok(volume) : fail(404, "no such volume");
      }
      return ok(fx.volumes);
    }
    return ok("", 204);
  }

  // Networks: podman → "/networks/json" (canonical); docker → "/networks" (PascalCase). Both arrays.
  if (head === "networks") {
    if (method === "GET") {
      const id = parts[1] ? decodeURIComponent(parts[1]) : "";
      if (id && id !== "json") {
        const network = (fx.networks as any[]).find(
          (item: any) => item.Name === id || item.name === id || item.Id === id || item.id === id,
        );
        return network ? ok(network) : fail(404, "no such network");
      }
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
