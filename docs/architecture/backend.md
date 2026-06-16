# Backend — Engine & Connection Support (C4 L3)

The "backend" is everything that turns *"connect me to this engine"* into a live,
pingable API the UI can call. It lives in [`src/container-client/`](../../src/container-client/)
and — despite the name — runs **in the renderer process**, reaching the OS through
the preload bridge (see [overview.md](overview.md)).

Its whole job: given a **Connection** (which engine, which host), produce a
**HostClient** that knows how to start the scope, find the engine socket, start
the API, and proxy requests to it.

## The core idea: one HostClient = Dialect × Transport × Profile

There are two engines (Podman, Docker) and five host types (native, machine/
vendor, WSL, Lima, SSH-remote) — ten combinations. Rather than ten inheritance
leaves, each combination is **composed** from three single-purpose units:

| Unit              | Varies by      | Answers                                                                                                        | Source                                                                                                           |
| ----------------- | -------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **EngineDialect** | engine         | "How do I speak to _this engine_?" — read its socket, build its service command, get system info               | [`runtimes/dialects/{podman,docker}.ts`](../../src/container-client/runtimes/dialects/)                          |
| **HostProfile**   | (engine, host) | the thin glue — OS availability gate, automatic-settings detection, the per-host API-connection resolver       | [`runtimes/profiles/{podman,docker}.ts`](../../src/container-client/runtimes/profiles/)                          |
| **Transport**     | host type      | "How do I reach a host of _this kind_?" — start/stop a scope, shape the API URI, run the API, build the driver | [`runtimes/transports/{native,ssh,wsl,lima,podman-machine}.ts`](../../src/container-client/runtimes/transports/) |

A **registry** maps each `(engine, host)` pair to its three units; a factory
assembles them into a `HostClient`. The `HostClient` *is* the `HostContext` passed
back into those units' methods — so a Transport can call back into the engine's
Dialect through `host.dialect`, and vice-versa.

```mermaid
flowchart TB
  appStore["Renderer store<br/>(stores/appStore.ts)"]:::external

  subgraph backend[container-client — engine/connection support]
    direction TB
    app["Application<br/>(Application.ts)<br/>singleton orchestrator"]:::component
    reg["registry<br/>(runtimes/registry.ts)<br/>(engine,host) → 3 units"]:::component
    hc["HostClient<br/>(runtimes/host-client.ts)<br/>= HostContext, implements facade"]:::component
    facade["HostClientFacade<br/>(runtimes/facade.ts)<br/>~50 container/image/volume/pod ops"]:::component

    dia["EngineDialect<br/>podman.ts / docker.ts"]:::component
    tra["Transport<br/>native·ssh·wsl·lima·podman-machine"]:::component
    pro["HostProfile<br/>podman.ts / docker.ts"]:::component

    api["Api.clients<br/>(Api.clients.ts)<br/>axios over Command.ProxyRequest"]:::component
    cfg["userConfiguration<br/>(config.ts)<br/>connections, settings"]:::component
  end

  bridge["Preload bridge: Command · FS · Platform · Path<br/>(window.* via contextBridge)"]:::external
  engine[(Engine API socket)]:::external

  appStore -->|start / CRUD / settings| app
  app --> reg --> hc
  hc --> facade
  hc --> dia
  hc --> tra
  hc --> pro
  hc --> api
  app --> cfg
  api -->|HTTP request| bridge
  tra -->|spawn CLI, SSH, sockets| bridge
  bridge -.-> engine

  classDef component fill:#85bbf0,color:#000,stroke:#5d82a8;
  classDef external fill:#8a8a8a,color:#fff,stroke:#5e5e5e;
```

## The components

- **Application** — [`Application.ts`](../../src/container-client/Application.ts).
  The singleton the renderer talks to (`Application.getInstance()`). Owns the
  connection lifecycle (`start`, `stop`, `createConnectorContainerEngineHostClient`),
  connection CRUD, settings, and one-off engine actions (machines, kube, registries,
  security scans). It holds the active `HostClient` per connection id.
- **registry** — [`registry.ts`](../../src/container-client/runtimes/registry.ts).
  The ten-entry table `HOST_CLIENT_REGISTRY` and `createComposedHostClient()`.
  Stateless dialects/profiles are shared singletons; transports are created
  per-host (SSH/WSL/machine keep per-connection state). See
  [engine-matrix.md](engine-matrix.md) for the full table.
- **HostClient / HostContext** — [`host-client.ts`](../../src/container-client/runtimes/host-client.ts)
  + [`composition.ts`](../../src/container-client/runtimes/composition.ts). The
  composed object that implements the operations facade by delegating to its three
  units. It is passed back into them as `HostContext`, the shared "this".
- **HostClientFacade** — [`facade.ts`](../../src/container-client/runtimes/facade.ts).
  The uniform operations surface the UI consumes (containers, images, volumes,
  networks, pods, secrets, events, plus engine extensions like machines, contexts,
  swarm, compose). Named here, not enumerated — read the interface.
- **EngineDialect / Transport / HostProfile** — the three units above. Their
  contracts are defined once in [`composition.ts`](../../src/container-client/runtimes/composition.ts);
  Native's scope operations are intentional no-ops (symmetry over special-casing).
- **Api.clients** — [`Api.clients.ts`](../../src/container-client/Api.clients.ts).
  `createApplicationApiDriver()` returns an Axios instance whose every request is
  routed through `Command.ProxyRequest(req, connection)` — i.e. HTTP spoken over a
  unix socket / named pipe / SSH tunnel, executed in the preload's Node world. The
  SSH transport injects a `getSSHConnection` hook so the tunnel comes up lazily on
  first request.
- **userConfiguration** — [`config.ts`](../../src/container-client/config.ts).
  Persisted settings and the saved connection list (the one piece the main process
  also imports).

## Resource data layer (lists + freshness)

The `HostClientFacade` is the raw operations surface; screens don't call it directly. Two layers sit on top:

- **Per-resource adapters** — [`adapters/`](../../src/container-client/adapters/). Each
  (`ContainersAdapter`, `ImagesAdapter`, `PodsAdapter`, `VolumesAdapter`, `NetworksAdapter`,
  `SecretsAdapter`, …) extends [`ResourceAdapter`](../../src/container-client/adapters/shared.ts), which
  binds the active `HostClient`'s Axios driver and the per-engine normalizers. Adapters expose typed
  `list()/start()/stop()/…` over the engine REST API; `getActiveHostClient()` resolves the current host.
- **Resource vocabulary** — [`resourceDomains.ts`](../../src/container-client/resourceDomains.ts): the
  canonical `RESOURCE_DOMAINS`, `ResourceDomain`/`ResourceItemsByDomain` types, and the engine-event →
  domain mapping (`normalizeResourceEventDomains`). Neutral (no Zustand/Electron) so **both** the renderer
  and the main process import it. The renderer's `resourceEvents`/`resourceStore` consume it (see
  [frontend.md](frontend.md)).

### Main-owned data layer

The **main process is the source of truth for engine reads**: it owns the engine `/events` stream and all
list fetching, and pushes snapshots to every window. The renderer no longer runs its own event manager —
`resourceEvents` is now a thin client that starts the mirror and forwards "refresh now" nudges to main.

| Piece | Path | Role |
| --- | --- | --- |
| `EngineDataService` | [`electron-shell/engineDataService.ts`](../../src/electron-shell/engineDataService.ts) | Main-side owner: an `Application` (via `Application.initInstance`, no `window`), connection/runtime + per-connection resource state, initial lists + `/events` → debounced refresh; follows the renderer's connection switches. |
| `ResourceSyncBroker` | [`electron-shell/resourceSyncBroker.ts`](../../src/electron-shell/resourceSyncBroker.ts) | Pushes a `ResourceSyncSnapshot` to windows on change; answers sender-validated `resource:get-snapshot`; accepts `resource:refresh` + `resource:switch-connection`. |
| `ResourceBus` (preload) | [`electron-shell/resourceBus.ts`](../../src/electron-shell/resourceBus.ts) | Allowlisted receive bridge (mirrors `TrayBus`) for the push channel. |
| `resourceMirror` (renderer) | [`web-app/stores/resourceMirror.ts`](../../src/web-app/stores/resourceMirror.ts) | Applies main's pushed snapshots into the **same** `resourceStore` the screens read (the seam). |
| Shared protocol | [`container-client/resourceSyncProtocol.ts`](../../src/container-client/resourceSyncProtocol.ts) | Channels + `AppRuntimeSnapshot`/`ResourceSyncSnapshot` types. |

The data/read-layer is owned by main and live-verified. **Still renderer-side (follow-ups):** command
execution (mutations, log streaming) + connection identity run through the renderer's `Application` (so two
connections exist today); retiring `TrayBridge` (main building the tray snapshot) and collapsing to a single
connection remain.

## Key types (the vocabulary)

All in [`src/env/Types.ts`](../../src/env/Types.ts):

- `ContainerEngine` — `PODMAN | DOCKER`.
- `ContainerEngineHost` — the ten `engine.host` values (e.g. `podman.native`,
  `docker.virtualized.wsl`).
- `ControllerScopeType` — `PodmanMachine | WSLDistribution | LIMAInstance |
  SSHConnection` (the kind of scope a non-native host runs in).
- `Connection` — a named, identified `(engine, host, settings)` the user picks.
- `Connector` — a `Connection` enriched with discovered `availability` (and
  `scopes`, `capabilities`); this is what the UI lists.
- `EngineConnectorSettings` — `{ api: { baseURL, connection: { uri, relay } },
  program, controller?, rootfull, mode }`, where `mode` is `automatic` or `manual`.
- `EngineConnectorAvailability` — the per-check result (`host`, `program`,
  `controller`, `api`, …) with a human-readable `report`.

## What happens at connect time

The ordered sequence — start scope → detect settings → start API → check
availability — is the subject of its own page:
**[connection-startup.md](connection-startup.md)**.

## Source map

| Component                     | Path                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------- |
| API driver                    | [`Api.clients.ts`](../../src/container-client/Api.clients.ts)                   |
| Composed client               | [`runtimes/host-client.ts`](../../src/container-client/runtimes/host-client.ts) |
| Composition seam (interfaces) | [`runtimes/composition.ts`](../../src/container-client/runtimes/composition.ts) |
| Connector defaults            | [`connection.ts`](../../src/container-client/connection.ts)                     |
| Dialects                      | [`runtimes/dialects/`](../../src/container-client/runtimes/dialects/)           |
| Operations facade             | [`runtimes/facade.ts`](../../src/container-client/runtimes/facade.ts)           |
| Orchestrator                  | [`Application.ts`](../../src/container-client/Application.ts)                   |
| Profiles                      | [`runtimes/profiles/`](../../src/container-client/runtimes/profiles/)           |
| Registry (10 entries)         | [`runtimes/registry.ts`](../../src/container-client/runtimes/registry.ts)       |
| Transports                    | [`runtimes/transports/`](../../src/container-client/runtimes/transports/)       |
| Types                         | [`src/env/Types.ts`](../../src/env/Types.ts)                                    |
